/**
 * Persistent in-page results panel (stays until user clicks X).
 * Cache: browser.storage.local, 12-hour TTL per Account Id.
 */
(function initWohSurveyPanel() {
  const api = globalThis.browser ?? globalThis.chrome;
  const PANEL_ID = 'woh-account-surveys-panel-host';
  const CACHE_KEY = 'accountSurveyCache';
  const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function csatRowClass(overallSatisfaction) {
    if (window.WohScrape?.csatRowClass) {
      return window.WohScrape.csatRowClass(overallSatisfaction);
    }
    const value = String(overallSatisfaction || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    if (value === 'very satisfied' || value.includes('非常に満足') || /5\s*stars?/.test(value) || (String(overallSatisfaction || '').match(/[★]/g) || []).length >= 5) {
      return 'csat-green';
    }
    if (value === 'satisfied' || value === '満足' || value.includes('やや満足') || /4\s*stars?/.test(value)) {
      return 'csat-yellow';
    }
    return 'csat-red';
  }

  async function readCache(accountId) {
    const { [CACHE_KEY]: cache = {} } = await api.storage.local.get(CACHE_KEY);
    const entry = cache[accountId];
    if (!entry?.fetchedAt || !entry?.payload) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
    return entry;
  }

  async function writeCache(accountId, payload) {
    const { [CACHE_KEY]: cache = {} } = await api.storage.local.get(CACHE_KEY);
    cache[accountId] = { fetchedAt: Date.now(), payload };
    // prune expired
    const now = Date.now();
    for (const [id, entry] of Object.entries(cache)) {
      if (!entry?.fetchedAt || now - entry.fetchedAt > CACHE_TTL_MS) delete cache[id];
    }
    await api.storage.local.set({ [CACHE_KEY]: cache });
  }

  function ensureHost() {
    let host = document.getElementById(PANEL_ID);
    if (host) return host;
    host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.zIndex = '2147483646';
    host.style.top = '72px';
    host.style.right = '16px';
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: 'open' });
    return host;
  }

  function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function renderPanel({ statusText, payload, fromCache, error }) {
    const host = ensureHost();
    const root = host.shadowRoot;
    const accountLabel = payload
      ? payload.account_name
        ? `${payload.account_name} (${payload.account_id || ''})`
        : payload.account_id || ''
      : '';

    const cacheNote = fromCache
      ? `<div class="cache">Cached result (valid up to 12 hours). <button type="button" class="linkish" id="woh-refresh">Refresh now</button></div>`
      : '';

    const primaryNotice =
      payload?.primary_nsc_notice
        ? `<div class="notice">${escapeHtml(payload.primary_nsc_notice)}</div>`
        : payload?.primary_nsc_contact && payload?.primary_nsc_matched
          ? `<div class="notice ok">Primary NSC Contact <strong>${escapeHtml(payload.primary_nsc_contact)}</strong> appears in this list (bold).</div>`
          : payload?.primary_nsc_contact
            ? ''
            : `<div class="notice">Primary NSC Contact not found on this request.</div>`;

    let bodyHtml = '';
    if (error) {
      bodyHtml = `<div class="error">${escapeHtml(error)}</div>`;
    } else if (!payload) {
      bodyHtml = `<div class="status-line">${escapeHtml(statusText || 'Loading…')}</div>`;
    } else if (!(payload.surveys || []).length) {
      bodyHtml = `
        <div class="status-line">${escapeHtml(payload.message || 'No surveys found.')}</div>
        ${primaryNotice}
      `;
    } else {
      const rows = (payload.surveys || [])
        .map((survey) => {
          const customerName = escapeHtml(survey.submitted_by || '—');
          const customerCell = survey.is_primary_nsc
            ? `<strong class="primary-nsc">${customerName}</strong>`
            : customerName;

          if (!survey.ok) {
            const label = escapeHtml(survey.req_number || survey.survey_result_name || '—');
            const href = survey.feedback_url || survey.appointment_url || '';
            const reqCell = href
              ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`
              : label;
            return `<tr class="csat-error">
              <td>${reqCell}</td>
              <td>${escapeHtml(survey.submitted_at || '—')}</td>
              <td>${customerCell}</td>
              <td>${escapeHtml(survey.error || 'Failed')}</td>
            </tr>`;
          }
          const reqLabel = escapeHtml(survey.req_number || survey.survey_result_name || '—');
          const detailUrl = survey.feedback_url || '';
          const reqCell = detailUrl
            ? `<a href="${escapeHtml(detailUrl)}" target="_blank" rel="noreferrer">${reqLabel}</a>`
            : reqLabel;
          return `<tr class="${csatRowClass(survey.overall_satisfaction)}">
            <td>${reqCell}</td>
            <td>${escapeHtml(survey.submitted_at || '—')}</td>
            <td>${customerCell}</td>
            <td>${escapeHtml(
              (window.WohScrape?.formatCsatEnglish
                ? window.WohScrape.formatCsatEnglish(survey.overall_satisfaction)
                : survey.overall_satisfaction) || '—'
            )}</td>
          </tr>`;
        })
        .join('');

      bodyHtml = `
        <div class="status-line">${escapeHtml(statusText || '')}</div>
        ${cacheNote}
        ${primaryNotice}
        <table>
          <thead>
            <tr>
              <th>Request #</th>
              <th>Survey date</th>
              <th>Customer</th>
              <th>Request CSAT</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }

    root.innerHTML = `
      <style>
        :host { all: initial; }
        .panel {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          width: min(560px, calc(100vw - 32px));
          max-height: calc(100vh - 96px);
          overflow: auto;
          background: #fff;
          color: #1f1f1f;
          border-radius: 12px;
          box-shadow: 0 8px 28px rgba(0,0,0,.22);
          border: 1px solid #e5e5e5;
        }
        .header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px 8px;
          border-bottom: 1px solid #eee;
          position: sticky;
          top: 0;
          background: #fff;
          z-index: 1;
        }
        .title { font-size: 15px; font-weight: 700; margin: 0; }
        .subtitle { font-size: 12px; color: #666; margin: 2px 0 0; }
        .account { font-size: 12px; font-weight: 600; margin-top: 6px; color: #333; }
        .close {
          border: none;
          background: transparent;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          color: #666;
          padding: 0 4px;
          border-radius: 6px;
        }
        .close:hover { background: #f0f0f0; color: #111; }
        .body { padding: 10px 14px 14px; }
        .status-line { font-size: 12px; color: #555; margin-bottom: 8px; }
        .cache { font-size: 11px; color: #666; margin-bottom: 8px; }
        .notice {
          font-size: 12px;
          margin: 0 0 10px;
          padding: 8px 10px;
          border-radius: 8px;
          background: #fff4e5;
          border: 1px solid #f0d2a0;
          color: #6a4b00;
          line-height: 1.35;
        }
        .notice.ok {
          background: #e8f5e9;
          border-color: #a5d6a7;
          color: #1b5e20;
        }
        .primary-nsc { font-weight: 700; }
        .linkish {
          border: none;
          background: none;
          color: #0176d3;
          cursor: pointer;
          padding: 0;
          font-size: 11px;
          text-decoration: underline;
        }
        .error { color: #b00020; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th {
          text-align: left;
          font-size: 11px;
          color: #555;
          padding: 6px 8px;
          border-bottom: 1px solid #ddd;
          background: #f7f7f7;
        }
        td { padding: 8px; border-bottom: 1px solid #eee; vertical-align: top; }
        a { color: #0176d3; font-weight: 600; text-decoration: none; }
        a:hover { text-decoration: underline; }
        tr.csat-green td { background: #d4edda; }
        tr.csat-yellow td { background: #fff3cd; }
        tr.csat-red td { background: #f8d7da; }
        tr.csat-error td { background: #f5f5f5; color: #666; }
      </style>
      <div class="panel" role="dialog" aria-label="WOH Account Surveys">
        <div class="header">
          <div>
            <p class="title">WOH Account Surveys</p>
            <p class="subtitle">10 most recent surveys for this Account</p>
            ${accountLabel ? `<div class="account">Account: ${escapeHtml(accountLabel)}</div>` : ''}
          </div>
          <button type="button" class="close" id="woh-close" title="Close" aria-label="Close">×</button>
        </div>
        <div class="body">${bodyHtml}</div>
      </div>
    `;

    root.getElementById('woh-close')?.addEventListener('click', closePanel);
    root.getElementById('woh-refresh')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('woh-survey-refresh'));
    });
  }

  window.WohSurveyPanel = {
    CACHE_TTL_MS,
    readCache,
    writeCache,
    renderPanel,
    closePanel,
    setStatus(text) {
      renderPanel({ statusText: text, payload: null });
    },
    showPayload(payload, { fromCache = false, statusText = '' } = {}) {
      const okCount = (payload.surveys || []).filter((s) => s.ok).length;
      const total = (payload.surveys || []).length;
      renderPanel({
        payload,
        fromCache,
        statusText:
          statusText ||
          (fromCache
            ? `Showing ${okCount} of ${total} surveys (from cache).`
            : `Showing ${okCount} of ${total} most recent surveys.`),
      });
    },
    showError(error) {
      renderPanel({ error: String(error), payload: null });
    },
  };
})();
