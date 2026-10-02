/**
 * Persistent in-page results panel (stays until user clicks X).
 * Cache: browser.storage.local, 12-hour TTL per Account Id.
 */
(function initWohSurveyPanel() {
  const api = globalThis.browser ?? globalThis.chrome;
  const PANEL_ID = 'woh-account-surveys-panel-host';
  const CACHE_KEY = 'accountSurveyCache';
  const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

  const PANEL_CSS = `
        :host { all: initial; }
        .panel {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          width: min(560px, calc(100vw - 32px));
          max-height: calc(100vh - 96px);
          overflow: auto;
          background: #fff;
          color: #1f1f1f;
          border-radius: 12px;
          box-shadow: 0 8px 28px rgba(0,0,0,.22);
          border: 1px solid #e5e5e5;
        }
        .header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px 8px;
          border-bottom: 1px solid #eee;
          position: sticky;
          top: 0;
          background: #fff;
          z-index: 1;
        }
        .title { font-size: 15px; font-weight: 700; margin: 0; }
        .subtitle { font-size: 12px; color: #666; margin: 2px 0 0; }
        .account-row { margin-top: 6px; }
        .account { font-size: 12px; font-weight: 600; color: #333; min-width: 0; }
        .avg-badge {
          flex: none;
          align-self: center;
          width: 72px;
          height: 72px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #d4edda;
          color: #1f1f1f;
          font-size: 16px;
          font-weight: 800;
          letter-spacing: -0.03em;
          line-height: 1;
          box-shadow: inset 0 0 0 2px #b7dfc4;
        }
        .avg-badge.mid {
          background: #fff3cd;
          box-shadow: inset 0 0 0 2px #ffe08a;
        }
        .avg-badge.low {
          background: #f8d7da;
          box-shadow: inset 0 0 0 2px #f1b0b7;
        }
        .header-text { flex: 1; min-width: 0; }
        .close {
          border: none;
          background: transparent;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          color: #666;
          padding: 0 4px;
          border-radius: 6px;
          align-self: flex-start;
        }
        .close:hover { background: #f0f0f0; color: #111; }
        .body { padding: 10px 14px 14px; }
        .status-line { font-size: 12px; color: #555; margin-bottom: 8px; }
        .cache { font-size: 11px; color: #666; margin-bottom: 8px; }
        .notice {
          font-size: 12px;
          margin: 0 0 10px;
          padding: 8px 10px;
          border-radius: 8px;
          background: #fff4e5;
          border: 1px solid #f0d2a0;
          color: #6a4b00;
          line-height: 1.35;
        }
        .notice.ok {
          background: #e8f5e9;
          border-color: #a5d6a7;
          color: #1b5e20;
        }
        .trend {
          margin: 0 0 12px;
          padding: 8px 8px 2px;
          border: 1px solid #e5e5e5;
          border-radius: 8px;
          background: #fafafa;
        }
        .trend-head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin: 0 0 4px;
        }
        .trend-title {
          font-size: 11px;
          font-weight: 700;
          color: #333;
          margin: 0;
          flex: none;
        }
        .ratio-circle {
          flex: none;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #e7f1fb;
          color: #1f1f1f;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: -0.03em;
          line-height: 1;
          box-shadow: inset 0 0 0 2px #b9d4f0;
        }
        .trend-empty {
          margin: 12px 4px 16px;
          padding: 18px 14px;
          font-size: 16px;
          font-weight: 700;
          line-height: 1.35;
          color: #7a3e00;
          text-align: center;
          background: #fff4e5;
          border: 1px solid #e8c48a;
          border-radius: 8px;
        }
        .trend-body {
          display: flex;
          align-items: flex-start;
          gap: 8px;
        }
        .trend svg {
          display: block;
          flex: 1 1 auto;
          min-width: 0;
          width: 100%;
          height: auto;
        }
        .trend.can-hover .trend-series { cursor: pointer; }
        .trend.can-hover.contact-focus .trend-series { opacity: 0.28; }
        .trend.can-hover.contact-focus .trend-series.is-hot { opacity: 1; }
        tbody.contact-focus tr:not(.contact-hot) td { opacity: 0.35; }
        tr.contact-hot td { box-shadow: inset 0 2px 0 #0176d3, inset 0 -2px 0 #0176d3; }
        tr.contact-hot td:first-child { box-shadow: inset 4px 0 0 #0176d3, inset 0 2px 0 #0176d3, inset 0 -2px 0 #0176d3; }
        tr.contact-hot td:last-child { box-shadow: inset -2px 0 0 #0176d3, inset 0 2px 0 #0176d3, inset 0 -2px 0 #0176d3; }
        .trend-legend {
          display: flex;
          flex-direction: column;
          flex: 0 0 auto;
          width: max-content;
          max-width: 120px;
          gap: 1px;
          margin: 0;
          padding-top: 2px;
        }
        .trend-legend span {
          display: flex;
          align-items: flex-start;
          gap: 5px;
          font-size: 10px;
          color: #333;
          line-height: 1.35;
          border-radius: 3px;
          padding: 2px 3px;
        }
        .trend.can-hover .trend-legend span { cursor: pointer; }
        .trend.can-hover.contact-focus .trend-legend span { opacity: 0.45; }
        .trend.can-hover.contact-focus .trend-legend span.is-hot {
          opacity: 1;
          background: #e3f2fd;
        }
        .trend-swatch {
          width: 12px;
          height: 3px;
          margin-top: 4px;
          border-radius: 2px;
          flex: none;
        }
        .primary-nsc { font-weight: 700; }
        .linkish {
          border: none;
          background: none;
          color: #0176d3;
          cursor: pointer;
          padding: 0;
          font-size: 11px;
          text-decoration: underline;
        }
        .results-toggle {
          display: inline-block;
          margin: 0 0 10px;
          font-size: 13px;
        }
        .results-block[hidden] { display: none; }
        .error { color: #b00020; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th {
          text-align: left;
          font-size: 11px;
          color: #555;
          padding: 6px 8px;
          border-bottom: 1px solid #ddd;
          background: #f7f7f7;
        }
        td { padding: 8px; border-bottom: 1px solid #eee; vertical-align: top; }
        a { color: #0176d3; font-weight: 600; text-decoration: none; }
        a:hover { text-decoration: underline; }
        tr.csat-green td { background: #d4edda; }
        tr.csat-yellow td { background: #fff3cd; }
        tr.csat-red td { background: #f8d7da; }
        tr.csat-error td { background: #f5f5f5; color: #666; }
  `;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'className') node.className = value;
      else node.setAttribute(key, String(value));
    }
    for (const child of children) {
      if (child == null || child === false) continue;
      node.append(child);
    }
    return node;
  }

  function csatRowClass(overallSatisfaction) {
    if (window.WohScrape?.csatRowClass) {
      return window.WohScrape.csatRowClass(overallSatisfaction);
    }
    const value = String(overallSatisfaction || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    if (value === 'very satisfied' || value.includes('非常に満足') || /5\s*stars?/.test(value) || (String(overallSatisfaction || '').match(/[★]/g) || []).length >= 5) {
      return 'csat-green';
    }
    if (value === 'satisfied' || value === '満足' || value.includes('やや満足') || /4\s*stars?/.test(value)) {
      return 'csat-yellow';
    }
    return 'csat-red';
  }

  async function readCache(accountId) {
    const { [CACHE_KEY]: cache = {} } = await api.storage.local.get(CACHE_KEY);
    const entry = cache[accountId];
    if (!entry?.fetchedAt || !entry?.payload) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
    return entry;
  }

  async function writeCache(accountId, payload) {
    const { [CACHE_KEY]: cache = {} } = await api.storage.local.get(CACHE_KEY);
    cache[accountId] = { fetchedAt: Date.now(), payload };
    // prune expired
    const now = Date.now();
    for (const [id, entry] of Object.entries(cache)) {
      if (!entry?.fetchedAt || now - entry.fetchedAt > CACHE_TTL_MS) delete cache[id];
    }
    await api.storage.local.set({ [CACHE_KEY]: cache });
  }

  function ensureHost() {
    let host = document.getElementById(PANEL_ID);
    if (host) return host;
    host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.zIndex = '2147483646';
    host.style.top = '72px';
    host.style.right = '16px';
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: 'open' });
    return host;
  }

  function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function externalLink(href, label, title) {
    if (!href || label == null || label === '' || label === '—') return label || '—';
    const attrs = { href, target: '_blank', rel: 'noreferrer' };
    if (title) attrs.title = title;
    return el('a', attrs, label);
  }

  function requestHref(survey) {
    if (survey?.appointment_url) return survey.appointment_url;
    const id = survey?.appointment_id;
    if (!id) return '';
    return `${location.origin}/lightning/r/Appointment__c/${encodeURIComponent(id)}/view`;
  }

  function feedbackHref(survey) {
    if (survey?.feedback_url) return survey.feedback_url;
    const id = survey?.appointment_id;
    if (!id) return '';
    return `${location.origin}/apex/WHT_FeedBackDetail?appointmentId=${encodeURIComponent(id)}`;
  }

  function reqNode(survey) {
    const label = window.WohRequestNumber?.requestNumberLabel
      ? window.WohRequestNumber.requestNumberLabel(survey)
      : survey.req_number || survey.appointment_name || '—';
    return externalLink(requestHref(survey), label, 'Open request');
  }

  function csatLinkNode(survey, label) {
    return externalLink(feedbackHref(survey), label, 'Open Feedback Details');
  }

  function customerNode(survey) {
    const name = survey.submitted_by || '—';
    if (survey.is_primary_nsc) {
      return el('strong', { className: 'primary-nsc' }, name);
    }
    return name;
  }

  function averageTone(display) {
    const score = Number(display);
    if (score > 4.5) return 'good';
    if (score >= 4.2) return 'mid';
    return 'low';
  }

  function returnRatioPercent(payload) {
    const csat = payload?.csat_count;
    const requests = payload?.request_count;
    if (Number.isInteger(csat) && Number.isInteger(requests)) {
      if (requests === 0) return '—';
      return `${((csat / requests) * 100).toFixed(1)}%`;
    }
    const display = String(payload?.return_ratio_display || '').trim();
    const percent = display.match(/^(\d+(?:\.\d+)?%|—)/);
    return percent ? percent[1] : '';
  }

  function returnRatioNode(payload) {
    const display = returnRatioPercent(payload);
    if (!display) return null;
    const label = `Return ratio ${display}`;
    return el('div', { className: 'ratio-circle', title: label, 'aria-label': label }, display);
  }

  function trendHeading(payload, title) {
    return el('div', { className: 'trend-head' }, el('p', { className: 'trend-title' }, title), returnRatioNode(payload));
  }

  function accountAverageNode(payload) {
    if (payload?.page_context !== 'account' && payload?.page_context !== 'appointment') return null;
    const display = payload?.csat_average_display;
    if (!display) return null;
    const tone = averageTone(display);
    return el(
      'div',
      {
        className: tone === 'good' ? 'avg-badge' : `avg-badge ${tone}`,
        title: `Average ${display}/5`,
        'aria-label': `Average ${display} out of 5`,
      },
      `${display}/5`
    );
  }

  function svgEl(tag, attrs = {}, ...children) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      node.setAttribute(key, String(value));
    }
    for (const child of children) {
      if (child == null || child === false) continue;
      node.append(child);
    }
    return node;
  }

  const CONTACT_COLORS = [
    '#1b7f3a',
    '#c62828',
    '#6a1b9a',
    '#ef6c00',
    '#00838f',
    '#3949ab',
    '#ad1457',
    '#6d4c41',
    '#00897b',
    '#7cb342',
    '#5e35b1',
    '#f9a825',
  ];

  function contactColor(index) {
    return CONTACT_COLORS[index % CONTACT_COLORS.length];
  }

  function shortTrendDate(raw) {
    const text = String(raw || '').trim();
    const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (mdy) return `${Number(mdy[1])}/${Number(mdy[2])}`;
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${Number(iso[2])}/${Number(iso[3])}`;
    return text.slice(0, 10);
  }

  function emptyCsatText(payload) {
    if (payload?.page_context === 'appointment') {
      const name = String(payload?.primary_nsc_contact || '').trim();
      if (!name) return 'Primary NSC Contact not found on this request.';
      return `This customer ${name} hasn't submitted CSAT.`;
    }
    const decodeText = window.WohHtmlText?.decodeHtmlEntities || ((text) => String(text ?? ''));
    const name = String(payload?.account_name ? decodeText(payload.account_name) : '').trim();
    return name ? `This account ${name} hasn't submitted CSAT.` : "This account hasn't submitted CSAT.";
  }

  function trendSource(payload) {
    if (payload?.page_context === 'account') {
      return { surveys: payload.surveys || [], title: 'Request CSAT trend by contact and return ratio' };
    }
    if (payload?.page_context !== 'appointment') return null;
    return { surveys: payload.surveys || [], title: 'Request CSAT trend and return ratio' };
  }

  function trendChartNode(payload) {
    const source = trendSource(payload);
    if (!source) return null;
    const trend = window.WohCsatParse?.csatTrendByContact
      ? window.WohCsatParse.csatTrendByContact(source.surveys)
      : { points: [], series: [] };
    const points = trend.points || [];
    const series = trend.series || [];
    if (!points.length) {
      return el(
        'div',
        { className: 'trend' },
        trendHeading(payload, source.title),
        el('p', { className: 'trend-empty' }, emptyCsatText(payload))
      );
    }

    const width = 520;
    const height = 176;
    const left = 32;
    const right = 36;
    const top = 12;
    const bottom = 42;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const xAt = (index) =>
      points.length === 1 ? left + plotW / 2 : left + (index * plotW) / (points.length - 1);
    const yAt = (score) => top + ((5 - score) / 4) * plotH;
    const average = points.reduce((sum, point) => sum + point.score, 0) / points.length;
    const parts = [];

    for (let score = 1; score <= 5; score += 1) {
      const y = yAt(score);
      parts.push(
        svgEl('line', {
          x1: left,
          y1: y,
          x2: left + plotW,
          y2: y,
          stroke: '#e6e6e6',
          'stroke-width': 1,
          'pointer-events': 'none',
        }),
        svgEl(
          'text',
          {
            x: left - 6,
            y: y + 3,
            'text-anchor': 'end',
            fill: '#777',
            'font-size': 10,
            'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
            'pointer-events': 'none',
          },
          String(score)
        )
      );
    }

    parts.push(
      svgEl('line', {
        x1: left,
        y1: yAt(average),
        x2: left + plotW,
        y2: yAt(average),
        stroke: '#0176d3',
        'stroke-width': 1.25,
        'stroke-dasharray': '4 3',
        'pointer-events': 'none',
      })
    );

    const hoverable = payload?.page_context === 'account';
    series.forEach((entry, seriesIndex) => {
      const color = contactColor(seriesIndex);
      const coords = entry.points.map((point) => `${xAt(point.index)},${yAt(point.score)}`).join(' ');
      const seriesNodes = [];
      if (entry.points.length > 1) {
        seriesNodes.push(
          svgEl('polyline', {
            points: coords,
            fill: 'none',
            stroke: color,
            'stroke-width': 1.75,
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
            'pointer-events': 'none',
          })
        );
        if (hoverable) {
          seriesNodes.push(
            svgEl('polyline', {
              class: 'trend-hit',
              points: coords,
              fill: 'none',
              stroke: 'transparent',
              'stroke-width': 14,
              'stroke-linejoin': 'round',
              'stroke-linecap': 'round',
              'pointer-events': 'stroke',
            })
          );
        }
      }
      entry.points.forEach((point) => {
        const tip = [contactFirstName(point.contact), point.date, point.label, String(point.score)].filter(Boolean).join(' · ');
        if (hoverable) {
          seriesNodes.push(
            svgEl('circle', {
              class: 'trend-hit',
              cx: xAt(point.index),
              cy: yAt(point.score),
              r: 9,
              fill: 'transparent',
              stroke: 'none',
              'pointer-events': 'fill',
            })
          );
        }
        seriesNodes.push(
          svgEl(
            'circle',
            {
              cx: xAt(point.index),
              cy: yAt(point.score),
              r: 4,
              fill: color,
              stroke: '#fff',
              'stroke-width': 1.5,
              'pointer-events': 'none',
            },
            svgEl('title', {}, tip)
          )
        );
      });
      parts.push(
        svgEl('g', { class: 'trend-series', 'data-contact': entry.contact }, ...seriesNodes)
      );
    });

    let lastLabelX = -Infinity;
    points.forEach((point, index) => {
      const dateLabel = shortTrendDate(point.date);
      const previousLabel = index > 0 ? shortTrendDate(points[index - 1].date) : '';
      if (!dateLabel || dateLabel === previousLabel) return;
      const x = xAt(index);
      const isLast = index === points.length - 1;
      if (!isLast && x - lastLabelX < 28) return;
      lastLabelX = x;
      const labelY = top + plotH + 12;
      parts.push(
        svgEl(
          'text',
          {
            x,
            y: labelY,
            transform: `rotate(50 ${x} ${labelY})`,
            'text-anchor': 'start',
            fill: '#666',
            'font-size': 10,
            'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
            'pointer-events': 'none',
          },
          dateLabel
        )
      );
    });

    const aria = series
      .map((entry) => `${contactFirstName(entry.contact)}: ${entry.points.map((point) => point.score).join(', ')}`)
      .join('. ');
    const svg = svgEl(
      'svg',
      {
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-label': `${source.title}. ${aria}. Average ${average.toFixed(1)}.`,
      },
      ...parts
    );

    const legend = el(
      'div',
      { className: 'trend-legend' },
      ...series.map((entry, seriesIndex) =>
        el(
          'span',
          { 'data-contact': entry.contact },
          el('i', { className: 'trend-swatch', style: `background:${contactColor(seriesIndex)}` }),
          contactFirstName(entry.contact)
        )
      )
    );

    return el(
      'div',
      { className: hoverable ? 'trend can-hover' : 'trend' },
      trendHeading(payload, source.title),
      el('div', { className: 'trend-body' }, svg, legend)
    );
  }

  function contactFirstName(name) {
    const text = String(name || '').replace(/\s+/g, ' ').trim();
    if (!text || text === 'Unknown') return text || 'Unknown';
    if (text.includes(',')) {
      const given = text.split(',').slice(1).join(' ').trim();
      if (given) return given.split(/\s+/)[0];
    }
    return text.split(/\s+/)[0];
  }

  function rowContact(survey) {
    const name = String(survey?.submitted_by || '')
      .replace(/\s+/g, ' ')
      .trim();
    return name || 'Unknown';
  }

  function surveyRow(survey) {
    const contact = rowContact(survey);
    if (!survey.ok) {
      return el(
        'tr',
        { className: 'csat-error', 'data-contact': contact },
        el('td', {}, reqNode(survey)),
        el('td', {}, survey.submitted_at || '—'),
        el('td', {}, customerNode(survey)),
        el('td', {}, survey.error || 'Failed')
      );
    }
    const csat =
      (window.WohScrape?.formatCsatEnglish
        ? window.WohScrape.formatCsatEnglish(survey.overall_satisfaction)
        : survey.overall_satisfaction) || '—';
    return el(
      'tr',
      { className: csatRowClass(survey.overall_satisfaction), 'data-contact': contact },
      el('td', {}, reqNode(survey)),
      el('td', {}, survey.submitted_at || '—'),
      el('td', {}, customerNode(survey)),
      el('td', {}, csatLinkNode(survey, csat))
    );
  }

  function surveyTableNode(payload) {
    return el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Request #'),
          el('th', {}, 'Survey date'),
          el('th', {}, 'Customer'),
          el('th', {}, 'Request CSAT')
        )
      ),
      el('tbody', {}, ...(payload.surveys || []).map(surveyRow))
    );
  }

  function bodyNodes({ statusText, payload, fromCache, error }) {
    if (error) {
      return [el('div', { className: 'error' }, String(error))];
    }
    if (!payload) {
      return [el('div', { className: 'status-line' }, statusText || 'Loading…')];
    }
    const nodes = [];
    if (statusText) nodes.push(el('div', { className: 'status-line' }, statusText));
    if (fromCache) {
      nodes.push(
        el(
          'div',
          { className: 'cache' },
          'Cached result (valid up to 12 hours). ',
          el('button', { type: 'button', className: 'linkish', id: 'woh-refresh' }, 'Refresh now')
        )
      );
    }
    const chart = trendChartNode(payload);
    if (chart) nodes.push(chart);
    if (!(payload.surveys || []).length) return nodes;
    const table = surveyTableNode(payload);
    if (payload.page_context === 'account') {
      const count = (payload.surveys || []).length;
      nodes.push(
        el(
          'button',
          { type: 'button', className: 'linkish results-toggle', id: 'woh-results-toggle' },
          `Show ${count} survey results`
        ),
        el('div', { className: 'results-block', hidden: true }, table)
      );
    } else {
      nodes.push(table);
    }
    return nodes;
  }

  function renderPanel({ statusText, payload, fromCache, error }) {
    const host = ensureHost();
    const root = host.shadowRoot;
    const decodeText = window.WohHtmlText?.decodeHtmlEntities || ((text) => String(text ?? ''));
    const accountName = payload?.account_name ? decodeText(payload.account_name) : '';
    const contactName = String(payload?.primary_nsc_contact || '').trim();
    const contactId = String(payload?.primary_nsc_id || '').trim();
    const contactLabel = contactName
      ? contactId
        ? `Contact: ${contactName} (${contactId})`
        : `Contact: ${contactName}`
      : contactId
        ? `Contact: ${contactId}`
        : '';
    const contextLine =
      payload?.page_context === 'appointment'
        ? contactLabel
        : payload
          ? accountName
            ? `Account: ${accountName} (${payload.account_id || ''})`
            : payload.account_id
              ? `Account: ${payload.account_id}`
              : ''
          : '';

    const headerText = el(
      'div',
      { className: 'header-text' },
      el('p', { className: 'title' }, 'Survey History Tracking'),
      el(
        'p',
        { className: 'subtitle' },
        payload?.page_context === 'account'
          ? '20 most recent surveys for this Account'
          : payload?.page_context === 'appointment'
            ? '10 most recent surveys for this Primary NSC Contact'
            : 'Most recent surveys for this Account'
      ),
      contextLine
        ? el('div', { className: 'account-row' }, el('div', { className: 'account' }, contextLine))
        : null
    );

    const panel = el(
      'div',
      { className: 'panel', role: 'dialog', 'aria-label': 'Survey History Tracking' },
      el(
        'div',
        { className: 'header' },
        headerText,
        accountAverageNode(payload),
        el('button', { type: 'button', className: 'close', id: 'woh-close', title: 'Close', 'aria-label': 'Close' }, '×')
      ),
      el('div', { className: 'body' }, ...bodyNodes({ statusText, payload, fromCache, error }))
    );

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    root.replaceChildren(style, panel);

    root.getElementById('woh-close')?.addEventListener('click', closePanel);
    root.getElementById('woh-refresh')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('woh-survey-refresh'));
    });
    root.getElementById('woh-results-toggle')?.addEventListener('click', () => {
      const block = root.querySelector('.results-block');
      const button = root.getElementById('woh-results-toggle');
      if (!block || !button) return;
      const show = block.hidden;
      block.hidden = !show;
      const count = block.querySelectorAll('tbody tr').length;
      button.textContent = show ? 'Hide survey results' : `Show ${count} survey results`;
    });
    bindTrendHover(root);
  }

  function scrollRowIntoPanel(row) {
    const panel = row.closest('.panel');
    if (!panel) return;
    const rowRect = row.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (rowRect.top < panelRect.top) {
      panel.scrollTop -= panelRect.top - rowRect.top + 8;
    } else if (rowRect.bottom > panelRect.bottom) {
      panel.scrollTop += rowRect.bottom - panelRect.bottom + 8;
    }
  }

  function bindTrendHover(root) {
    const panel = root.querySelector('.panel');
    const trend = root.querySelector('.trend.can-hover');
    const tbody = root.querySelector('tbody');
    if (!panel || !trend || !tbody) return;

    let active = '';

    const clear = () => {
      active = '';
      trend.classList.remove('contact-focus');
      tbody.classList.remove('contact-focus');
      trend.querySelectorAll('.is-hot').forEach((node) => node.classList.remove('is-hot'));
      tbody.querySelectorAll('tr.contact-hot').forEach((node) => node.classList.remove('contact-hot'));
    };

    const show = (contact, series) => {
      if (!contact || contact === active) return;
      clear();
      active = contact;
      trend.classList.add('contact-focus');
      tbody.classList.add('contact-focus');
      series?.classList.add('is-hot');
      trend.querySelector(`.trend-legend [data-contact="${CSS.escape(contact)}"]`)?.classList.add('is-hot');
      let first = null;
      tbody.querySelectorAll('tr').forEach((row) => {
        if (row.getAttribute('data-contact') !== contact) return;
        row.classList.add('contact-hot');
        if (!first) first = row;
      });
      if (first) scrollRowIntoPanel(first);
    };

    trend.querySelectorAll('.trend-series').forEach((series) => {
      const contact = series.getAttribute('data-contact');
      series.addEventListener('mouseenter', () => show(contact, series));
    });
    trend.querySelectorAll('.trend-legend [data-contact]').forEach((item) => {
      const contact = item.getAttribute('data-contact');
      const series = trend.querySelector(`.trend-series[data-contact="${CSS.escape(contact)}"]`);
      item.addEventListener('mouseenter', () => show(contact, series));
    });

    panel.addEventListener('click', (event) => {
      if (!active) return;
      const target = event.target;
      if (target.closest('.trend-series, .trend-legend [data-contact], tbody tr, a, button')) return;
      clear();
    });
  }

  window.WohSurveyPanel = {
    CACHE_TTL_MS,
    readCache,
    writeCache,
    renderPanel,
    closePanel,
    setStatus(text) {
      renderPanel({ statusText: text, payload: null });
    },
    showPayload(payload, { fromCache = false, statusText = '' } = {}) {
      const okCount = (payload.surveys || []).filter((s) => s.ok).length;
      const total = (payload.surveys || []).length;
      const quietEmpty = total === 0 && Boolean(trendSource(payload));
      renderPanel({
        payload,
        fromCache,
        statusText:
          statusText ||
          (quietEmpty
            ? ''
            : fromCache
              ? `Showing ${okCount} of ${total} surveys (from cache).`
              : `Showing ${okCount} of ${total} most recent surveys.`),
      });
    },
    showError(error) {
      renderPanel({ error: String(error), payload: null });
    },
  };
})();
