/**
 * Salesforce Lightning UI API helpers (uses the logged-in browser session).
 */
(function initWohSfApi() {
  const API_VERSION = 'v59.0';
  const RELATED_LIST = 'WOH_Survey_Results__r';

  async function fetchJson(pathOrUrl) {
    const url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${location.origin}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
    const response = await fetch(url, { credentials: 'include' });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      /* non-JSON */
    }
    if (!response.ok) {
      const message =
        (Array.isArray(json) && json[0]?.message) ||
        json?.message ||
        `HTTP ${response.status}`;
      throw new Error(message);
    }
    return json;
  }

  async function uiApiRecord(recordId) {
    return fetchJson(
      `/services/data/${API_VERSION}/ui-api/records/${encodeURIComponent(recordId)}?layoutTypes=Full&modes=View`
    );
  }

  function fieldValue(record, apiName) {
    const field = record?.fields?.[apiName];
    if (!field) return null;
    if (field.value != null && typeof field.value === 'object' && 'value' in field.value) {
      return field.value.value;
    }
    return field.value ?? field.displayValue ?? null;
  }

  function fieldDisplay(record, apiName) {
    const field = record?.fields?.[apiName];
    if (!field) return '';
    if (field.displayValue) return field.displayValue;
    const value = fieldValue(record, apiName);
    return value == null ? '' : String(value);
  }

  /**
   * Page through a related list until exhausted (or maxPages).
   */
  async function relatedListAll(parentId, relatedListId = RELATED_LIST, fields = [], { pageSize = 50, maxPages = 40 } = {}) {
    const fieldParam = fields.length ? `&fields=${fields.map(encodeURIComponent).join(',')}` : '';
    let pageToken = '0';
    const records = [];

    for (let page = 0; page < maxPages; page++) {
      const path =
        `/services/data/${API_VERSION}/ui-api/related-list-records/` +
        `${encodeURIComponent(parentId)}/${encodeURIComponent(relatedListId)}` +
        `?pageSize=${pageSize}&pageToken=${encodeURIComponent(pageToken)}${fieldParam}`;

      const json = await fetchJson(path);
      records.push(...(json.records || []));
      if (!json.nextPageToken) break;
      pageToken = String(json.nextPageToken);
    }

    return records;
  }

  /**
   * Ask the background page to fetch VF HTML (avoids page CORS on vf.force.com redirects).
   */
  async function fetchFeedbackHtml(appointmentId) {
    const api = globalThis.browser ?? globalThis.chrome;
    if (!api?.runtime?.sendMessage) {
      throw new Error('Extension runtime unavailable for feedback fetch');
    }
    const response = await api.runtime.sendMessage({
      type: 'FETCH_FEEDBACK_HTML',
      appointmentId,
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Background feedback fetch failed');
    }
    return { html: response.html, url: response.url };
  }

  /** Used by background.js — not subject to page CORS. */
  async function fetchFeedbackHtmlDirect(appointmentId) {
    const candidates = [
      `https://workday.lightning.force.com/apex/WHT_FeedBackDetail?appointmentId=${encodeURIComponent(appointmentId)}`,
      `https://workday.lightning.force.com/apex/WHT_FeedbackDetail?appointmentId=${encodeURIComponent(appointmentId)}`,
      `https://workday--c.vf.force.com/apex/WHT_FeedBackDetail?appointmentId=${encodeURIComponent(appointmentId)}`,
      `https://workday--c.vf.force.com/apex/WHT_FeedbackDetail?appointmentId=${encodeURIComponent(appointmentId)}`,
    ];
    const errors = [];
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          credentials: 'include',
          redirect: 'follow',
          headers: { Accept: 'text/html' },
        });
        const html = await response.text();
        if (!response.ok) {
          errors.push(`${url} → HTTP ${response.status}`);
          continue;
        }
        if (/Feedback Form|how satisfied|Feedback Details/i.test(html) || html.length > 800) {
          return { html, url: response.url || url };
        }
        errors.push(`${url} → unexpected HTML (${html.length} bytes)`);
      } catch (err) {
        errors.push(`${url} → ${err.message || err}`);
      }
    }
    throw new Error(`Could not load feedback page: ${errors.join('; ')}`);
  }

  window.WohSfApi = {
    API_VERSION,
    RELATED_LIST,
    uiApiRecord,
    fieldValue,
    fieldDisplay,
    relatedListAll,
    fetchFeedbackHtml,
    fetchFeedbackHtmlDirect,
  };
})();
