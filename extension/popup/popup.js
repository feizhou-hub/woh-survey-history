const api = globalThis.browser ?? globalThis.chrome;

const statusEl = document.getElementById('status');
const retryBtn = document.getElementById('retryBtn');
const accountEl = document.getElementById('account');
const resultsEl = document.getElementById('results');

function isAppointmentUrl(url = '') {
  return (
    /\/lightning\/r\/Appointment__c\//.test(url) ||
    /\/lightning\/r\/a3N[a-zA-Z0-9]{12,15}(?:\/|$|\?)/.test(url)
  );
}

async function getActiveTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function renderSurveys(payload) {
  const surveys = payload.surveys || [];
  if (payload.account_name || payload.account_id) {
    accountEl.hidden = false;
    accountEl.textContent = payload.account_name
      ? `Account: ${payload.account_name}`
      : `Account: ${payload.account_id}`;
    if (payload.account_id) {
      accountEl.textContent += ` (${payload.account_id})`;
    }
  } else {
    accountEl.hidden = true;
  }

  if (!surveys.length) {
    resultsEl.innerHTML = `<div class="meta">${escapeHtml(payload.message || 'No surveys found.')}</div>`;
    return;
  }

  const rows = surveys
    .map((survey) => {
      if (!survey.ok) {
        const label = escapeHtml(survey.req_number || survey.survey_result_name || survey.appointment_id || '—');
        const detailHref = survey.feedback_url || survey.appointment_url || '';
        const reqCell = detailHref
          ? `<a href="${escapeHtml(detailHref)}" target="_blank" rel="noreferrer">${label}</a>`
          : label;
        return `<tr class="csat-error">
          <td>${reqCell}</td>
          <td>${escapeHtml(survey.submitted_at || '—')}</td>
          <td>${escapeHtml(survey.submitted_by || '—')}</td>
          <td>${escapeHtml(survey.error || 'Failed to load')}</td>
        </tr>`;
      }

      const reqLabel = escapeHtml(survey.req_number || survey.survey_result_name || '—');
      const detailUrl = survey.feedback_url || '';
      const reqCell = detailUrl
        ? `<a href="${escapeHtml(detailUrl)}" target="_blank" rel="noreferrer" title="Open survey detail">${reqLabel}</a>`
        : reqLabel;

      const rowClass = csatRowClass(survey.overall_satisfaction);
      return `<tr class="${rowClass}">
        <td>${reqCell}</td>
        <td>${escapeHtml(survey.submitted_at || '—')}</td>
        <td>${escapeHtml(survey.submitted_by || '—')}</td>
        <td>${escapeHtml(survey.overall_satisfaction || '—')}</td>
      </tr>`;
    })
    .join('');

  resultsEl.innerHTML = `
    <table class="summary">
      <thead>
        <tr>
          <th>Request #</th>
          <th>Survey date</th>
          <th>Customer</th>
          <th>Request CSAT</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

api.runtime.onMessage.addListener((message) => {
  if (message?.type === 'SURVEY_PROGRESS' && message.text) {
    statusEl.textContent = message.text;
  }
});

async function ensureContentScripts(tabId) {
  if (!api.tabs?.executeScript) return;
  try {
    await api.tabs.executeScript(tabId, { file: 'content/scrape-utils.js' });
    await api.tabs.executeScript(tabId, { file: 'content/sf-api.js' });
    await api.tabs.executeScript(tabId, { file: 'content/appointment.js' });
  } catch (_) {
    /* may already be injected */
  }
}

async function loadSurveys() {
  const tab = await getActiveTab();
  if (!isAppointmentUrl(tab?.url)) {
    statusEl.textContent = 'Open an Appointment (REQ) page first.';
    retryBtn.hidden = true;
    return;
  }

  retryBtn.hidden = true;
  retryBtn.disabled = true;
  resultsEl.innerHTML = '';
  accountEl.hidden = true;
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
