/**
 * Which Salesforce record page the extension is on.
 * Shared by the background page, the SPA router, the popup, and content scripts.
 */
(function initWohPageContext(root) {
  function isAppointmentUrl(url = '') {
    return (
      /\/lightning\/r\/Appointment__c\//.test(url) ||
      /\/lightning\/r\/a3N[a-zA-Z0-9]{12,15}(?:\/|$|\?)/.test(url)
    );
  }

  function isAccountUrl(url = '') {
    return (
      /\/lightning\/r\/Account\//i.test(url) ||
      /\/lightning\/r\/001[a-zA-Z0-9]{12,15}(?:\/|$|\?)/.test(url)
    );
  }

  function isSurveyHostUrl(url = '') {
    return isAppointmentUrl(url) || isAccountUrl(url);
  }

  /**
   * Appointment wins when a URL contains both record paths.
   * Encoded workspace params (`ws=%2Flightning%2Fr%2F...`) do not count.
   */
  function detectPageContext(url = '') {
    if (isAppointmentUrl(url)) return 'appointment';
    if (isAccountUrl(url)) return 'account';
    return null;
  }

  const api = {
    isAppointmentUrl,
    isAccountUrl,
    isSurveyHostUrl,
    detectPageContext,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.WohPageContext = api;
})(typeof window !== 'undefined' ? window : globalThis);
