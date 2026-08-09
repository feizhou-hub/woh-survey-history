// ==UserScript==
// @name         WOH Survey → Google Sheets
// @namespace    woh-survey-local
// @version      0.1.0
// @description  Scrape AAE survey feedback and sync to Google Sheets (no Salesforce API)
// @match        https://workday.lightning.force.com/lightning/r/Appointment__c/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==

(function () {
  const WEBHOOK_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
  const SECRET = 'your-secret-here';
  const USER_EMAIL = 'you@workday.com';

  GM_addStyle(`
    #woh-sync-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      padding: 12px 16px; background: #0176d3; color: #fff; border: none;
      border-radius: 8px; font-size: 14px; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.2);
    }
    #woh-sync-btn:disabled { opacity: 0.7; }
  `);

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
    const match = (href || '').match(/\/(001|003|a3N|a08)[a-zA-Z0-9]{12,18}/);
    return match ? match[0].slice(1) : null;
  }

  function getFieldByLabel(labelText) {
    const normalized = labelText.toLowerCase();
    for (const el of walkElements(document)) {
      const text = textOf(el);
      if (!text.toLowerCase().startsWith(normalized)) continue;
      const container = el.closest('records-record-layout-item, .slds-form__item') || el.parentElement;
      const link = container?.querySelector('a[href]');
      const valueEl = container?.querySelector('a, lightning-formatted-text, .slds-form-element__static');
      const value = textOf(valueEl);
      if (value) return { value, id: parseRecordId(link?.href) };
    }
    return null;
  }

  function findLinkByText(text) {
    for (const el of walkElements(document)) {
      if (el.tagName === 'A' && textOf(el).toLowerCase().includes(text.toLowerCase())) return el;
    }
    return null;
  }

  function scrapeAppointment() {
    const appointmentId = location.href.match(/Appointment__c\/([a-zA-Z0-9]{15,18})/)?.[1] || '';
    const feedbackLink = findLinkByText('view submitted feedback');
    return {
      appointment_id: appointmentId,
      appointment_url: location.href.split('?')[0],
      req_number: getFieldByLabel('Request')?.value || getFieldByLabel('Name')?.value || '',
      contact_id: getFieldByLabel('Contact')?.id || '',
      contact_name: getFieldByLabel('Contact')?.value || '',
      account_id: getFieldByLabel('Account')?.id || '',
      account_name: getFieldByLabel('Account')?.value || '',
      product: getFieldByLabel('Product')?.value || '',
      sub_product: getFieldByLabel('Sub Product')?.value || '',
      feedback_url: feedbackLink?.href || '',
    };
  }

  function postToSheets(record) {
    return new Promise((resolve, reject) => {
      record.synced_by = USER_EMAIL;
      record.synced_at = new Date().toISOString();
      GM_xmlhttpRequest({
        method: 'POST',
        url: WEBHOOK_URL,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        data: JSON.stringify({ secret: SECRET, record }),
        onload: (res) => {
          try { resolve(JSON.parse(res.responseText)); }
          catch { resolve({ ok: true }); }
        },
        onerror: reject,
      });
    });
  }

  async function runSync(btn) {
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      const appointment = scrapeAppointment();
      if (!appointment.feedback_url) throw new Error('No submitted feedback link');

      const win = window.open(appointment.feedback_url, '_blank', 'width=1,height=1');
      await new Promise((r) => setTimeout(r, 4000));

      // User must have feedback tab open — for userscript, prompt manual step
      const feedback = prompt(
        'Open "View Submitted Feedback" in a new tab, then paste the overall satisfaction answer here.\n\n' +
        'For full automation, use the Firefox extension or console-sync.js instead.'
      );
      if (!feedback) throw new Error('Cancelled');

      const record = {
        ...appointment,
        overall_satisfaction: feedback,
        consultant_satisfaction: '',
        comments: '',
        submitted_at: '',
        submitted_by: '',
        survey_result_id: '',
      };

      const result = await postToSheets(record);
      if (result.ok === false) throw new Error(result.error);
      btn.textContent = 'Synced ✓';
      if (win) win.close();
    } catch (err) {
      alert(err.message);
      btn.textContent = 'Sync failed';
    } finally {
      setTimeout(() => { btn.disabled = false; btn.textContent = 'Sync to Sheets'; }, 3000);
    }
  }

  const btn = document.createElement('button');
  btn.id = 'woh-sync-btn';
  btn.textContent = 'Sync to Sheets';
  btn.onclick = () => runSync(btn);
  document.body.appendChild(btn);
})();
