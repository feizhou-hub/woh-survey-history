/**
 * CSAT answer extraction from Visualforce feedback body text / Q&A pairs.
 * Shared by content scripts and Node tests.
 */
(function initWohCsatParse(root) {
  const ENGLISH_ANSWERS =
    'Very satisfied|Somewhat satisfied|Neither satisfied nor dissatisfied|Somewhat dissatisfied|Very dissatisfied|Satisfied|Dissatisfied';
  const JAPANESE_ANSWERS =
    '非常に満足|とても満足|大変満足|やや満足|満足|どちらでもない|やや不満|非常に不満|不満';
  const FRENCH_ANSWERS =
    'Très satisfait|Tres satisfait|Très satisfaite|Satisfait|Satisfaite|Ni satisfait ni insatisfait|Peu satisfait|Pas satisfait|Insatisfait|Très insatisfait|Tres insatisfait';
  const SPANISH_ANSWERS =
    'Muy satisfecho|Muy satisfecha|Satisfecho|Satisfecha|Ni satisfecho ni insatisfecho|Ni satisfecha ni insatisfecha|Poco satisfecho|Poco satisfecha|Algo insatisfecho|Algo insatisfecha|Insatisfecho|Insatisfecha|Muy insatisfecho|Muy insatisfecha';
  const ANSWER_GROUP = `(${ENGLISH_ANSWERS}|${JAPANESE_ANSWERS}|${FRENCH_ANSWERS}|${SPANISH_ANSWERS}|[1-5]\\s*stars?|[★]{1,5})`;

  function mapQuestionsToFields(questions) {
    const result = {
      overall_satisfaction: '',
      consultant_satisfaction: '',
      comments: '',
    };

    for (const { question, answer } of questions) {
      const q = question.toLowerCase();
      const qJa = question;
      // Consultant overall must win before generic "overall … satisfied"
      // (OPR: "…consultant(s) assigned to this engagement?").
      if (
        q.includes('consultant') ||
        /コンサルタントにどの程度満足|consultant\(s\) assigned/i.test(qJa)
      ) {
        result.consultant_satisfaction = answer;
      } else if (
        (q.includes('overall') &&
          (q.includes('satisfied') ||
            q.includes('request') ||
            q.includes('experience') ||
            q.includes('optimization'))) ||
        /この\s*Ask-an-Expert|リクエストにどの程度満足|overall experience with this request/i.test(qJa)
      ) {
        result.overall_satisfaction = answer;
      } else if (
        q.includes('positive') ||
        q.includes('improvement') ||
        q.includes('share') ||
        /良かった点|改善すべき|エクスペリエンス/i.test(qJa)
      ) {
        result.comments = answer;
      }
    }

    return result;
  }

  function firstMatch(bodyText, patterns) {
    for (const re of patterns) {
      const m = bodyText.match(re);
      if (m) return m[1].trim();
    }
    return '';
  }

  function extractCsatFromBodyText(bodyText) {
    const text = String(bodyText || '');
    const mapped = {
      overall_satisfaction: '',
      consultant_satisfaction: '',
      comments: '',
    };

    const overallPatterns = [
      new RegExp(
        `Overall,\\s*how satisfied were you with this (?!consultant)[^?]+\\?\\s*${ANSWER_GROUP}`,
        'i'
      ),
      new RegExp(
        `Overall,\\s*how satisfied were you with this Ask-an-Expert request\\?\\s*${ANSWER_GROUP}`,
        'i'
      ),
      new RegExp(`Please rate your overall experience with this request\\s*${ANSWER_GROUP}`, 'i'),
      /全体的に見て、この\s*Ask-an-Expert\s*リクエストにどの程度満足していますか？\s*(非常に満足|とても満足|大変満足|やや満足|満足|どちらでもない|やや不満|非常に不満|不満)/,
      new RegExp(
        `Dans l'ensemble, avez-vous été satisfait de cette demande de mise en contact avec un expert\\s*\\?\\s*${ANSWER_GROUP}`,
        'i'
      ),
      new RegExp(
        `En general,?\\s*¿?está satisfech[oa] con esta solicitud(?: de contacto con un experto)?\\s*\\??\\s*${ANSWER_GROUP}`,
        'i'
      ),
    ];

    const consultantPatterns = [
      new RegExp(
        `Overall,\\s*how satisfied were you with the consultant\\(s\\) assigned[^?]*\\?\\s*${ANSWER_GROUP}`,
        'i'
      ),
      new RegExp(
        `Overall,\\s*how satisfied were you with the consultant\\(s\\) assigned to this request\\?\\s*${ANSWER_GROUP}`,
        'i'
      ),
      new RegExp(`Please rate the consultant\\(s\\) assigned to this request\\s*${ANSWER_GROUP}`, 'i'),
      /全体的に見て、このリクエストに割り当てられたコンサルタントにどの程度満足していますか？\s*(非常に満足|とても満足|大変満足|やや満足|満足|どちらでもない|やや不満|非常に不満|不満)/,
      new RegExp(
        `Dans l'ensemble, avez-vous été satisfait du ou des consultants affectés à cette demande\\s*\\?\\s*${ANSWER_GROUP}`,
        'i'
      ),
      new RegExp(
        `En general,?\\s*¿?está satisfech[oa] con (?:el |los |la |las )?consultor(?:es)?(?: asignad[oa]s? a esta solicitud)?\\s*\\??\\s*${ANSWER_GROUP}`,
        'i'
      ),
    ];

    mapped.overall_satisfaction = firstMatch(text, overallPatterns);
    mapped.consultant_satisfaction = firstMatch(text, consultantPatterns);

    const esLikert =
      'Muy satisfech[oa]|Satisfech[oa]|Ni satisfecho ni insatisfecho|Ni satisfecha ni insatisfecha|Poco satisfech[oa]|Algo insatisfecho|Algo insatisfecha|Insatisfech[oa]|Muy insatisfecho|Muy insatisfecha';

    if (!mapped.overall_satisfaction) {
      const fr = text.match(
        /demande de mise en contact avec un expert\s*\?\s*(Très satisfait[ei]?|Satisfait[ei]?|Ni satisfait ni insatisfait|Peu satisfait|Pas satisfait|Insatisfait|Très insatisfait)/i
      );
      if (fr) mapped.overall_satisfaction = fr[1].trim();
    }
    if (!mapped.consultant_satisfaction) {
      const fr = text.match(
        /consultants affectés à cette demande\s*\?\s*(Très satisfait[ei]?|Satisfait[ei]?|Ni satisfait ni insatisfait|Peu satisfait|Pas satisfait|Insatisfait|Très insatisfait)/i
      );
      if (fr) mapped.consultant_satisfaction = fr[1].trim();
    }
    if (!mapped.overall_satisfaction) {
      const es = text.match(
        new RegExp(`solicitud(?: de contacto con un experto)?\\s*\\??\\s*(${esLikert})`, 'i')
      );
      if (es) mapped.overall_satisfaction = es[1].trim();
    }
    if (!mapped.consultant_satisfaction) {
      const es = text.match(
        new RegExp(`consultor(?:es)?(?: asignad[oa]s? a esta solicitud)?\\s*\\??\\s*(${esLikert})`, 'i')
      );
      if (es) mapped.consultant_satisfaction = es[1].trim();
    }

    const commentsMatch =
      text.match(
        /Please share what was positive about your experience and any areas for improvement\s*(.*?)(?=\s*Overall, how satisfied|Please rate|$)/i
      ) ||
      text.match(/あなたのエクスペリエンスにおいて良かった点や改善すべき点についてお聞かせください\s*(.+?)(?=\s*Overall|$)/) ||
      text.match(
        /Merci de nous indiquer les aspects positifs de votre expérience et les éventuels points à améliorer\s*(.+?)(?=\s*Dans l'ensemble|$)/i
      ) ||
      text.match(
        /(?:Ind[ií]quenos|Por favor,? (?:ind[ií]quenos|comparta)).{0,80}(?:experiencia|mejora).{0,40}\s*(.+?)(?=\s*En general|$)/i
      );
    if (commentsMatch) mapped.comments = commentsMatch[1].trim();

    if (!mapped.overall_satisfaction) {
      const jaOverall = text.match(
        /リクエストにどの程度満足していますか？\s*(非常に満足|とても満足|大変満足|やや満足|満足|どちらでもない|やや不満|非常に不満|不満)/
      );
      if (jaOverall) mapped.overall_satisfaction = jaOverall[1];
    }
    if (!mapped.consultant_satisfaction) {
      const jaConsultant = text.match(
        /コンサルタントにどの程度満足していますか？\s*(非常に満足|とても満足|大変満足|やや満足|満足|どちらでもない|やや不満|非常に不満|不満)/
      );
      if (jaConsultant) mapped.consultant_satisfaction = jaConsultant[1];
    }

    return mapped;
  }

  /**
   * Likert points for Request CSAT:
   * Very satisfied=5, Satisfied=4, Neither=3, Dissatisfied=2, Very dissatisfied=1.
   */
  function csatPoints(raw) {
    if (raw == null) return null;
    const text = String(raw).replace(/\s+/g, ' ').trim();
    if (!text) return null;

    const lower = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

    if (/^[1-5]$/.test(text)) return Number(text);

    const filledStars = (text.match(/[★✦⭐]/g) || []).length;
    const starNumber =
      lower.match(/\b([1-5])\s*(?:\/\s*5)?\s*-?\s*stars?\b/) ||
      lower.match(/\brat(?:ing|ed)?\s*[:=]?\s*([1-5])\b/);
    const stars = filledStars || (starNumber ? Number(starNumber[1]) : 0);
    if (stars >= 1 && stars <= 5) return stars;

    if (
      /very\s+satisfied|extremely\s+satisfied|highly\s+satisfied|completely\s+satisfied/.test(lower) ||
      /tres\s+satisfait|muy\s+satisfech/.test(lower) ||
      /非常に満足|とても満足|大変満足/.test(text)
    ) {
      return 5;
    }
    if (
      /very\s+dissatisfied|extremely\s+dissatisfied/.test(lower) ||
      /tres\s+insatisfait|muy\s+insatisfech/.test(lower) ||
      /非常に不満|とても不満/.test(text)
    ) {
      return 1;
    }
    if (
      /neither/.test(lower) ||
      /ni\s+satisfait\s+ni|ni\s+satisfech[oa]\s+ni/.test(lower) ||
      /どちらでもない/.test(text)
    ) {
      return 3;
    }
    if (
      /somewhat\s+dissatisfied|dissatisfied|dis-satisfied/.test(lower) ||
      /peu\s+satisfait|pas\s+satisfait|insatisfait|poco\s+satisfech|algo\s+insatisfech|insatisfech/.test(
        lower
      ) ||
      /やや不満|不満/.test(text)
    ) {
      return 2;
    }
    if (
      /somewhat\s+satisfied|satisfied/.test(lower) ||
      /satisfait|satisfech/.test(lower) ||
      /やや満足|満足/.test(text)
    ) {
      return 4;
    }

    return null;
  }

  function formatAverageDisplay(average) {
    return (Math.round(average * 10) / 10).toFixed(1);
  }

  function parseSurveyDate(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (mdy) {
      const ms = Date.UTC(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
      return Number.isFinite(ms) ? ms : null;
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * Scored surveys for a trend chart, oldest → newest.
   * The results table is newest-first; same-day rows keep that order reversed.
   */
  function csatTrendPoints(surveys) {
    const rows = [];
    (surveys || []).forEach((survey, listIndex) => {
      if (!survey || survey.ok === false) return;
      const score = csatPoints(survey.overall_satisfaction);
      if (score == null) return;
      rows.push({
        score,
        date: String(survey.submitted_at || ''),
        label: String(survey.req_number || survey.appointment_name || ''),
        listIndex,
        time: parseSurveyDate(survey.submitted_at),
      });
    });

    rows.sort((a, b) => {
      if (a.time != null && b.time != null && a.time !== b.time) return a.time - b.time;
      if (a.time != null && b.time == null) return -1;
      if (a.time == null && b.time != null) return 1;
      return b.listIndex - a.listIndex;
    });

    return rows.map(({ score, date, label }) => ({ score, date, label }));
  }

  function contactName(survey) {
    const name = String(survey?.submitted_by || '')
      .replace(/\s+/g, ' ')
      .trim();
    return name || 'Unknown';
  }

  /**
   * One chronological series per contact for the account-page trend chart.
   * Points share one oldest → newest index so each contact's line sits on the same dates.
   */
  function csatTrendByContact(surveys) {
    const rows = [];
    (surveys || []).forEach((survey, listIndex) => {
      if (!survey || survey.ok === false) return;
      const score = csatPoints(survey.overall_satisfaction);
      if (score == null) return;
      rows.push({
        score,
        date: String(survey.submitted_at || ''),
        label: String(survey.req_number || survey.appointment_name || ''),
        contact: contactName(survey),
        listIndex,
        time: parseSurveyDate(survey.submitted_at),
      });
    });

    rows.sort((a, b) => {
      if (a.time != null && b.time != null && a.time !== b.time) return a.time - b.time;
      if (a.time != null && b.time == null) return -1;
      if (a.time == null && b.time != null) return 1;
      return b.listIndex - a.listIndex;
    });

    const points = rows.map(({ score, date, label, contact }) => ({ score, date, label, contact }));
    const grouped = new Map();
    points.forEach((point, index) => {
      const entry = { ...point, index };
      if (!grouped.has(point.contact)) grouped.set(point.contact, []);
      grouped.get(point.contact).push(entry);
    });

    const series = [...grouped.entries()].map(([contact, seriesPoints]) => ({
      contact,
      points: seriesPoints,
    }));
    series.sort((a, b) => b.points[b.points.length - 1].index - a.points[a.points.length - 1].index);
    return { points, series };
  }

  function averageCsatPoints(surveys) {
    const scores = [];
    for (const survey of surveys || []) {
      if (!survey || survey.ok === false) continue;
      const points = csatPoints(survey.overall_satisfaction);
      if (points == null) continue;
      scores.push(points);
    }

    if (!scores.length) {
      return {
        average: null,
        count: 0,
        display: '',
        notice: 'Average points unavailable — no scored surveys in this list.',
      };
    }

    const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const display = formatAverageDisplay(average);
    return {
      average: Number(display),
      count: scores.length,
      display,
      notice: `Average points: ${display}/5`,
    };
  }

  const api = {
    mapQuestionsToFields,
    extractCsatFromBodyText,
    csatPoints,
    averageCsatPoints,
    csatTrendPoints,
    csatTrendByContact,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.WohCsatParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
