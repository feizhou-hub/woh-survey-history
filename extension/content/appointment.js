/**
 * Runs on Appointment__c record pages.
 * Toolbar click → show persistent panel with Account's 10 newest surveys (12h cache).
 */

(async function initAppointmentScraper() {
  const api = globalThis.browser ?? globalThis.chrome;
  const { parseAppointmentId, findAccountOnPage, findPrimaryNscContact, namesMatch, parseFeedbackHtml, waitFor } =
    window.WohScrape;
  const { uiApiRecord, fieldValue, fieldDisplay, relatedListAll, fetchFeedbackHtml } = window.WohSfApi;
  const panel = window.WohSurveyPanel;

  const TOP_N = 10;
  const RELATED_FIELDS = ['Id', 'Name', 'Appointment__c', 'Date_Time_Survey_Submitted__c', 'Survey_Author__c'];

  let inflight = null;

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

  async function resolveAccount(appointmentId) {
    emitProgress('Resolving Account…');

    try {
      const record = await uiApiRecord(appointmentId);
      const accountId = fieldValue(record, 'Account__c');
      const accountName = fieldDisplay(record, 'Account__r') || fieldDisplay(record, 'Account__c');
      const appointmentName = fieldDisplay(record, 'Name');
      if (accountId) {
        return {
          accountId,
          accountName,
          appointmentName,
          appointmentId,
          accountHref: `${location.origin}/lightning/r/Account/${accountId}/view`,
          source: 'ui_api',
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
      };
    }

    throw new Error(
      'Could not resolve Account. Reload the page and open the Details tab so Account is visible.'
    );
  }

  async function loadRecentSurveyMeta(accountId) {
    emitProgress('Loading survey list for this account…');
    const records = await relatedListAll(accountId, 'WOH_Survey_Results__r', RELATED_FIELDS);
    const sorted = [...records].sort((a, b) => sortKey(b) - sortKey(a));
    return sorted.slice(0, TOP_N).map((record) => ({
      survey_result_id: record.id,
      survey_result_name: fieldValue(record, 'Name') || fieldDisplay(record, 'Name') || '',
      appointment_id: fieldValue(record, 'Appointment__c') || '',
      submitted_at_iso: fieldValue(record, 'Date_Time_Survey_Submitted__c') || '',
      submitted_at_display: fieldDisplay(record, 'Date_Time_Survey_Submitted__c') || '',
    }));
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
        appointment_url: meta.appointment_id
          ? `${location.origin}/lightning/r/Appointment__c/${meta.appointment_id}/view`
          : '',
        account_id: account.accountId,
        account_name: account.accountName,
        feedback_url: url || feedbackUrl,
        req_number: parsed.req_number,
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
          appointment_url: meta.appointment_id
            ? `${location.origin}/lightning/r/Appointment__c/${meta.appointment_id}/view`
            : '',
          account_id: account.accountId,
          account_name: account.accountName,
          feedback_url: feedbackUrl,
          req_number: record.req_number || '',
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
          account_id: account.accountId,
          account_name: account.accountName,
          feedback_url: feedbackUrl,
          submitted_at: meta.submitted_at_display,
          error: String(fallbackErr.message || fallbackErr || err.message || err),
        };
      }
    }
  }

  async function fetchFreshSurveys(appointmentId) {
    const account = await resolveAccount(appointmentId);
    const recent = await loadRecentSurveyMeta(account.accountId);
    if (!recent.length) {
      const payload = {
        ok: true,
        account_id: account.accountId,
        account_name: account.accountName,
        account_href: account.accountHref || '',
        appointment_id: appointmentId,
        surveys: [],
        message: 'No WOH Survey Results found for this Account',
      };
      await panel.writeCache(account.accountId, payload);
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
      appointment_id: appointmentId,
      surveys,
    };
    await panel.writeCache(account.accountId, payload);
    return payload;
  }

  function withPrimaryNsc(payload) {
    const primary = findPrimaryNscContact();
    const primaryName = primary?.name || '';
    const surveys = (payload.surveys || []).map((survey) => ({
      ...survey,
      is_primary_nsc: Boolean(primaryName && namesMatch(survey.submitted_by, primaryName)),
    }));
    const primaryInList = surveys.some((s) => s.ok && s.is_primary_nsc);
    return {
      ...payload,
      primary_nsc_contact: primaryName,
      primary_nsc_matched: primaryInList,
      primary_nsc_notice:
        primaryName && !primaryInList
          ? `${primaryName} (Primary NSC Contact) has not submitted a survey in this recent list.`
          : '',
      surveys,
    };
  }

  async function showAccountSurveysPanel({ forceRefresh = false } = {}) {
    const appointmentId = parseAppointmentId(location.href);
    if (!appointmentId) {
      throw new Error('Open an Appointment (REQ) record page first');
    }

    panel.setStatus('Resolving Account…');
    const account = await resolveAccount(appointmentId);

    if (!forceRefresh) {
      const cached = await panel.readCache(account.accountId);
      if (cached?.payload) {
        const decorated = withPrimaryNsc(cached.payload);
        panel.showPayload(decorated, { fromCache: true });
        return { ok: true, cached: true, ...decorated };
      }
    }

    panel.setStatus('Loading survey list…');
    const payload = withPrimaryNsc(await fetchFreshSurveys(appointmentId));
    panel.showPayload(payload, { fromCache: false });
    return payload;
  }

  async function runPanelFlow(options = {}) {
    if (inflight) return inflight;
    inflight = showAccountSurveysPanel(options)
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
    if (message.type === 'SHOW_ACCOUNT_SURVEYS_PANEL' || message.type === 'REQUEST_ACCOUNT_SURVEYS') {
      runPanelFlow({ forceRefresh: Boolean(message.forceRefresh) })
        .then((data) => sendResponse(data))
        .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
      return true;
    }

    // Legacy popup support
    if (message.type === 'SHOW_ACCOUNT_SURVEYS') {
      runPanelFlow({ forceRefresh: Boolean(message.forceRefresh) })
        .then((data) => sendResponse(data))
        .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
      return true;
    }

    if (message.type === 'PING_APPOINTMENT') {
      sendResponse({ ok: true, appointmentId: parseAppointmentId(location.href) });
      return false;
    }
  });

  window.addEventListener('woh-survey-refresh', () => {
    runPanelFlow({ forceRefresh: true });
  });
})();
