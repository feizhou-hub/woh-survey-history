/**
 * Background: toolbar click opens in-page panel; VF HTML fetch + tab scrape fallback.
 */

if (typeof importScripts === 'function') {
  importScripts('api.js');
}

const api = globalThis.ext || globalThis.browser || globalThis.chrome;
const FEEDBACK_TAB_TIMEOUT_MS = 30000;

function isAppointmentUrl(url = '') {
  return (
    /\/lightning\/r\/Appointment__c\//.test(url) ||
    /\/lightning\/r\/a3N[a-zA-Z0-9]{12,15}(?:\/|$|\?)/.test(url)
  );
}

async function ensureScripts(tabId) {
  if (!api.tabs?.executeScript) return;
  const files = [
    'content/scrape-utils.js',
    'content/sf-api.js',
    'content/panel.js',
    'content/appointment.js',
  ];
  for (const file of files) {
    try {
      await api.tabs.executeScript(tabId, { file });
    } catch (_) {
      /* already injected or page mismatch */
    }
  }
}

async function openPanelOnActiveTab({ forceRefresh = false } = {}) {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (!isAppointmentUrl(tab.url || '')) {
    // Still try to notify if content script exists; otherwise no-op
    try {
      await api.tabs.sendMessage(tab.id, {
        type: 'SHOW_ACCOUNT_SURVEYS_PANEL',
        forceRefresh,
        notAppointment: true,
      });
    } catch (_) {
      /* ignore */
    }
    return;
  }

  try {
    await api.tabs.sendMessage(tab.id, { type: 'SHOW_ACCOUNT_SURVEYS_PANEL', forceRefresh });
  } catch (_) {
    await ensureScripts(tab.id);
    await api.tabs.sendMessage(tab.id, { type: 'SHOW_ACCOUNT_SURVEYS_PANEL', forceRefresh });
  }
}

const actionApi = api.browserAction || api.action;
if (actionApi?.onClicked) {
  actionApi.onClicked.addListener(() => {
    openPanelOnActiveTab().catch((err) => console.error('[WOH Survey]', err));
  });
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_FEEDBACK_HTML') {
    fetchFeedbackHtmlDirect(message.appointmentId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (message.type === 'SCRAPE_FEEDBACK_TAB_ONLY') {
    openFeedbackAndScrapeOnly(message.appointmentId, message.feedbackUrl)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (message.type === 'REQUEST_ACCOUNT_SURVEYS') {
    openPanelOnActiveTab({ forceRefresh: Boolean(message.forceRefresh) })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }
});

async function fetchFeedbackHtmlDirect(appointmentId) {
  if (!appointmentId) throw new Error('Missing appointmentId');

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

async function openFeedbackAndScrapeOnly(appointmentId, feedbackUrl) {
  if (!feedbackUrl) {
    throw new Error('No feedback URL');
  }

  const tab = await api.tabs.create({ url: feedbackUrl, active: false });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      api.tabs.remove(tab.id).catch(() => {});
      reject(new Error('Timed out waiting for feedback page'));
    }, FEEDBACK_TAB_TIMEOUT_MS);

    function onUpdated(tabId, info) {
      if (tabId !== tab.id || info.status !== 'complete') return;

      scrapeFeedbackInTab(tab.id, { appointment_id: appointmentId })
        .then(async (result) => {
          cleanup();
          await api.tabs.remove(tab.id).catch(() => {});
          resolve({ ok: true, record: result.record });
        })
        .catch((err) => {
          cleanup();
          api.tabs.remove(tab.id).catch(() => {});
          reject(err);
        });
    }

    function cleanup() {
      clearTimeout(timeout);
      api.tabs.onUpdated.removeListener(onUpdated);
    }

    api.tabs.onUpdated.addListener(onUpdated);
  });
}

async function scrapeFeedbackInTab(tabId, appointment) {
  await delay(2000);
  const response = await api.tabs.sendMessage(tabId, {
    type: 'SCRAPE_FEEDBACK_PAGE',
    appointment,
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'Failed to scrape feedback page');
  }
  return response;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
