const api = globalThis.browser ?? globalThis.chrome;

const statusEl = document.getElementById('status');
const subtitleEl = document.getElementById('subtitle');
const retryBtn = document.getElementById('retryBtn');
const accountEl = document.getElementById('account');
const avgEl = document.getElementById('avg');
const resultsEl = document.getElementById('results');

const { isSurveyHostUrl } = window.WohPageContext;

async function getActiveTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Request CSAT row color (English / Japanese / stars):
 * - Very satisfied, 非常に満足, 5 stars → green
 * - Satisfied, 満足, 4 stars → yellow
 * - 3 stars / neither / others → red
 */
function csatRowClass(overallSatisfaction) {
  const text = String(overallSatisfaction || '');
  const value = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    value === 'very satisfied' ||
    text.includes('非常に満足') ||
    text.includes('とても満足') ||
    /5\s*stars?/.test(value) ||
    (text.match(/[★]/g) || []).length >= 5
  ) {
    return 'csat-green';
  }
  if (
    value === 'satisfied' ||
    value === 'やや満足' ||
    (text.includes('満足') && !text.includes('不満') && !text.includes('非常に')) ||
    /4\s*stars?/.test(value) ||
    (text.match(/[★]/g) || []).length === 4
  ) {
    return 'csat-yellow';
  }
  return 'csat-red';
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'className') node.className = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}

function requestLabel(survey) {
  return window.WohRequestNumber?.requestNumberLabel
    ? window.WohRequestNumber.requestNumberLabel(survey)
    : survey.req_number || survey.appointment_name || '—';
}

function externalLink(href, label, title) {
  if (!href || label == null || label === '' || label === '—') return label || '—';
  const attrs = { href, target: '_blank', rel: 'noreferrer' };
  if (title) attrs.title = title;
  return el('a', attrs, label);
}

function reqNode(survey) {
  return externalLink(survey.appointment_url, requestLabel(survey), 'Open request');
}

function csatLinkNode(survey, label) {
  return externalLink(survey.feedback_url, label, 'Open Feedback Details');
}

function renderSurveys(payload) {
  const surveys = payload.surveys || [];
  if (subtitleEl) {
    subtitleEl.textContent =
      payload.page_context === 'account'
        ? '20 most recent surveys for this Account'
        : '10 most recent surveys for this Primary NSC Contact';
  }
  if (payload.page_context === 'appointment') {
    const contactName = String(payload.primary_nsc_contact || '').trim();
    const contactId = String(payload.primary_nsc_id || '').trim();
    accountEl.hidden = !contactName && !contactId;
    accountEl.textContent = contactName
      ? contactId
        ? `Contact: ${contactName} (${contactId})`
        : `Contact: ${contactName}`
      : contactId
        ? `Contact: ${contactId}`
        : '';
  } else if (payload.account_name || payload.account_id) {
    accountEl.hidden = false;
    const decodeText = window.WohHtmlText?.decodeHtmlEntities || ((text) => String(text ?? ''));
    const accountName = payload.account_name ? decodeText(payload.account_name) : '';
    accountEl.textContent = accountName
      ? `Account: ${accountName}`
      : `Account: ${payload.account_id}`;
    if (payload.account_id) {
      accountEl.textContent += ` (${payload.account_id})`;
    }
  } else {
    accountEl.hidden = true;
  }
  if (avgEl) {
    if (payload.csat_average_display) {
      const score = Number(payload.csat_average_display);
      const tone = score > 4.5 ? 'good' : score >= 4.2 ? 'mid' : 'low';
      avgEl.hidden = false;
      avgEl.className = tone === 'good' ? 'avg-badge' : `avg-badge ${tone}`;
      avgEl.textContent = `${payload.csat_average_display}/5`;
      avgEl.title = `Average ${payload.csat_average_display}/5`;
    } else {
      avgEl.hidden = true;
      avgEl.textContent = '';
    }
  }

  if (!surveys.length) {
    const decodeText = window.WohHtmlText?.decodeHtmlEntities || ((text) => String(text ?? ''));
    const contactName = String(payload.primary_nsc_contact || '').trim();
    const accountName = payload.account_name ? decodeText(payload.account_name).trim() : '';
    const emptyText =
      payload.page_context === 'appointment'
        ? contactName
          ? `This customer ${contactName} hasn't submitted CSAT.`
          : 'Primary NSC Contact not found on this request.'
        : accountName
          ? `This account ${accountName} hasn't submitted CSAT.`
          : "This account hasn't submitted CSAT.";
    resultsEl.replaceChildren(el('div', { className: 'empty-csat' }, emptyText));
    return;
  }

  const rows = surveys.map((survey) => {
    if (!survey.ok) {
      return el(
        'tr',
        { className: 'csat-error' },
        el('td', {}, reqNode(survey)),
        el('td', {}, survey.submitted_at || '—'),
        el('td', {}, survey.submitted_by || '—'),
        el('td', {}, survey.error || 'Failed to load')
      );
    }
    return el(
      'tr',
      { className: csatRowClass(survey.overall_satisfaction) },
      el('td', {}, reqNode(survey)),
      el('td', {}, survey.submitted_at || '—'),
      el('td', {}, survey.submitted_by || '—'),
      el('td', {}, csatLinkNode(survey, survey.overall_satisfaction || '—'))
    );
  });

  resultsEl.replaceChildren(
    el(
      'table',
      { className: 'summary' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Request #'),
          el('th', {}, 'Survey date'),
          el('th', {}, 'Customer'),
          el('th', {}, 'Request CSAT')
        )
      ),
      el('tbody', {}, ...rows)
    )
  );
}

