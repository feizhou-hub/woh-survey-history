/**
 * Background: toolbar click opens in-page panel; VF HTML fetch + tab scrape fallback.
 */

if (typeof importScripts === 'function') {
  importScripts('api.js', 'content/page-context.js', 'content/sf-api.js');
}

const api = globalThis.ext || globalThis.browser || globalThis.chrome;
const FEEDBACK_TAB_TIMEOUT_MS = 30000;
const MESSAGE_TIMEOUT_MS = 8000;

const PANEL_SCRIPT_FILES = [
  'content/page-context.js',
  'content/html-text.js',
  'content/primary-nsc.js',
  'content/request-number.js',
  'content/csat-parse.js',
  'content/scrape-utils.js',
  'content/sf-api.js',
  'content/panel.js',
  'content/appointment.js',
];

const { isSurveyHostUrl } = globalThis.WohPageContext;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function useChromeScripting() {
  return Boolean(api.scripting?.executeScript) && !api.tabs?.executeScript;
}

async function injectExtensionFile(tabId, file) {
  if (useChromeScripting()) {
    await api.scripting.executeScript({ target: { tabId }, files: [file] });
    return;
  }
  if (api.tabs?.executeScript) {
    await api.tabs.executeScript(tabId, { file });
  }
}

async function ensureScripts(tabId) {
  if (!useChromeScripting() && !api.tabs?.executeScript) return;
  for (const file of PANEL_SCRIPT_FILES) {
    try {
      await injectExtensionFile(tabId, file);
    } catch (_) {
      /* already injected or transient page state */
    }
  }
}

function paintStatusInPage(message) {
  const msg = String(message || 'Loading…');
  if (window.WohSurveyPanel?.setStatus) {
    window.WohSurveyPanel.setStatus(msg);
    return;
  }
  let host = document.getElementById('woh-account-surveys-panel-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'woh-account-surveys-panel-host';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;top:72px;right:16px;';
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: 'open' });
  }
  const box = document.createElement('div');
  box.setAttribute(
    'style',
    'font:14px -apple-system,sans-serif;background:#fff;border:1px solid #d8dde6;border-radius:10px;padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,.12);min-width:260px;color:#181818;'
  );
  box.textContent = msg;
  host.shadowRoot.replaceChildren(box);
}

async function showInstantPanel(tabId, text) {
  const message = String(text || 'Loading…');
  try {
    if (useChromeScripting()) {
      await api.scripting.executeScript({
        target: { tabId },
        func: paintStatusInPage,
        args: [message],
      });
      return;
    }
    if (!api.tabs?.executeScript) return;
    await api.tabs.executeScript(tabId, {
      code: `(${paintStatusInPage.toString()})(${JSON.stringify(message)})`,
    });
  } catch (_) {
    /* tab may not be injectable yet */
  }
}

function sendMessageWithTimeout(tabId, message, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Extension timed out waiting for the Salesforce page. Reload the tab and try again.'));
    }, timeoutMs);

    api.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      const err = api.runtime.lastError;
      if (err) {
        reject(new Error(err.message || String(err)));
        return;
      }
      resolve(response);
    });
  });
}

async function sendMessageWithRetry(tabId, message, { attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (attempt > 0) {
        await ensureScripts(tabId);
        await delay(250 * attempt);
      }
      return await sendMessageWithTimeout(tabId, message);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Could not reach the page content script');
}

async function openPanelOnActiveTab({ forceRefresh = false } = {}) {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (!isSurveyHostUrl(tab.url || '')) {
    await showInstantPanel(tab.id, 'Open an Appointment (REQ) or Account record page first.');
    return;
  }

  await showInstantPanel(tab.id, 'Loading surveys…');
  await ensureScripts(tab.id);

  try {
    await sendMessageWithRetry(tab.id, {
      type: 'SHOW_ACCOUNT_SURVEYS_PANEL',
      forceRefresh,
    });
  } catch (err) {
    console.error('[WOH Survey]', err);
    await showInstantPanel(tab.id, err.message || 'Failed to open panel. Reload the Salesforce tab and try again.');
    setBadge('!', '#d93025');
  }
}

const actionApi = api.browserAction || api.action;
if (actionApi?.onClicked) {
  actionApi.onClicked.addListener(() => {
    openPanelOnActiveTab().catch((err) => console.error('[WOH Survey]', err));
  });
}

if (api.webNavigation?.onHistoryStateUpdated) {
  api.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    if (!isSurveyHostUrl(details.url || '')) return;
    ensureScripts(details.tabId).catch(() => {});
  });
}

if (api.webNavigation?.onCompleted) {
  api.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;
    if (!isSurveyHostUrl(details.url || '')) return;
    ensureScripts(details.tabId).catch(() => {});
  });
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'WOH_SPA_NAVIGATION') {
    const tabId = _sender.tab?.id;
    if (tabId && isSurveyHostUrl(message.url || '')) {
      ensureScripts(tabId).catch(() => {});
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'SF_QUERY') {
    salesforceQuery(message.soql)
      .then((json) => sendResponse({ ok: true, json }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

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

const SF_API_ORIGIN = 'https://workday.my.salesforce.com';

function isAccountSurveySoql(soql) {
  return globalThis.WohSfApi?.isAccountSurveySoql(soql) === true;
}

async function sidFor(url) {
  if (!api.cookies?.get) return '';
  try {
    const cookie = await api.cookies.get({ url, name: 'sid' });
    return cookie?.value || '';
  } catch (_) {
    return '';
  }
}

function restErrorMessage(json, status) {
  return (Array.isArray(json) && json[0]?.message) || json?.message || `HTTP ${status}`;
}

/**
 * lightning.force.com returns "Session expired or invalid" for /query.
 * The API host accepts the same login when the session id is sent as a bearer token.
 */
async function salesforceQuery(soql) {
  if (!isAccountSurveySoql(soql)) throw new Error('Unsupported survey query');

  const mySid = await sidFor(`${SF_API_ORIGIN}/`);
  const lightningSid = await sidFor('https://workday.lightning.force.com/');
  const tokens = [...new Set([mySid, lightningSid].filter(Boolean))];
  const attempts = [
    ...tokens.map((sid) => ({ sid, credentials: 'omit' })),
    { sid: '', credentials: 'include' },
  ];
  const path = `/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;
  const errors = [];

  for (const attempt of attempts) {
    try {
      const headers = { Accept: 'application/json' };
      if (attempt.sid) headers.Authorization = `Bearer ${attempt.sid}`;
      const response = await fetch(`${SF_API_ORIGIN}${path}`, {
        credentials: attempt.credentials,
        headers,
      });
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {
        /* non-JSON */
      }
      if (!response.ok) {
        errors.push(restErrorMessage(json, response.status));
        continue;
      }
      return json;
    } catch (err) {
      errors.push(String(err.message || err));
    }
  }

  throw new Error(errors[errors.length - 1] || 'Salesforce query failed');
}

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
  const response = await sendMessageWithRetry(tabId, {
    type: 'SCRAPE_FEEDBACK_PAGE',
    appointment,
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'Failed to scrape feedback page');
  }
  return response;
}

function setBadge(text, color) {
  const action = api.browserAction || api.action;
  if (!action) return;
  action.setBadgeText({ text });
  action.setBadgeBackgroundColor({ color });
}
