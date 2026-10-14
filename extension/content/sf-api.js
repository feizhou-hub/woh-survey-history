/**
 * Salesforce Lightning UI API helpers (uses the logged-in browser session).
 */
(function initWohSfApi(root) {
  const API_VERSION = 'v59.0';
  const RELATED_LIST = 'WOH_Survey_Results__r';
  const SURVEY_OBJECT = 'WOH_Survey_Result__c';
  const SURVEY_RELATIONSHIP = 'WOH_Survey_Results';

  async function fetchJson(pathOrUrl) {
    const url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${location.origin}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
    const response = await fetch(url, { credentials: 'include' });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      /* non-JSON */
    }
    if (!response.ok) {
      const message =
        (Array.isArray(json) && json[0]?.message) ||
        json?.message ||
        `HTTP ${response.status}`;
      throw new Error(message);
    }
    return json;
  }

  async function uiApiRecord(recordId) {
    return fetchJson(
      `/services/data/${API_VERSION}/ui-api/records/${encodeURIComponent(recordId)}?layoutTypes=Full&modes=View`
    );
  }

  /** Fetch specific fields (use when Full layout omits them). */
  async function uiApiRecordFields(recordId, fields) {
    const list = Array.isArray(fields) ? fields.filter(Boolean) : [];
    if (!list.length) return uiApiRecord(recordId);
    const param = list.map(encodeURIComponent).join(',');
    return fetchJson(
      `/services/data/${API_VERSION}/ui-api/records/${encodeURIComponent(recordId)}?fields=${param}`
    );
  }

  function fieldValue(record, apiName) {
    const field = record?.fields?.[apiName];
    if (!field) return null;
    if (field.value != null && typeof field.value === 'object' && 'value' in field.value) {
      return field.value.value;
    }
    return field.value ?? field.displayValue ?? null;
  }

  function decodeDisplayText(text) {
    if (window.WohHtmlText?.decodeHtmlEntities) {
      return window.WohHtmlText.decodeHtmlEntities(text);
    }
    return text == null ? '' : String(text);
  }

  function fieldDisplay(record, apiName) {
    const field = record?.fields?.[apiName];
    if (!field) return '';
    if (field.displayValue) return decodeDisplayText(field.displayValue);
    const value = fieldValue(record, apiName);
    return value == null ? '' : decodeDisplayText(String(value));
  }

  /**
   * Child lookup on WOH_Survey_Result__c that the Account related list
   * WOH_Survey_Results__r is built from. Describe does not depend on
   * that list being present on the record type's page layout.
   */
  function surveyLookupFieldFromDescribe(desc) {
    const rel = (desc?.childRelationships || []).find((row) => {
      const child = row?.childSObject || row?.childObjectApiName;
      const name = row?.relationshipName || '';
      return (
        child === SURVEY_OBJECT &&
        (name === SURVEY_RELATIONSHIP || name === `${SURVEY_RELATIONSHIP}__r`)
      );
    });
    return rel?.field || rel?.fieldName || null;
  }

  function isRecentSurveySoql(soql) {
    const id = "[a-zA-Z0-9]{15,18}";
    const contactPredicate =
      `Appointment__r\\.User__c = '${id}'|Appointment__r\\.Primary_NSC_Contact__c = '(?:[^'\\\\]|\\\\.){1,160}'`;
    const ownAccount = `[A-Za-z][A-Za-z0-9_]* = '${id}'`;
    const eitherAccount = `\\(${ownAccount} OR Appointment__r\\.Account__c = '${id}'\\)`;
    const where =
      `(?:(?:${eitherAccount}|${ownAccount})(?: AND (?:${contactPredicate}))?|${contactPredicate})`;
    return (
      typeof soql === 'string' &&
      soql.length < 2000 &&
      new RegExp(
        '^SELECT Id, Name, Appointment__c, Appointment__r\\.Name(?:, Appointment__r\\.[A-Za-z][A-Za-z0-9_]*(?:\\.Name)?)?, Date_Time_Survey_Submitted__c FROM WOH_Survey_Result__c WHERE ' +
          where +
          ' ORDER BY Date_Time_Survey_Submitted__c DESC NULLS LAST LIMIT \\d{1,2}$'
      ).test(soql)
    );
  }

  function isReturnRatioCountSoql(soql) {
    const id = "[a-zA-Z0-9]{15,18}";
    const name = "(?:[^'\\\\]|\\\\.){1,160}";
    const contact = `(?:(?:Appointment__r\\.)?User__c = '${id}'|(?:Appointment__r\\.)?Primary_NSC_Contact__c = '${name}')`;
    const account = `[A-Za-z][A-Za-z0-9_]* = '${id}'`;
    return (
      typeof soql === 'string' &&
      soql.length < 500 &&
      new RegExp(
        `^SELECT COUNT\\(\\) FROM (?:WOH_Survey_Result__c|Appointment__c) WHERE (?:${account}(?: AND ${contact})?|${contact})$`
      ).test(soql)
    );
  }

  function isAccountSurveySoql(soql) {
    return isRecentSurveySoql(soql) || isReturnRatioCountSoql(soql);
  }

  function soqlStringLiteral(value) {
    return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }

  /** Appointment-page only. Account queries pass null and stay account-scoped. */
  function primaryNscWhereClause(contactFilter) {
    if (!contactFilter) return '';
    const field = String(contactFilter.field || '');
    const value = String(contactFilter.value || '');
    if (field === 'Appointment__r.User__c') {
      if (!/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(value)) {
        throw new Error('Invalid Primary NSC Contact');
      }
      return ` AND ${field} = '${value}'`;
    }
    if (field === 'Appointment__r.Primary_NSC_Contact__c') {
      if (!value || value.length > 80 || /[\u0000-\u001f]/.test(value)) {
        throw new Error('Invalid Primary NSC Contact');
      }
      return ` AND ${field} = ${soqlStringLiteral(value)}`;
    }
    throw new Error('Invalid Primary NSC Contact field');
  }

  /**
   * SOQL fragment for the Appointment field labeled Request (REQ- / OPR-).
   * Appointment.Name is the APP-##### record name, which is not that number.
   */
  function appointmentRequestSelect(info) {
    const fields = info?.fields;
    if (!fields || typeof fields !== 'object') return '';
    const rows = Array.isArray(fields) ? fields : Object.values(fields);
    const matches = rows.filter((field) => {
      const apiName = String(field?.apiName || '');
      const label = String(field?.label || '').trim();
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName) || apiName === 'Name') return false;
      return (
        /^request(?: number|#)?$/i.test(label) ||
        /^(?:Request__c|Request_Number__c|Req_Number__c|Req__c)$/.test(apiName)
      );
    });
    const field =
      matches.find((row) => /^request$/i.test(String(row.label || '').trim())) || matches[0];
    if (!field) return '';
    if (/reference/i.test(String(field.dataType || ''))) {
      const rel = String(field.relationshipName || '');
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(rel)) return '';
      return `Appointment__r.${rel}.Name`;
    }
    return `Appointment__r.${field.apiName}`;
  }

  function assertSalesforceId(value, label) {
    if (!/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(String(value || ''))) {
      throw new Error(`Invalid ${label}`);
    }
  }

  function assertLookupField(lookupField) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(String(lookupField || ''))) {
      throw new Error('Invalid survey lookup field');
    }
  }

  /**
   * Survey-result count. Account pages pass no contact filter and count
   * Account__c. Appointment pages pass the User id and count that contact
   * with no Account__c predicate.
   */
  function surveyCountSoql(accountId, lookupField, contactFilter = null) {
    if (contactFilter) {
      const where = primaryNscWhereClause(contactFilter).replace(/^ AND /, '');
      if (!where) throw new Error('Invalid Primary NSC Contact');
      return `SELECT COUNT() FROM ${SURVEY_OBJECT} WHERE ${where}`;
    }
    assertSalesforceId(accountId, 'Account Id');
    assertLookupField(lookupField);
    return `SELECT COUNT() FROM ${SURVEY_OBJECT} WHERE ${lookupField} = '${accountId}'`;
  }

  /**
   * Appointment count. Account pages count Account__c. Appointment pages
   * count User__c for the Primary NSC Contact, with no Account__c predicate.
   * The contact filter is written for survey queries (Appointment__r.User__c);
   * Appointment__c stores that field directly.
   */
  function appointmentCountSoql(accountId, contactFilter = null) {
    if (contactFilter) {
      const where = primaryNscWhereClause(contactFilter).replace(/^ AND /, '').replace('Appointment__r.', '');
      if (!where) throw new Error('Invalid Primary NSC Contact');
      return `SELECT COUNT() FROM Appointment__c WHERE ${where}`;
    }
    assertSalesforceId(accountId, 'Account Id');
    return `SELECT COUNT() FROM Appointment__c WHERE Account__c = '${accountId}'`;
  }

  function countFromQueryResult(json) {
    const count = json?.totalSize;
    if (!Number.isInteger(count) || count < 0) return null;
    return count;
  }

  /** Return ratio = whole CSAT count / total requests. No requests → em dash. */
  function returnRatioSummary(csatCount, requestCount) {
    const csat = Number(csatCount);
    const requests = Number(requestCount);
    if (!Number.isInteger(csat) || csat < 0 || !Number.isInteger(requests) || requests < 0) {
      return {
        csat_count: null,
        request_count: null,
        return_ratio: null,
        return_ratio_display: '',
      };
    }
    if (requests === 0) {
      return {
        csat_count: csat,
        request_count: 0,
        return_ratio: null,
        return_ratio_display: '—',
      };
    }
    const ratio = csat / requests;
    return {
      csat_count: csat,
      request_count: requests,
      return_ratio: ratio,
      return_ratio_display: `${(ratio * 100).toFixed(1)}%`,
    };
  }

  function recentSurveySoql(accountId, lookupField, limit, requestSelect = '', contactFilter = null) {
    const extra = String(requestSelect || '').trim();
    if (extra && !/^Appointment__r\.[A-Za-z][A-Za-z0-9_]*(?:\.Name)?$/.test(extra)) {
      throw new Error('Invalid appointment request field');
    }
    const n = Math.min(Math.max(Number(limit) || 10, 1), 50);
    let where;
    if (contactFilter) {
      // Appointment pages follow the Primary NSC Contact across accounts.
      // A blank Account__c on the survey result must not drop the row.
      where = primaryNscWhereClause(contactFilter).replace(/^ AND /, '');
      if (!where || /\bAND\b/.test(where.slice(0, 4))) {
        throw new Error('Invalid Primary NSC Contact');
      }
    } else {
      if (!/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(String(accountId || ''))) {
        throw new Error('Invalid Account Id');
      }
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(String(lookupField || ''))) {
        throw new Error('Invalid survey lookup field');
      }
      // Survey Result.Account__c is sometimes blank. The appointment still
      // points at the account, so include those rows on the account page.
      where = `(${lookupField} = '${accountId}' OR Appointment__r.Account__c = '${accountId}')`;
    }
    return (
      'SELECT Id, Name, Appointment__c, Appointment__r.Name' +
      (extra ? `, ${extra}` : '') +
      ', Date_Time_Survey_Submitted__c ' +
      `FROM ${SURVEY_OBJECT} ` +
      `WHERE ${where} ` +
      'ORDER BY Date_Time_Survey_Submitted__c DESC NULLS LAST ' +
      `LIMIT ${n}`
    );
  }

  function relationFieldsFromSoql(rel) {
    const fields = {};
    if (!rel || typeof rel !== 'object') return fields;
    for (const [key, value] of Object.entries(rel)) {
      if (key === 'attributes' || value == null) continue;
      if (typeof value === 'string' || typeof value === 'number') {
        fields[key] = { value: String(value), displayValue: String(value) };
        continue;
      }
      if (typeof value === 'object') {
        const nestedName = value.Name || '';
        if (!nestedName) continue;
        fields[key] = {
          displayValue: String(nestedName),
          value: { fields: { Name: { value: String(nestedName), displayValue: String(nestedName) } } },
        };
      }
    }
    return fields;
  }

  /** SOQL rows → the UI API record shape the survey panel already reads. */
  function soqlSurveyToUiRecord(row) {
    const name = row?.Name || '';
    const appointmentId = row?.Appointment__c || null;
    const relFields = relationFieldsFromSoql(row?.Appointment__r);
    const appointmentName = relFields.Name?.value || '';
    const submitted = row?.Date_Time_Survey_Submitted__c || '';
    return {
      id: row?.Id || '',
      fields: {
        Name: { value: name, displayValue: name },
        Appointment__c: { value: appointmentId, displayValue: appointmentName },
        Appointment__r: Object.keys(relFields).length
          ? { displayValue: appointmentName, value: { fields: relFields } }
          : null,
        Date_Time_Survey_Submitted__c: { value: submitted, displayValue: submitted },
      },
    };
  }

  let surveyLookupFieldPromise = null;
  let appointmentRequestSelectPromise = null;

  async function cachedAppointmentRequestSelect() {
    if (!appointmentRequestSelectPromise) {
      appointmentRequestSelectPromise = fetchJson(
        `/services/data/${API_VERSION}/ui-api/object-info/Appointment__c`
      )
        .then((info) => appointmentRequestSelect(info))
        .catch((err) => {
          appointmentRequestSelectPromise = null;
          throw err;
        });
    }
    return appointmentRequestSelectPromise;
  }

  async function surveyAccountLookupField() {
    if (!surveyLookupFieldPromise) {
      surveyLookupFieldPromise = fetchJson(`/services/data/${API_VERSION}/ui-api/object-info/Account`)
        .then((desc) => {
          const field = surveyLookupFieldFromDescribe(desc);
          if (!field) throw new Error('Could not find the Account lookup on WOH Survey Result');
          return field;
        })
        .catch((err) => {
          surveyLookupFieldPromise = null;
          throw err;
        });
    }
    return surveyLookupFieldPromise;
  }

  /**
   * Run SOQL from the extension background against the API host.
   * lightning.force.com rejects /query with "Session expired or invalid"
   * even while the UI API session on that page is still valid.
   */
  async function fetchAccountSurveyQuery(soql) {
    const ext = globalThis.browser ?? globalThis.chrome;
    if (!ext?.runtime?.sendMessage) {
      throw new Error('Extension runtime unavailable for survey query');
    }
    const response = await ext.runtime.sendMessage({ type: 'SF_QUERY', soql });
    if (!response?.ok) throw new Error(response?.error || 'Salesforce query failed');
    return response.json;
  }

  /**
   * Newest survey-result rows.
   * Account pages include a survey when its own account lookup matches, or
   * when that lookup is blank and the appointment belongs to the account.
   * Appointment pages pass contactFilter and filter only by that Primary NSC
   * Contact. SOQL avoids the related-list UI API, which only serves lists on
   * the record type page layout.
   */
  async function queryRecentSurveys(accountId, limit = 10, contactFilter = null) {
    const lookupField = await surveyAccountLookupField();
    let requestSelect = '';
    try {
      requestSelect = await cachedAppointmentRequestSelect();
    } catch (err) {
      console.warn('[WOH Survey] Appointment request-field lookup failed', err);
    }
    const soql = recentSurveySoql(accountId, lookupField, limit, requestSelect, contactFilter);
    const json = await fetchAccountSurveyQuery(soql);
    return (json.records || []).map(soqlSurveyToUiRecord);
  }

  /**
   * Return ratio counts. Account pages count the account. Appointment pages
   * count the Primary NSC Contact's User id, with no Account__c predicate.
   */
  async function queryReturnRatio(accountId, contactFilter = null) {
    const lookupField = await surveyAccountLookupField();
    const [surveyJson, requestJson] = await Promise.all([
      fetchAccountSurveyQuery(surveyCountSoql(accountId, lookupField, contactFilter)),
      fetchAccountSurveyQuery(appointmentCountSoql(accountId, contactFilter)),
    ]);
    const csatCount = countFromQueryResult(surveyJson);
    const requestCount = countFromQueryResult(requestJson);
    if (csatCount == null || requestCount == null) {
      throw new Error('Salesforce count query returned no total');
    }
    return returnRatioSummary(csatCount, requestCount);
  }

  /**
   * Page through a related list until exhausted (or maxPages).
   */
  async function relatedListAll(parentId, relatedListId = RELATED_LIST, fields = [], { pageSize = 50, maxPages = 40 } = {}) {
    const fieldParam = fields.length ? `&fields=${fields.map(encodeURIComponent).join(',')}` : '';
    let pageToken = '0';
    const records = [];

    for (let page = 0; page < maxPages; page++) {
      const path =
        `/services/data/${API_VERSION}/ui-api/related-list-records/` +
        `${encodeURIComponent(parentId)}/${encodeURIComponent(relatedListId)}` +
        `?pageSize=${pageSize}&pageToken=${encodeURIComponent(pageToken)}${fieldParam}`;

      const json = await fetchJson(path);
      records.push(...(json.records || []));
      if (!json.nextPageToken) break;
      pageToken = String(json.nextPageToken);
    }

    return records;
  }

  /**
   * Ask the background page to fetch VF HTML (avoids page CORS on vf.force.com redirects).
   */
  async function fetchFeedbackHtml(appointmentId) {
    const api = globalThis.browser ?? globalThis.chrome;
    if (!api?.runtime?.sendMessage) {
      throw new Error('Extension runtime unavailable for feedback fetch');
    }
    const response = await api.runtime.sendMessage({
      type: 'FETCH_FEEDBACK_HTML',
      appointmentId,
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Background feedback fetch failed');
    }
    return { html: response.html, url: response.url };
  }

  /** Used by background.js — not subject to page CORS. */
  async function fetchFeedbackHtmlDirect(appointmentId) {
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

  const api = {
    API_VERSION,
    RELATED_LIST,
    uiApiRecord,
    uiApiRecordFields,
    fieldValue,
    fieldDisplay,
    surveyLookupFieldFromDescribe,
    appointmentRequestSelect,
    isAccountSurveySoql,
    primaryNscWhereClause,
    recentSurveySoql,
    surveyCountSoql,
    appointmentCountSoql,
    countFromQueryResult,
    returnRatioSummary,
    soqlSurveyToUiRecord,
    queryRecentSurveys,
    queryReturnRatio,
    relatedListAll,
    fetchFeedbackHtml,
    fetchFeedbackHtmlDirect,
  };
  root.WohSfApi = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