api.runtime.onMessage.addListener((message) => {
  if (message?.type === 'SURVEY_PROGRESS' && message.text) {
    statusEl.textContent = message.text;
  }
});

async function ensureContentScripts(tabId) {
  if (!api.tabs?.executeScript) return;
  try {
    await api.tabs.executeScript(tabId, { file: 'content/page-context.js' });
    await api.tabs.executeScript(tabId, { file: 'content/request-number.js' });
    await api.tabs.executeScript(tabId, { file: 'content/scrape-utils.js' });
    await api.tabs.executeScript(tabId, { file: 'content/sf-api.js' });
    await api.tabs.executeScript(tabId, { file: 'content/appointment.js' });
  } catch (_) {
    /* may already be injected */
  }
}

async function loadSurveys() {
  const tab = await getActiveTab();
  if (!isSurveyHostUrl(tab?.url)) {
    statusEl.textContent = 'Open an Appointment (REQ) or Account page first.';
    retryBtn.hidden = true;
    return;
  }

  retryBtn.hidden = true;
  retryBtn.disabled = true;
  resultsEl.replaceChildren();
  accountEl.hidden = true;
  if (avgEl) avgEl.hidden = true;
  statusEl.textContent = 'Loading survey list…';

  try {
    let response;
    try {
      response = await api.tabs.sendMessage(tab.id, { type: 'SHOW_ACCOUNT_SURVEYS' });
    } catch (err) {
      await ensureContentScripts(tab.id);
      response = await api.tabs.sendMessage(tab.id, { type: 'SHOW_ACCOUNT_SURVEYS' });
    }

    if (!response?.ok) {
      statusEl.textContent = response?.error || 'Failed to load surveys.';
      retryBtn.hidden = false;
      return;
    }
    const okCount = (response.surveys || []).filter((s) => s.ok).length;
    statusEl.textContent = `Showing ${okCount} of ${(response.surveys || []).length} most recent surveys.`;
    renderSurveys(response);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}. Reload the Salesforce tab, then click Retry.`;
    retryBtn.hidden = false;
  } finally {
    retryBtn.disabled = false;
  }
}

retryBtn.addEventListener('click', () => {
  loadSurveys();
});

loadSurveys();
