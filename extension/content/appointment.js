/**
 * Runs on Appointment__c and Account record pages.
 * Both pages call loadSurveysForPage(). Appointment pages load that request's
 * Primary NSC Contact's newest 10 surveys. Account pages load the account's
 * newest 20 and average Request CSAT. Both pages also show the return
 * ratio: every CSAT survey divided by every request. Results stay cached for 12 hours.
 */

(async function initAppointmentScraper() {
  if (window.__wohAppointmentScraperInit) return;
  window.__wohAppointmentScraperInit = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const { parseAppointmentId, parseAccountId, findAccountOnPage, findPrimaryNscContact, namesMatch, parseFeedbackHtml, waitFor, getFieldByLabel } =
    window.WohScrape;
  const { detectPageContext } = window.WohPageContext;
  const { uiApiRecord, uiApiRecordFields, fieldValue, fieldDisplay, queryRecentSurveys, fetchFeedbackHtml } =
    window.WohSfApi;
  const { extractPrimaryNscFromUiRecord, primaryNscSurveyFilter, surveysSubmittedBy, PRIMARY_NSC_UI_FIELDS } =
    window.WohPrimaryNsc || {};
  const { appointmentNameFromRelatedRecord, extractAppointmentNumber, isSurveyResultName, isAppNumber } =
    window.WohRequestNumber || {};

  function requestNumberOrBlank(...values) {
    for (const value of values) {
      const hit = extractAppointmentNumber?.(value);
      if (hit) return hit;
    }
    return '';
  }
  const panel = window.WohSurveyPanel;

  const SURVEY_LIMIT = { appointment: 10, account: 20 };

  function surveyLimit(pageContext) {
    return SURVEY_LIMIT[pageContext] || SURVEY_LIMIT.appointment;
  }
  const INFLIGHT_STALE_MS = 90_000;

  let inflight = null;
  let inflightStartedAt = 0;

  function emitProgress(text) {
    panel?.setStatus(text);
  }

  function sortKey(record) {
    const raw =
      fieldValue(record, 'Date_Time_Survey_Submitted__c') ||
      record.lastModifiedDate ||
      '';
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  }

  async function resolvePrimaryNscFromApi(appointmentId) {
    if (!extractPrimaryNscFromUiRecord || !uiApiRecordFields) return null;
    try {
      const fields = PRIMARY_NSC_UI_FIELDS || [
        'Appointment__c.Primary_NSC_Contact__c',
        'Appointment__c.User__c',
        'Appointment__c.User__r.Name',
      ];
      const record = await uiApiRecordFields(appointmentId, fields);
      return extractPrimaryNscFromUiRecord(record);
    } catch (err) {
      console.warn('[WOH Survey] Primary NSC UI API lookup failed', err);
      return null;
    }
  }

  async function resolveAccountRecord() {
    const accountId = parseAccountId(location.href);
    if (!accountId) {
      throw new Error('Could not resolve Account from this page. Reload and try again.');
    }

    emitProgress('Loading Account…');
    let accountName = '';
    try {
      const record = await uiApiRecord(accountId);
      accountName = fieldDisplay(record, 'Name') || fieldValue(record, 'Name') || '';
    } catch (err) {
      console.warn('[WOH Survey] UI API account lookup failed', err);
    }

    if (!accountName && getFieldByLabel) {
      const labeled = getFieldByLabel('Account Name') || getFieldByLabel('Account');
      accountName = labeled?.value || '';
    }

    return {
      accountId,
      accountName,
      appointmentName: '',
      appointmentId: '',
      accountHref: `${location.origin}/lightning/r/Account/${accountId}/view`,
      source: 'account_page',
      primaryNsc: null,
    };
  }

  async function resolveAccount(appointmentId) {
    emitProgress('Resolving Account…');

    let primaryNsc = await resolvePrimaryNscFromApi(appointmentId);

    try {
      const record = await uiApiRecord(appointmentId);
      const accountId = fieldValue(record, 'Account__c');
      const accountName = fieldDisplay(record, 'Account__r') || fieldDisplay(record, 'Account__c');
      const appointmentName = fieldDisplay(record, 'Name');
      if (!primaryNsc && extractPrimaryNscFromUiRecord) {
        primaryNsc = extractPrimaryNscFromUiRecord(record);
      }
      if (accountId) {
        return {
          accountId,
          accountName,
          appointmentName,
          appointmentId,
          accountHref: `${location.origin}/lightning/r/Account/${accountId}/view`,
          source: 'ui_api',
          primaryNsc,
        };
      }
    } catch (err) {
      console.warn('[WOH Survey] UI API appointment lookup failed', err);
    }

    try {
      await waitFor(() => Boolean(findAccountOnPage()), { timeoutMs: 5000, intervalMs: 300 });
    } catch (_) {
      /* continue */
    }

    const fromPage = findAccountOnPage();
    if (fromPage?.accountId) {
      return {
        accountId: fromPage.accountId,
        accountName: fromPage.accountName || '',
        appointmentName: '',
        appointmentId,
        accountHref: fromPage.href || '',
        source: fromPage.source,
        primaryNsc: primaryNsc || findPrimaryNscContact(),
      };
    }

    throw new Error(
      'Could not resolve Account. Reload the page and open the Details tab so Account is visible.'
    );
  }

  async function loadRecentSurveyMeta(accountId, limit, contactFilter) {
    emitProgress(
      contactFilter ? 'Loading surveys for this Primary NSC Contact…' : 'Loading survey list for this account…'
    );
    const records = await queryRecentSurveys(accountId, limit, contactFilter);
    const sorted = [...records].sort((a, b) => sortKey(b) - sortKey(a));
    const recent = sorted.slice(0, limit).map((record) => {
      const rawName = fieldDisplay(record, 'Appointment__c') || '';
      const resolved = appointmentNameFromRelatedRecord
        ? appointmentNameFromRelatedRecord(record)
        : requestNumberOrBlank(rawName);
      return {
        survey_result_id: record.id,
        survey_result_name: fieldValue(record, 'Name') || fieldDisplay(record, 'Name') || '',
        appointment_id: fieldValue(record, 'Appointment__c') || '',
        appointment_name: resolved,
        appointment_labeled: Boolean(resolved || rawName),
        submitted_at_iso: fieldValue(record, 'Date_Time_Survey_Submitted__c') || '',
        submitted_at_display: fieldDisplay(record, 'Date_Time_Survey_Submitted__c') || '',
      };
    });

    for (const meta of recent) {
      if (meta.appointment_name || meta.appointment_labeled || !meta.appointment_id || !uiApiRecordFields) continue;
      try {
        const appt = await uiApiRecordFields(meta.appointment_id, ['Name']);
        const name = fieldDisplay(appt, 'Name') || fieldValue(appt, 'Name') || '';
        meta.appointment_name = window.WohRequestNumber?.usableAppointmentName
          ? window.WohRequestNumber.usableAppointmentName(name)
          : name;
      } catch (_) {
        /* keep empty; Request # will not fall back to WOH SR */
      }
    }

    return recent;
  }

  async function scrapeOneSurvey(meta, account, index, total) {
    emitProgress(`Loading answers ${index}/${total}…`);
    const feedbackUrl = `${location.origin}/apex/WHT_FeedBackDetail?appointmentId=${encodeURIComponent(meta.appointment_id)}`;

    try {
      const { html, url } = await fetchFeedbackHtml(meta.appointment_id);
      const parsed = parseFeedbackHtml(html);
      return {
        ok: true,
        survey_result_id: meta.survey_result_id,
        survey_result_name: meta.survey_result_name,
        appointment_id: meta.appointment_id,
        appointment_name: requestNumberOrBlank(meta.appointment_name, parsed.req_number),
        appointment_url: meta.appointment_id
          ? `${location.origin}/lightning/r/Appointment__c/${meta.appointment_id}/view`
          : '',
        account_id: account.accountId,
        account_name: account.accountName,
        feedback_url: url || feedbackUrl,
        req_number: requestNumberOrBlank(parsed.req_number, meta.appointment_name),
        submitted_at: parsed.submitted_at || meta.submitted_at_display,
        submitted_by: parsed.submitted_by,
        consultant_name: parsed.consultant_name,
        product: parsed.product,
        sub_product: parsed.sub_product,
        overall_satisfaction: parsed.overall_satisfaction,
        consultant_satisfaction: parsed.consultant_satisfaction,
        comments: parsed.comments,
      };
    } catch (err) {
      try {
        const response = await api.runtime.sendMessage({
          type: 'SCRAPE_FEEDBACK_TAB_ONLY',
          appointmentId: meta.appointment_id,
          feedbackUrl,
        });
        if (!response?.ok) throw new Error(response?.error || 'Tab scrape failed');
        const record = response.record || {};
        return {
          ok: true,
          survey_result_id: meta.survey_result_id,
          survey_result_name: meta.survey_result_name,
          appointment_id: meta.appointment_id,
          appointment_name: requestNumberOrBlank(meta.appointment_name, record.req_number),
          appointment_url: meta.appointment_id
            ? `${location.origin}/lightning/r/Appointment__c/${meta.appointment_id}/view`
            : '',
          account_id: account.accountId,
          account_name: account.accountName,
          feedback_url: feedbackUrl,
          req_number: requestNumberOrBlank(record.req_number, meta.appointment_name),
          submitted_at: record.submitted_at || meta.submitted_at_display,
          submitted_by: record.submitted_by || '',
          consultant_name: record.consultant_name || '',
          product: record.product || '',
          sub_product: record.sub_product || '',
          overall_satisfaction: record.overall_satisfaction || '',
          consultant_satisfaction: record.consultant_satisfaction || '',
          comments: record.comments || '',
        };
      } catch (fallbackErr) {
        return {
          ok: false,
          survey_result_id: meta.survey_result_id,
          survey_result_name: meta.survey_result_name,
          appointment_id: meta.appointment_id,
          appointment_name: meta.appointment_name || '',
          account_id: account.accountId,
          account_name: account.accountName,
          feedback_url: feedbackUrl,
          req_number: requestNumberOrBlank(meta.appointment_name),
          submitted_at: meta.submitted_at_display,
          error: String(fallbackErr.message || fallbackErr || err.message || err),
        };
      }
    }
  }

  async function fetchFreshSurveys(account, limit, { cacheId, contactFilter } = {}) {
    const storeId = cacheId || account.accountId;
    const recent = await loadRecentSurveyMeta(account.accountId, limit, contactFilter);
    if (!recent.length) {
      const payload = {
        ok: true,
        account_id: account.accountId,
        account_name: account.accountName,
        account_href: account.accountHref || '',
        appointment_id: account.appointmentId || '',
        survey_limit: limit,
        survey_scope: contactFilter ? 'primary_nsc' : 'account',
        surveys: [],
      };
      await panel.writeCache(storeId, payload);
      return payload;
    }

    const surveys = [];
    for (let i = 0; i < recent.length; i++) {
      surveys.push(await scrapeOneSurvey(recent[i], account, i + 1, recent.length));
    }

    const payload = {
      ok: true,
      account_id: account.accountId,
      account_name: account.accountName,
      account_href: account.accountHref || '',
      account_source: account.source || '',
      appointment_id: account.appointmentId || '',
      survey_limit: limit,
      survey_scope: contactFilter ? 'primary_nsc' : 'account',
      surveys,
    };
    await panel.writeCache(storeId, payload);
    return payload;
  }

  function resolvePrimaryNsc(account) {
    return account?.primaryNsc || findPrimaryNscContact() || null;
  }

  function withPrimaryNsc(payload, primaryOverride = null) {
    const primary = primaryOverride || findPrimaryNscContact();
    const primaryName = primary?.name || '';
    const surveys = (surveysSubmittedBy
      ? surveysSubmittedBy(payload.surveys, primaryName, namesMatch)
      : []
    ).map((survey) => ({
      ...survey,
      is_primary_nsc: true,
    }));
    return {
      ...payload,
      survey_scope: 'primary_nsc',
      primary_nsc_contact: primaryName,
      primary_nsc_id: primary?.id || '',
      primary_nsc_matched: surveys.some((survey) => survey.ok !== false),
      primary_nsc_source: primary?.source || '',
      surveys,
    };
  }

  function hasReturnRatio(payload) {
    return (
      Number.isInteger(payload?.request_count) &&
      Number.isInteger(payload?.csat_count) &&
      Boolean(payload?.return_ratio_display)
    );
  }

  async function fetchReturnRatio(accountId, contactFilter) {
    if (!window.WohSfApi?.queryReturnRatio) return null;
    try {
      return await window.WohSfApi.queryReturnRatio(accountId, contactFilter);
    } catch (err) {
      console.warn('[WOH Survey] Return ratio query failed', err);
      return null;
    }
  }

  async function persistReturnRatio(cacheId, summary) {
    if (!summary || !cacheId || !panel?.readCache || !panel?.writeCache) return;
    const cached = await panel.readCache(cacheId);
    if (!cached?.payload) return;
    await panel.writeCache(cacheId, { ...cached.payload, ...summary });
  }

  async function withReturnRatio(payload, { pageContext, accountId, contactFilter, cacheId, pending }) {
    if (pageContext === 'appointment' && !contactFilter) return payload;
    if (hasReturnRatio(payload)) return payload;
    const summary = pending ? await pending : await fetchReturnRatio(accountId, contactFilter || null);
    if (!summary?.return_ratio_display) return payload;
    await persistReturnRatio(cacheId, summary);
    return { ...payload, ...summary };
  }

  function withCsatAverage(payload) {
    const summary = window.WohCsatParse?.averageCsatPoints
      ? window.WohCsatParse.averageCsatPoints(payload.surveys || [])
      : { average: null, count: 0, display: '', notice: '' };
    return {
      ...payload,
      csat_average: summary.average,
      csat_average_count: summary.count,
      csat_average_display: summary.display || '',
      csat_average_notice: summary.notice || '',
    };
  }

  /**
   * Same Account object for both pages. Account pages read the id from the URL.
   * Appointment pages read Account__c (and Primary NSC) from the open request.
   */
  async function resolveAccountForPage(pageContext) {
    if (pageContext === 'account') return resolveAccountRecord();
    return resolveAccount(parseAppointmentId(location.href));
  }

  function limitSurveys(payload, limit) {
    const surveys = payload?.surveys || [];
    if (surveys.length <= limit) return payload;
    return { ...payload, surveys: surveys.slice(0, limit) };
  }

  /**
   * Account pages summarize every contact on the account.
   * Appointment pages summarize surveys submitted by the Primary NSC Contact.
   */
  function applyPageSummary(payload, pageContext, account) {
    const next = {
      ...limitSurveys(payload, surveyLimit(pageContext)),
      page_context: pageContext || payload.page_context || 'appointment',
    };
    if (next.page_context === 'account') {
      return withCsatAverage({ ...next, survey_scope: 'account' });
    }
    return withCsatAverage(withPrimaryNsc(next, resolvePrimaryNsc(account)));
  }

  function cacheMatchesPage(payload, pageContext) {
    if (!payload?.survey_scope) return true;
    if (pageContext === 'account') return payload.survey_scope === 'account';
    return payload.survey_scope === 'primary_nsc';
  }

  async function loadSurveysForPage({ forceRefresh = false } = {}) {
    const pageContext = detectPageContext(location.href);
    if (!pageContext) {
      throw new Error('Open an Appointment (REQ) or Account record page first');
    }

    panel.setStatus('Resolving Account…');
    const account = await resolveAccountForPage(pageContext);
    const limit = surveyLimit(pageContext);
    const primary = pageContext === 'appointment' ? resolvePrimaryNsc(account) : null;
    const contactFilter = pageContext === 'appointment' ? primaryNscSurveyFilter?.(primary) || null : null;
    const cacheId =
      pageContext === 'appointment'
        ? `${account.accountId}::nsc::${primary?.id || primary?.name || 'missing'}`
        : account.accountId;

    if (pageContext === 'appointment' && !contactFilter) {
      const payload = applyPageSummary(
        {
          ok: true,
          account_id: account.accountId,
          account_name: account.accountName,
          account_href: account.accountHref || '',
          appointment_id: account.appointmentId || '',
          survey_limit: limit,
          surveys: [],
        },
        pageContext,
        account
      );
      panel.showPayload(payload, { fromCache: false });
      return { ok: true, cached: false, ...payload };
    }

    if (!forceRefresh) {
      const cached = await panel.readCache(cacheId);
      const payload = cached?.payload;
      const staleWohSr =
        payload &&
        (payload.surveys || []).some((survey) => {
          if (extractAppointmentNumber?.(survey.req_number) || extractAppointmentNumber?.(survey.appointment_name)) {
            return false;
          }
          if (isAppNumber?.(survey.req_number) || isAppNumber?.(survey.appointment_name)) return true;
          if (survey.appointment_name) return false;
          if (!isSurveyResultName?.(survey.survey_result_name)) return false;
          return !extractAppointmentNumber?.(survey.req_number);
        });
      const cachedLimit = Number.isFinite(payload?.survey_limit)
        ? payload.survey_limit
        : (payload?.surveys || []).length;
      if (payload && cacheMatchesPage(payload, pageContext) && !staleWohSr && cachedLimit >= limit) {
        const decorated = await withReturnRatio(applyPageSummary(payload, pageContext, account), {
          pageContext,
          accountId: account.accountId,
          contactFilter,
          cacheId,
        });
        panel.showPayload(decorated, { fromCache: true });
        return { ok: true, cached: true, ...decorated };
      }
    }

    panel.setStatus('Loading survey list…');
    const pendingRatio =
      pageContext === 'appointment' && !contactFilter
        ? null
        : fetchReturnRatio(account.accountId, contactFilter);
    const payload = await withReturnRatio(
      applyPageSummary(
        await fetchFreshSurveys(account, limit, { cacheId, contactFilter }),
        pageContext,
        account
      ),
      { pageContext, accountId: account.accountId, contactFilter, cacheId, pending: pendingRatio }
    );
    panel.showPayload(payload, { fromCache: false });
    return payload;
  }

  async function runPanelFlow(options = {}) {
    const now = Date.now();
    const stale = inflight && now - inflightStartedAt > INFLIGHT_STALE_MS;

    if (inflight && !stale && !options.forceRefresh) {
      return inflight;
    }

    if (inflight && (stale || options.forceRefresh)) {
      inflight = null;
    }

    panel?.setStatus?.('Loading surveys…');
    inflightStartedAt = now;
    inflight = loadSurveysForPage(options)
      .catch((err) => {
        panel.showError(err.message || err);
        return { ok: false, error: String(err.message || err) };
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (
      message.type === 'SHOW_ACCOUNT_SURVEYS_PANEL' ||
      message.type === 'REQUEST_ACCOUNT_SURVEYS' ||
      message.type === 'SHOW_ACCOUNT_SURVEYS'
    ) {
      panel?.setStatus?.('Loading surveys…');
      runPanelFlow({ forceRefresh: Boolean(message.forceRefresh) })
        .then((data) => sendResponse(data))
        .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
      return true;
    }

    if (message.type === 'PING_APPOINTMENT') {
      sendResponse({
        ok: true,
        appointmentId: parseAppointmentId(location.href),
        accountId: parseAccountId(location.href),
        page_context: detectPageContext(location.href),
      });
      return false;
    }
  });

  window.addEventListener('woh-survey-refresh', () => {
    runPanelFlow({ forceRefresh: true });
  });
})();
