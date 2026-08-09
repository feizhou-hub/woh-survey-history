/**
 * WOH Survey → Google Sheets (no extension required)
 *
 * Usage:
 * 1. Save config once in browser console:
 *    localStorage.setItem('wohSurveyConfig', JSON.stringify({
 *      webhookUrl: 'https://script.google.com/macros/s/.../exec',
 *      secret: 'your-secret',
 *      userEmail: 'you@workday.com'
 *    }));
 * 2. Open an Appointment (REQ) page in Salesforce
 * 3. Paste this entire file into DevTools Console and press Enter
 * 4. Click the "Sync to Google Sheets" button
 */
(async function wohSurveyConsoleSync() {
  const CONFIG = JSON.parse(localStorage.getItem('wohSurveyConfig') || '{}');
  if (!CONFIG.webhookUrl || !CONFIG.secret) {
    alert('Set config first:\nlocalStorage.setItem("wohSurveyConfig", JSON.stringify({ webhookUrl: "...", secret: "..." }))');
    return;
  }

  function walkElements(root) {
    const results = [];
    const stack = [root || document];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.nodeType === Node.ELEMENT_NODE) {
        results.push(node);
        if (node.shadowRoot) stack.push(node.shadowRoot);
        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
      }
    }
    return results;
  }

  function textOf(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function parseRecordId(href) {
    if (!href) return null;
    const match = href.match(/\/(001|003|a3N|a08)[a-zA-Z0-9]{12,18}/);
    return match ? match[0].slice(1) : null;
  }

  function getFieldByLabel(labelText) {
    const normalized = labelText.toLowerCase();
    for (const el of walkElements(document)) {
      const text = textOf(el);
      if (!text) continue;
      if (text.toLowerCase() === normalized || text.toLowerCase().startsWith(normalized + '\n')) {
        const container = el.closest('records-record-layout-item, .slds-form__item') || el.parentElement;
        const link = container?.querySelector('a[href]');
        const valueEl = container?.querySelector('[slot="outputField"], lightning-formatted-text, a, .slds-form-element__static');
        const value = textOf(valueEl) || textOf(link);
        if (value && value.toLowerCase() !== normalized) {
          return { value, id: parseRecordId(link?.href) };
        }
      }
    }
    return null;
  }

  function findLinkByText(text) {
    const target = text.toLowerCase();
    for (const el of walkElements(document)) {
      if (el.tagName === 'A' && textOf(el).toLowerCase().includes(target)) return el;
    }
    return null;
  }

  function scrapeFeedbackFromDoc(doc) {
    const bodyText = textOf(doc.body);
    const submittedLine = bodyText.match(/Submitted\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+By:\s*([^\n]+)/i);
    const questions = [];
    const keywords = ['satisfied', 'satisfaction', 'improvement', 'positive'];

    for (const el of walkElements(doc)) {
      const text = textOf(el);
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;
      if (!keywords.some((k) => lines[0].toLowerCase().includes(k))) continue;
      questions.push({ question: lines[0], answer: lines.slice(1).join(' ') });
    }

    const mapped = { overall_satisfaction: '', consultant_satisfaction: '', comments: '' };
    for (const { question, answer } of questions) {
      const q = question.toLowerCase();
      if (q.includes('overall') && q.includes('request')) mapped.overall_satisfaction = answer;
      else if (q.includes('consultant')) mapped.consultant_satisfaction = answer;
      else if (q.includes('positive') || q.includes('improvement') || q.includes('share')) mapped.comments = answer;
    }

    return {
      submitted_at: submittedLine?.[1] || '',
      submitted_by: submittedLine?.[2]?.trim() || '',
      ...mapped,
    };
  }

  function scrapeAppointment() {
    const appointmentId = location.href.match(/Appointment__c\/([a-zA-Z0-9]{15,18})/)?.[1] || '';
    const reqField = getFieldByLabel('Request') || getFieldByLabel('Request Number') || getFieldByLabel('Name');
    const contactField = getFieldByLabel('Contact') || getFieldByLabel('Customer Contact');
    const accountField = getFieldByLabel('Account') || getFieldByLabel('Customer');
    const feedbackLink = findLinkByText('view submitted feedback');

    return {
      appointment_id: appointmentId,
      appointment_url: location.href.split('?')[0],
      req_number: reqField?.value || '',
      contact_id: contactField?.id || '',
      contact_name: contactField?.value || '',
      account_id: accountField?.id || '',
      account_name: accountField?.value || '',
      product: getFieldByLabel('Product')?.value || '',
      sub_product: getFieldByLabel('Sub Product')?.value || '',
      feedback_url: feedbackLink?.href || '',
    };
  }

  async function fetchFeedbackPage(url) {
    const res = await fetch(url, { credentials: 'include' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return scrapeFeedbackFromDoc(doc);
  }

  async function syncRecord(record) {
    record.synced_by = CONFIG.userEmail || '';
    record.synced_at = new Date().toISOString();
    const res = await fetch(CONFIG.webhookUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: CONFIG.secret, record }),
    });
    try {
      const body = await res.text();
      return JSON.parse(body);
    } catch {
      return { ok: true, status: 'sent' };
    }
  }

  function addButton() {
    if (document.getElementById('woh-sync-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'woh-sync-btn';
    btn.textContent = 'Sync to Google Sheets';
    Object.assign(btn.style, {
      position: 'fixed', bottom: '24px', right: '24px', zIndex: '99999',
      padding: '12px 16px', background: '#0176d3', color: '#fff', border: 'none',
      borderRadius: '8px', fontSize: '14px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.2)',
    });
    btn.onclick = runSync;
    document.body.appendChild(btn);
  }

  async function runSync() {
    const btn = document.getElementById('woh-sync-btn');
    btn.disabled = true;
    btn.textContent = 'Syncing…';

    try {
      const appointment = scrapeAppointment();
      if (!appointment.feedback_url) throw new Error('No "View Submitted Feedback" link on this page');

      const feedback = await fetchFeedbackPage(appointment.feedback_url);
      const record = { ...appointment, ...feedback, survey_result_id: '' };
      const result = await syncRecord(record);

      if (result.ok === false) throw new Error(result.error || 'Sync failed');
      btn.textContent = 'Synced ✓';
      alert(`Synced ${record.req_number || 'request'} to Google Sheets`);
    } catch (err) {
      btn.textContent = 'Sync failed';
      alert(err.message);
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Sync to Google Sheets';
      }, 3000);
    }
  }

  if (!location.href.includes('/Appointment__c/')) {
    alert('Open an Appointment (REQ) page first.');
    return;
  }

  addButton();
  console.log('[WOH Survey] Ready — click "Sync to Google Sheets" button');
})();
