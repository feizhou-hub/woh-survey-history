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

  function personIdFromFields(fields) {
    const keys = ['User__c', 'User__r', 'Primary_NSC_Contact__c', 'Primary_NSC_Contact__r', 'NSC_Contact__c', 'NSC_Contact__r'];
    for (const key of keys) {
      const id = String(nameFromUiField(fields?.[key]).id || '').trim();
      if (/^(?:003|005)[a-zA-Z0-9]{12,15}$/.test(id)) return id;
    }
    return '';
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
      if (!hit) continue;
      if (!/^(?:003|005)/.test(hit.id)) {
        const id = personIdFromFields(fields);
        if (id) {
          hit.id = id;
          hit.href = recordHref(id);
        }
      }
      return hit;
    }

    for (const apiName of Object.keys(fields)) {
      if (!/nsc/i.test(apiName) || !/contact/i.test(apiName)) continue;
      if (/email/i.test(apiName)) continue;
      const hit = tryField(apiName);
      if (!hit) continue;
      if (!/^(?:003|005)/.test(hit.id)) {
        const id = personIdFromFields(fields);
        if (id) {
          hit.id = id;
          hit.href = recordHref(id);
        }
      }
      return hit;
    }

    return null;
  }

  /**
   * Appointment-page survey query filter.
   * User lookup → Appointment__r.User__c. Otherwise the string
   * Primary_NSC_Contact__c (the field Salesforce actually stores the name in).
   */
  function primaryNscSurveyFilter(primary) {
    if (!primary || typeof primary !== 'object') return null;
    const id = String(primary.id || '').trim();
    const apiName = String(primary.apiName || '');
    const salesforceId = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(id);
    if (salesforceId && (apiName === 'User__c' || apiName === 'User__r' || (id.startsWith('005') && !apiName))) {
      return { field: 'Appointment__r.User__c', value: id };
    }
    const name = cleanPersonName(primary.name);
    if (name) return { field: 'Appointment__r.Primary_NSC_Contact__c', value: name };
    if (salesforceId && apiName === 'Primary_NSC_Contact__c') {
      return { field: 'Appointment__r.Primary_NSC_Contact__c', value: id };
    }
    return null;
  }

  /** Appointment pages keep only surveys this Primary NSC Contact submitted. */
  function surveysSubmittedBy(surveys, primaryName, namesMatch) {
    const name = cleanPersonName(primaryName);
    if (!name || typeof namesMatch !== 'function') return [];
    return (surveys || []).filter((survey) => namesMatch(survey?.submitted_by, name));
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
    primaryNscSurveyFilter,
    surveysSubmittedBy,
    nameFromUiField,
    recordHref,
    PRIMARY_NSC_UI_FIELDS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.WohPrimaryNsc = api;
})(typeof window !== 'undefined' ? window : globalThis);
