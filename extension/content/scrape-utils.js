/**
 * Shadow-DOM-safe utilities for scraping Salesforce Lightning pages.
 */

function walkElements(root) {
  const results = [];
  const stack = [root || document];

  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;

    if (node.nodeType === Node.ELEMENT_NODE) {
      results.push(node);
      if (node.shadowRoot) stack.push(node.shadowRoot);
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFor(predicate, { timeoutMs = 15000, intervalMs = 300 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const value = predicate();
        if (value) return resolve(value);
      } catch (_) {
        /* retry */
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('Timed out waiting for page content'));
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
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

/**
 * Extract Account Id from Lightning Account URLs, e.g.
 * /lightning/r/Account/0018000001YEmePAAT/view?ws=...
 */
function parseAccountId(href) {
  if (!href) return null;
  const named = String(href).match(/\/lightning\/r\/Account\/([a-zA-Z0-9]{15,18})(?:\/|$|\?)/i);
  if (named) return named[1];
  // Classic /001... links
  const classic = String(href).match(/\/(001[a-zA-Z0-9]{12,15})(?:\/|$|\?)/);
  return classic ? classic[1] : null;
}

function parseAppointmentId(url) {
  const href = url || location.href;
  const named = href.match(/Appointment__c\/([a-zA-Z0-9]{15,18})/);
  if (named) return named[1];
  // Short Lightning URLs: /lightning/r/a3Nxxxxxxxxxxxx/view
  const short = href.match(/\/lightning\/r\/(a3N[a-zA-Z0-9]{12,15})(?:\/|$|\?)/);
  return short ? short[1] : null;
}

function isAppointmentUrl(url = '') {
  return window.WohPageContext.isAppointmentUrl(url);
}

function isAccountUrl(url = '') {
  return window.WohPageContext.isAccountUrl(url);
}

/**
 * Find the Account lookup link on an Appointment Details page
 * (same link you click to open the Account record).
 */
function findAccountOnPage() {
  const labeled =
    getFieldByLabel('Account') ||
    getFieldByLabel('Customer') ||
    getFieldByLabel('Customer Account');

  if (labeled?.href) {
    const id = parseAccountId(labeled.href) || labeled.id;
    if (id) {
      return {
        accountId: id,
        accountName: labeled.value || '',
        href: labeled.href,
        source: 'field_label',
      };
    }
  }

  // Shadow-DOM walk: any /lightning/r/Account/{id} link
  const links = getAllLinks().filter((a) => /\/lightning\/r\/Account\//i.test(a.href || ''));
  for (const link of links) {
    const id = parseAccountId(link.href);
    if (!id) continue;
    const name = textOf(link);
    // Skip empty/utility chrome links
    if (!name || name.length < 2) continue;
    return {
      accountId: id,
      accountName: name,
      href: link.href,
      source: 'account_link',
    };
  }

  return null;
}

function normalizePersonName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/\bPreview\b/gi, '')
    .trim()
    .toLowerCase();
}

function namesMatch(a, b) {
  const left = normalizePersonName(a);
  const right = normalizePersonName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // Allow "Yanli Huang" vs "Huang, Yanli"
  const leftParts = left.split(' ').filter(Boolean).sort().join(' ');
  const rightParts = right.split(' ').filter(Boolean).sort().join(' ');
  return leftParts === rightParts;
}

function cleanScrapedPersonName(raw) {
  if (window.WohPrimaryNsc?.cleanPersonName) {
    return window.WohPrimaryNsc.cleanPersonName(raw);
  }
  return String(raw || '')
    .replace(/\b(Preview|Open|Show More|Edit|Clear Selection)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read Primary NSC Contact from the open Appointment page.
 * Prefers Contact/User lookup links inside the field (shadow-DOM safe).
 */
function findPrimaryNscContact() {
  const labeled =
    getFieldByLabel('Primary NSC Contact') ||
    getFieldByLabel('Primary NSC') ||
    getFieldByLabel('NSC Contact');

  if (labeled?.value) {
    const name = cleanScrapedPersonName(labeled.value);
    if (name) {
      return {
        name,
        href: labeled.href || '',
        id: labeled.id || parseRecordId(labeled.href) || '',
        source: 'field_label',
      };
    }
  }

  const fromNearLabel = findPrimaryNscContactNearLabel();
  if (fromNearLabel) return fromNearLabel;

  // document.body.innerText often misses Lightning shadow roots — walk instead
  const chunks = [];
  for (const el of walkElements(document)) {
    if (el.children?.length) continue;
    const t = textOf(el);
    if (t) chunks.push(t);
  }
  const walked = chunks.join(' ').replace(/\s+/g, ' ');
  const match = walked.match(
    /Primary NSC Contact\s+((?:Open\s+)?[A-Za-z][A-Za-z .'-]{1,80}?)\s+(?:Preview\s+)?Primary NSC Email/i
  );
  if (match) {
    const name = cleanScrapedPersonName(match[1]);
    if (name) return { name, href: '', id: '', source: 'walked_text' };
  }

  return null;
}

function findPrimaryNscContactNearLabel() {
  const labels = ['primary nsc contact', 'primary nsc', 'nsc contact'];
  const elements = walkElements(document);

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const text = textOf(el).toLowerCase();
    if (!labels.includes(text)) continue;

    const container =
      el.closest('records-record-layout-item, .slds-form__item, [data-target-selection-name]') ||
      el.parentElement;
    const scope = container ? walkElements(container) : elements.slice(i, i + 60);

    const contactLink = scope.find(
      (node) =>
        node.tagName === 'A' &&
        /\/lightning\/r\/(Contact|User)\//i.test(node.href || '')
    );
    if (contactLink) {
      const name = cleanScrapedPersonName(textOf(contactLink));
      if (name) {
        return {
          name,
          href: contactLink.href || '',
          id: parseRecordId(contactLink.href) || '',
          source: 'contact_link',
        };
      }
    }
  }

  return null;
}

/**
 * Find a field value on Lightning record pages by label text.
 * Works across shadow roots.
 */
function getFieldByLabel(labelText) {
  const normalized = labelText.toLowerCase();
  const elements = walkElements(document);
  const preferContact = /contact/i.test(labelText) && !/account/i.test(labelText);

  for (const el of elements) {
    const text = textOf(el);
    if (!text) continue;

    // Lightning field: label element followed by value in sibling/parent structure
    // Note: textOf collapses whitespace, so exact label match is the reliable path.
    if (text.toLowerCase() === normalized) {
      const container = el.closest('records-record-layout-item, .slds-form__item, [data-target-selection-name]') || el.parentElement;
      if (!container) continue;

      // querySelector does not pierce nested shadow roots — walk instead
      const inContainer = walkElements(container);
      const links = inContainer.filter((node) => node.tagName === 'A' && node.href);
      const link =
        (preferContact &&
          links.find((a) => /\/lightning\/r\/(Contact|User)\//i.test(a.href))) ||
        links.find((a) => /\/lightning\/r\/Account\//i.test(a.href)) ||
        links.find((a) => /\/lightning\/r\//i.test(a.href)) ||
        links[0];

      const valueEl =
        inContainer.find((node) => node.getAttribute?.('slot') === 'outputField') ||
        inContainer.find((node) =>
          /^(LIGHTNING-FORMATTED-TEXT|LIGHTNING-FORMATTED-URL|LIGHTNING-FORMATTED-NAME)$/i.test(
            node.tagName
          )
        ) ||
        inContainer.find((node) => node.classList?.contains('test-id__field-value')) ||
        link;

      let value = textOf(valueEl) || textOf(link);
      if (preferContact) value = cleanScrapedPersonName(value);
      if (value && value.toLowerCase() !== normalized) {
        return {
          label: labelText,
          value,
          href: link ? link.href : null,
          id: parseAccountId(link?.href) || parseRecordId(link?.href),
        };
      }
    }
  }

  // Broader search: walked leaf texts near a label (shadow-safe stand-in for Label\nValue)
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (textOf(el).toLowerCase() !== normalized) continue;
    const container =
      el.closest('records-record-layout-item, .slds-form__item, [data-target-selection-name]') ||
      el.parentElement;
    if (!container) continue;
    const leaves = walkElements(container)
      .filter((node) => !node.children?.length)
      .map((node) => textOf(node))
      .filter(Boolean);
    const valueParts = leaves.filter((t) => t.toLowerCase() !== normalized);
    let value = valueParts.join(' ').replace(/\s+/g, ' ').trim();
    if (preferContact) value = cleanScrapedPersonName(value);
    if (!value) continue;
    const link = walkElements(container).find((node) => node.tagName === 'A' && node.href);
    return {
      label: labelText,
      value,
      href: link ? link.href : null,
      id: parseRecordId(link?.href),
    };
  }

  return null;
}

function getAllLinks() {
  return walkElements(document).flatMap((el) => (el.tagName === 'A' && el.href ? [el] : []));
}

function findLinkByText(text, { partial = false } = {}) {
  const target = text.toLowerCase();
  return getAllLinks().find((a) => {
    const linkText = textOf(a).toLowerCase();
    return partial ? linkText.includes(target) : linkText === target;
  });
}

/**
 * Scrape Q&A pairs from feedback detail pages.
 * Looks for question text followed by answer text in stacked layout.
 */
function scrapeFeedbackQuestions() {
  const elements = walkElements(document);
  const texts = elements
    .map((el) => textOf(el))
    .filter((t) => t.length > 10 && t.length < 500);

  const satisfactionKeywords = ['satisfied', 'satisfaction', 'recommend', 'experience', 'improvement', 'positive', 'satisfecho', 'satisfecha', 'consultor', 'experiencia'];
  const questions = [];

  for (const text of texts) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const maybeQuestion = lines[0];
    if (!satisfactionKeywords.some((kw) => maybeQuestion.toLowerCase().includes(kw))) continue;

    questions.push({
      question: maybeQuestion,
      answer: lines.slice(1).join(' '),
    });
  }

  // Dedupe by question text
  const seen = new Set();
  return questions.filter((q) => {
    if (seen.has(q.question)) return false;
    seen.add(q.question);
    return true;
  });
}

function scrapeRelatedListRows(listTitle) {
  const titleLower = listTitle.toLowerCase();
  const elements = walkElements(document);

  for (const el of elements) {
    const text = textOf(el);
    if (!text.toLowerCase().includes(titleLower)) continue;

    const container = el.closest('article, section, .slds-card, lst-related-list-view-manager') || el.parentElement;
    if (!container) continue;

    const links = container.querySelectorAll('a[href]');
    const rows = [];
    for (const link of links) {
      const rowText = textOf(link);
      if (rowText && /WOH\s*SR|SR-\d+/i.test(rowText)) {
        rows.push({
          name: rowText,
          href: link.href,
          id: parseRecordId(link.href),
        });
      }
    }
    if (rows.length) return rows;
  }
  return [];
}

function isFeedbackPage() {
  const bodyText = textOf(document.body).toLowerCase();
  return (
    bodyText.includes('feedback details') ||
    bodyText.includes('feedback form') ||
    bodyText.includes('view submitted feedback')
  );
}

function mapQuestionsToFields(questions) {
  if (window.WohCsatParse?.mapQuestionsToFields) {
    return window.WohCsatParse.mapQuestionsToFields(questions);
  }
  return { overall_satisfaction: '', consultant_satisfaction: '', comments: '' };
}

/**
 * Normalize CSAT answers across English, Japanese, French, Spanish, and star ratings.
 * Returns: 'very_satisfied' | 'satisfied' | 'neither' | 'other' | ''
 *
 * Star mapping:
 * - 5★ → very_satisfied (green)
 * - 4★ → satisfied (yellow)
 * - 3★ → neither (red)
 * - 1–2★ → other (red)
 */
function normalizeCsatLevel(raw) {
  if (raw == null || raw === '') return '';
  const text = String(raw).replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const lower = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

  // Star counts: ★☆✦✩⭐ or "5 stars" / "★★★★★" / bare "4"
  if (/^[1-5]$/.test(text)) {
    const n = Number(text);
    if (n === 5) return 'very_satisfied';
    if (n === 4) return 'satisfied';
    if (n === 3) return 'neither';
    return 'other';
  }
  const filledStars = (text.match(/[★✦⭐]/g) || []).length;
  const starNumber =
    lower.match(/\b([1-5])\s*(?:\/\s*5)?\s*-?\s*stars?\b/) ||
    lower.match(/\brat(?:ing|ed)?\s*[:=]?\s*([1-5])\b/);
  const stars = filledStars || (starNumber ? Number(starNumber[1]) : 0);
  if (stars === 5) return 'very_satisfied';
  if (stars === 4) return 'satisfied';
  if (stars === 3) return 'neither';
  if (stars === 1 || stars === 2) return 'other';

  // Japanese (check longer phrases first)
  if (/非常に満足|とても満足|大変満足/.test(text)) return 'very_satisfied';
  if (/やや満足/.test(text)) return 'satisfied';
  if (/どちらでもない/.test(text)) return 'neither';
  if (/満足/.test(text) && !/不満/.test(text)) return 'satisfied';
  if (/非常に不満|とても不満|やや不満|不満/.test(text)) return 'other';

  // French (accent-insensitive via lower)
  if (/tres\s+satisfait|tr[eè]s\s+satisfait|tres\s+satisfaite/.test(lower) || /Très satisfait/i.test(text)) {
    return 'very_satisfied';
  }
  if (/ni\s+satisfait\s+ni\s+insatisfait|ni satisfait ni/.test(lower)) return 'neither';
  if (/peu\s+satisfait|pas\s+satisfait|insatisfait|tres\s+insatisfait|tr[eè]s\s+insatisfait/.test(lower)) {
    return 'other';
  }
  if (/^satisfait[ei]?s?$/.test(lower) || lower === 'satisfait' || lower === 'satisfaite') {
    return 'satisfied';
  }

  // Spanish (accent-insensitive via lower)
  if (/muy\s+satisfech[oa]s?/.test(lower)) return 'very_satisfied';
  if (/ni\s+satisfech[oa]\s+ni\s+insatisfech[oa]|ni satisfecho ni|ni satisfecha ni/.test(lower)) {
    return 'neither';
  }
  if (
    /poco\s+satisfech[oa]|algo\s+insatisfech[oa]|muy\s+insatisfech[oa]|insatisfech[oa]/.test(lower)
  ) {
    return 'other';
  }
  if (/^satisfech[oa]s?$/.test(lower)) return 'satisfied';

  // English
  if (/very\s+satisfied/.test(lower)) return 'very_satisfied';
  if (/somewhat\s+satisfied/.test(lower)) return 'satisfied';
  if (/neither/.test(lower)) return 'neither';
  if (/^satisfied$/.test(lower) || lower === 'satisfied') return 'satisfied';
  if (/\bsatisfied\b/.test(lower) && !/dis/.test(lower) && !/neither/.test(lower)) {
    if (/extremely|highly|completely/.test(lower)) return 'very_satisfied';
  }
  if (/dissatisfied|dis-satisfied|poor|bad/.test(lower)) return 'other';

  return 'other';
}

function csatRowClass(rawSatisfaction) {
  const level = normalizeCsatLevel(rawSatisfaction);
  if (level === 'very_satisfied') return 'csat-green';
  if (level === 'satisfied') return 'csat-yellow';
  if (!rawSatisfaction) return 'csat-error';
  return 'csat-red';
}

/**
 * Display CSAT in standardized English for the results table.
 * Examples: 非常に満足 / Très satisfait / Muy satisfecho / 5 stars → Very satisfied
 */
function formatCsatEnglish(raw) {
  if (raw == null || String(raw).trim() === '') return '';
  const text = String(raw).replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const level = normalizeCsatLevel(text);

  if (level === 'very_satisfied') return 'Very satisfied';
  if (level === 'satisfied') return 'Satisfied';
  if (level === 'neither') return 'Neither satisfied nor dissatisfied';

  // Finer English labels for negative when we can detect them
  if (
    /very\s+dissatisfied|非常に不満|とても不満|tres\s+insatisfait|tr[eè]s\s+insatisfait|muy\s+insatisfech[oa]/.test(
      lower
    ) ||
    text.includes('非常に不満') ||
    /Très insatisfait/i.test(text)
  ) {
    return 'Very dissatisfied';
  }
  if (
    /somewhat\s+dissatisfied|やや不満|peu\s+satisfait|pas\s+satisfait|poco\s+satisfech[oa]|algo\s+insatisfech[oa]/.test(
      lower
    ) ||
    text.includes('やや不満')
  ) {
    return 'Somewhat dissatisfied';
  }
  if (/^[12]$/.test(text) || /\b[12]\s*stars?\b/.test(lower) || (text.match(/[★]/g) || []).length === 1 || (text.match(/[★]/g) || []).length === 2) {
    return Number(text) === 1 || /\b1\s*stars?\b/.test(lower) || (text.match(/[★]/g) || []).length === 1
      ? 'Very dissatisfied'
      : 'Somewhat dissatisfied';
  }
  if (/dissatisfied|insatisfait|insatisfech|不満/.test(lower) || text.includes('不満')) return 'Dissatisfied';

  return 'Other';
}

function extractStarRatingsFromDoc(doc) {
  const ratings = [];

  const selects = [...doc.querySelectorAll('select.star-rating, select[class*="star-rating"]')];
  for (const select of selects) {
    const selected =
      select.querySelector('option[selected], option[selected="selected"]') ||
      [...select.options].find((o) => o.selected);
    const val = (selected?.value || select.value || '').trim();
    if (/^[1-5]$/.test(val)) ratings.push(`${val} stars`);
  }

  if (ratings.length) return ratings;

  // Barrating widget fallback (after JS render)
  const current = [...doc.querySelectorAll('.br-current-rating')]
    .map((el) => textOf(el))
    .filter((t) => /^[1-5]$/.test(t));
  return current.map((n) => `${n} stars`);
}

function extractStarRatingsFromHtml(html) {
  const ratings = [];
  const selectRe =
    /<select[^>]*class="[^"]*star-rating[^"]*"[^>]*>([\s\S]*?)<\/select>/gi;
  let match;
  while ((match = selectRe.exec(html))) {
    const block = match[1];
    const selected = block.match(/<option[^>]*value="([1-5])"[^>]*selected[^>]*>/i)
      || block.match(/<option[^>]*selected[^>]*value="([1-5])"[^>]*>/i);
    if (selected) ratings.push(`${selected[1]} stars`);
  }
  if (ratings.length) return ratings;

  const currentRe = /class="[^"]*br-current-rating[^"]*"[^>]*>\s*([1-5])\s*</gi;
  while ((match = currentRe.exec(html))) {
    ratings.push(`${match[1]} stars`);
  }
  return ratings;
}

/**
 * Parse Visualforce WHT_FeedBackDetail HTML (from fetch or live document).
 */
function parseFeedbackHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const bodyText = textOf(doc.body);
  const rawHtml = String(html || '');

  const submittedLine = bodyText.match(
    /Submitted\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+By:\s*(.+?)(?:\s+Request:|$)/i
  );
  const reqMatch = window.WohRequestNumber?.extractAppointmentNumber
    ? window.WohRequestNumber.extractAppointmentNumber(bodyText)
    : bodyText.match(/\b(?:REQ|OPR)-\d+\b/i)?.[0] || '';

  const mapped = {
    overall_satisfaction: '',
    consultant_satisfaction: '',
    comments: '',
  };

  // 1) Star-rating widgets (most common for "Please rate…" forms)
  const starRatings =
    extractStarRatingsFromDoc(doc).length
      ? extractStarRatingsFromDoc(doc)
      : extractStarRatingsFromHtml(rawHtml);
  if (starRatings[0]) mapped.overall_satisfaction = starRatings[0];
  if (starRatings[1]) mapped.consultant_satisfaction = starRatings[1];

  // 2) Likert text answers (AAE, Optimization Package / OPR, JA/FR/ES)
  if (!mapped.overall_satisfaction || !mapped.consultant_satisfaction) {
    const fromText = window.WohCsatParse?.extractCsatFromBodyText
      ? window.WohCsatParse.extractCsatFromBodyText(bodyText)
      : { overall_satisfaction: '', consultant_satisfaction: '', comments: '' };
    mapped.overall_satisfaction = mapped.overall_satisfaction || fromText.overall_satisfaction;
    mapped.consultant_satisfaction = mapped.consultant_satisfaction || fromText.consultant_satisfaction;
    mapped.comments = mapped.comments || fromText.comments;
  }

  if (!mapped.overall_satisfaction || !mapped.consultant_satisfaction) {
    const fromDom = mapQuestionsToFields(scrapeFeedbackQuestionsFromRoot(doc));
    mapped.overall_satisfaction = mapped.overall_satisfaction || fromDom.overall_satisfaction;
    mapped.consultant_satisfaction = mapped.consultant_satisfaction || fromDom.consultant_satisfaction;
    mapped.comments = mapped.comments || fromDom.comments;
  }

  let consultantName = '';
  const consultantMatch = bodyText.match(
    /Consultants?\s+([A-Za-z][A-Za-z .'-]{1,60})(?:\s+Product|\s+Sub Product|\s+Feedback)/i
  );
  if (consultantMatch) consultantName = consultantMatch[1].trim();

  let product = '';
  const productMatch = bodyText.match(/Product\s+(.+?)\s+Sub Product/i);
  if (productMatch) product = productMatch[1].trim();

  let subProduct = '';
  const subMatch = bodyText.match(/Sub Product\s+(.+?)\s+Feedback Form/i);
  if (subMatch) subProduct = subMatch[1].trim();

  return {
    req_number: reqMatch || '',
    submitted_at: submittedLine ? submittedLine[1] : '',
    submitted_by: submittedLine ? submittedLine[2].trim() : '',
    consultant_name: consultantName,
    product,
    sub_product: subProduct,
    overall_satisfaction: mapped.overall_satisfaction,
    consultant_satisfaction: mapped.consultant_satisfaction,
    comments: mapped.comments,
    overall_satisfaction_level: normalizeCsatLevel(mapped.overall_satisfaction),
    body_excerpt: bodyText.slice(0, 400),
  };
}

function scrapeFeedbackQuestionsFromRoot(root) {
  const elements = walkElements(root);
  const texts = elements
    .map((el) => textOf(el))
    .filter((t) => t.length > 10 && t.length < 500);

  const satisfactionKeywords = [
    'satisfied',
    'satisfaction',
    'recommend',
    'experience',
    'improvement',
    'positive',
    '満足',
    'コンサルタント',
    'エクスペリエンス',
    'satisfait',
    'consultants',
    'expérience',
    'satisfecho',
    'satisfecha',
    'consultor',
    'experiencia',
  ];
  const questions = [];

  for (const text of texts) {
    const parts = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const maybeQuestion = parts[0];
    if (!satisfactionKeywords.some((kw) => maybeQuestion.toLowerCase().includes(kw.toLowerCase()) || maybeQuestion.includes(kw)))
      continue;
    questions.push({ question: maybeQuestion, answer: parts.slice(1).join(' ') });
  }

  const seen = new Set();
  return questions.filter((q) => {
    if (seen.has(q.question)) return false;
    seen.add(q.question);
    return true;
  });
}

// Expose for other content scripts (same isolated world per file, but functions are global in IIFE-less scripts)
window.WohScrape = {
  walkElements,
  sleep,
  waitFor,
  textOf,
  parseRecordId,
  parseAccountId,
  parseAppointmentId,
  isAppointmentUrl,
  isAccountUrl,
  getFieldByLabel,
  findAccountOnPage,
  findPrimaryNscContact,
  normalizePersonName,
  namesMatch,
  normalizeCsatLevel,
  formatCsatEnglish,
  csatRowClass,
  findLinkByText,
  scrapeFeedbackQuestions,
  scrapeRelatedListRows,
  isFeedbackPage,
  mapQuestionsToFields,
  parseFeedbackHtml,
  scrapeFeedbackQuestionsFromRoot,
};
