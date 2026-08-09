/**
 * Feedback page content script — scrape live DOM when a background tab is used.
 */

(async function initFeedbackScraper() {
  const api = globalThis.browser ?? globalThis.chrome;
  const {
    waitFor,
    isFeedbackPage,
    scrapeFeedbackQuestions,
    mapQuestionsToFields,
    getFieldByLabel,
    findLinkByText,
    textOf,
    parseFeedbackHtml,
  } = window.WohScrape;

  async function scrapeFeedback(appointment = {}) {
    await waitFor(() => isFeedbackPage() || textOf(document.body).length > 200, { timeoutMs: 20000 });

    // Prefer HTML parser (same path as fetch-based scrape)
    const fromHtml = parseFeedbackHtml(document.documentElement.outerHTML);
    const questions = scrapeFeedbackQuestions();
    const mapped = mapQuestionsToFields(questions);

    const submittedLine = textOf(document.body).match(/Submitted\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+By:\s*([^\n]+)/i);
    const reqLink = findLinkByText('REQ-', { partial: true });
    const consultantField = getFieldByLabel('Consultants') || getFieldByLabel('Consultant');

    return {
      survey_result_id: appointment.survey_result_id || '',
      req_number: fromHtml.req_number || appointment.req_number || textOf(reqLink) || '',
      appointment_id: appointment.appointment_id || appointment.appointmentId || '',
      appointment_url: appointment.appointment_url || '',
      contact_id: appointment.contact_id || '',
      contact_name: appointment.contact_name || '',
      account_id: appointment.account_id || '',
      account_name: appointment.account_name || '',
      consultant_name: fromHtml.consultant_name || consultantField?.value || '',
      product: fromHtml.product || appointment.product || getFieldByLabel('Product')?.value || '',
      sub_product: fromHtml.sub_product || appointment.sub_product || getFieldByLabel('Sub Product')?.value || '',
      submitted_at: fromHtml.submitted_at || (submittedLine ? submittedLine[1] : ''),
      submitted_by: fromHtml.submitted_by || (submittedLine ? submittedLine[2].trim() : ''),
      overall_satisfaction: fromHtml.overall_satisfaction || mapped.overall_satisfaction,
      consultant_satisfaction: fromHtml.consultant_satisfaction || mapped.consultant_satisfaction,
      comments: fromHtml.comments || mapped.comments,
    };
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SCRAPE_FEEDBACK_PAGE') {
      scrapeFeedback(message.appointment || {})
        .then((record) => sendResponse({ ok: true, record }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
  });
})();
