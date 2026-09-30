/**
 * Request # column: show the request number (REQ- / OPR-).
 * Appointment record names (APP-#####) and survey result names (WOH SR-#####) are not request numbers.
 */
(function initWohRequestNumber(root) {
  function extractAppointmentNumber(text) {
    const match = String(text || '').match(/\b(?:REQ|OPR)-\d+\b/i);
    if (!match) return '';
    return match[0].toUpperCase();
  }

  function isAppNumber(value) {
    return /^APP-\d+$/i.test(String(value || '').trim());
  }

  function isSalesforceId(value) {
    return /^(?:a3N|a08|001|003|005)[a-zA-Z0-9]{12,15}$/.test(String(value || ''));
  }

  function isSurveyResultName(value) {
    return /WOH\s*SR[- ]?\d+/i.test(String(value || ''));
  }

  function firstRequestNumber(values) {
    for (const value of values) {
      const hit = extractAppointmentNumber(value);
      if (hit) return hit;
    }
    return '';
  }

  function usableAppointmentName(value) {
    const text = String(value || '').trim();
    if (!text || isSalesforceId(text) || isSurveyResultName(text) || isAppNumber(text)) return '';
    return extractAppointmentNumber(text) || text;
  }

  function appointmentNameFromRelatedRecord(record) {
    const relFields = record?.fields?.Appointment__r?.value?.fields || {};
    const nested = [];
    for (const [key, field] of Object.entries(relFields)) {
      if (key === 'Name') continue;
      nested.push(field?.displayValue, field?.value);
      const innerName = field?.value?.fields?.Name;
      nested.push(innerName?.displayValue, innerName?.value);
    }
    const fromNested = firstRequestNumber(nested);
    if (fromNested) return fromNested;

    const lookup = record?.fields?.Appointment__c;
    const fromLookup = usableAppointmentName(lookup?.displayValue);
    if (fromLookup) return fromLookup;

    const rel = record?.fields?.Appointment__r;
    const relName =
      rel?.displayValue ||
      rel?.value?.fields?.Name?.displayValue ||
      rel?.value?.fields?.Name?.value ||
      '';
    return usableAppointmentName(relName);
  }

  function requestNumberLabel(survey) {
    return (
      firstRequestNumber([
        survey?.req_number,
        survey?.appointment_name,
        survey?.survey_result_name,
      ]) || '—'
    );
  }

  const api = {
    extractAppointmentNumber,
    isAppNumber,
    isSurveyResultName,
    firstRequestNumber,
    usableAppointmentName,
    appointmentNameFromRelatedRecord,
    requestNumberLabel,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.WohRequestNumber = api;
})(typeof window !== 'undefined' ? window : globalThis);
