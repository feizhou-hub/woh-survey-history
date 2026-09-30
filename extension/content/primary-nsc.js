/**
 * Pure helpers for resolving Primary NSC Contact (no DOM).
 * Shared by content scripts and Node tests.
 *
 * In Salesforce:
 * - Primary_NSC_Contact__c is a String (person name), often omitted from Full layout
 * - User__c / User__r is a User lookup also labeled "Primary NSC Contact"
 */
(function initWohPrimaryNsc(root) {
  function cleanPersonName(raw) {
    const name = String(raw || '')
      .replace(/\b(Preview|Open|Show More|Edit|Clear Selection)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name || name.length < 2 || name.length > 80) return '';
    if (/@/.test(name) || /^primary nsc/i.test(name)) return '';
    return name;
  }

  function recordHref(id) {
    if (!id) return '';
    if (/^005/.test(id)) return `/lightning/r/User/${id}/view`;
    if (/^003/.test(id)) return `/lightning/r/Contact/${id}/view`;
    return `/lightning/r/${id}/view`;
  }

  function nameFromUiField(field) {
    if (!field) return { name: '', id: '' };
    let name = field.displayValue || '';
    let id = '';
    const val = field.value;

    if (val && typeof val === 'object') {
      id = val.id || val.fields?.Id?.value || '';
      name =
        name ||
        val.fields?.Name?.displayValue ||
        val.fields?.Name?.value ||
        val.displayValue ||
        '';
    } else if (typeof val === 'string') {
      if (/^(003|005)[a-zA-Z0-9]{12,15}$/.test(val)) {
        id = val;
      } else if (!name) {
        // String field storing the person name (Primary_NSC_Contact__c)
        name = val;
      }
    }

    return { name: cleanPersonName(name), id: id || '' };
  }

  /**
   * Pull Primary NSC Contact from a UI API record payload.
   * Prefers known API names, then User__r, then any *NSC*Contact* field (not email).
   */
  function extractPrimaryNscFromUiRecord(record) {
    const fields = record?.fields || {};
    const preferred = [
      'Primary_NSC_Contact__c',
      'User__r',
      'User__c',
      'Primary_NSC_Contact__r',
      'NSC_Contact__c',
      'NSC_Contact__r',
    ];

    const tryField = (apiName) => {
      const { name, id } = nameFromUiField(fields[apiName]);
      if (!name) return null;
      return {
        name,
        id,
        href: recordHref(id),
        source: 'ui_api',
        apiName,
      };
    };

    for (const apiName of preferred) {
      const hit = tryField(apiName);
      if (hit) return hit;
    }

    for (const apiName of Object.keys(fields)) {
      if (!/nsc/i.test(apiName) || !/contact/i.test(apiName)) continue;
      if (/email/i.test(apiName)) continue;
      const hit = tryField(apiName);
      if (hit) return hit;
    }

    return null;
  }

  /** Field list for an explicit UI API fetch (Full layout often omits these). */
  const PRIMARY_NSC_UI_FIELDS = [
    'Appointment__c.Primary_NSC_Contact__c',
    'Appointment__c.Primary_NSC_Email__c',
    'Appointment__c.User__c',
    'Appointment__c.User__r.Name',
  ];

  const api = {
    cleanPersonName,
    extractPrimaryNscFromUiRecord,
    nameFromUiField,
    recordHref,
    PRIMARY_NSC_UI_FIELDS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.WohPrimaryNsc = api;
})(typeof window !== 'undefined' ? window : globalThis);
