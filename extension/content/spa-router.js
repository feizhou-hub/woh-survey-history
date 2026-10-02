/**
 * Detects Lightning SPA navigations and asks the background to inject scripts
 * on Appointment and Account record pages (content_scripts only run on full page loads).
 */
(function initSpaRouter() {
  if (window.__wohSpaRouterInit) return;
  window.__wohSpaRouterInit = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const { isSurveyHostUrl } = window.WohPageContext;

  function notifyBackground(url) {
    try {
      const pending = api.runtime.sendMessage({ type: 'WOH_SPA_NAVIGATION', url });
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (_) {
      /* background worker may still be starting */
    }
  }

  let lastUrl = location.href;

  function onUrlMaybeChanged() {
    const url = location.href;
    if (url === lastUrl) return;
    lastUrl = url;
    if (isSurveyHostUrl(url)) notifyBackground(url);
  }

  const wrapHistory = (method) => {
    const original = history[method];
    if (typeof original !== 'function') return;
    history[method] = function (...args) {
      const result = original.apply(this, args);
      onUrlMaybeChanged();
      return result;
    };
  };

  wrapHistory('pushState');
  wrapHistory('replaceState');
  window.addEventListener('popstate', onUrlMaybeChanged);

  // Lightning sometimes routes without touching history immediately.
  setInterval(onUrlMaybeChanged, 800);

  if (isSurveyHostUrl(location.href)) {
    notifyBackground(location.href);
  }
})();
