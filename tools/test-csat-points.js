/**
 * node --test tools/test-csat-points.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { csatPoints, averageCsatPoints, csatTrendPoints, csatTrendByContact } = require('../extension/content/csat-parse.js');

describe('csatPoints', () => {
  it('maps the 5-point English Likert scale', () => {
    assert.equal(csatPoints('Very satisfied'), 5);
    assert.equal(csatPoints('Satisfied'), 4);
    assert.equal(csatPoints('Neither satisfied nor dissatisfied'), 3);
    assert.equal(csatPoints('Dissatisfied'), 2);
    assert.equal(csatPoints('Very dissatisfied'), 1);
  });

  it('maps somewhat / localized / star answers onto the same 1–5 scale', () => {
    assert.equal(csatPoints('Somewhat satisfied'), 4);
    assert.equal(csatPoints('Somewhat dissatisfied'), 2);
    assert.equal(csatPoints('非常に満足'), 5);
    assert.equal(csatPoints('満足'), 4);
    assert.equal(csatPoints('どちらでもない'), 3);
    assert.equal(csatPoints('5 stars'), 5);
    assert.equal(csatPoints('★★★★'), 4);
  });

  it('returns null for missing or unknown answers', () => {
    assert.equal(csatPoints(''), null);
    assert.equal(csatPoints(null), null);
    assert.equal(csatPoints('Other'), null);
  });
});

describe('averageCsatPoints', () => {
  it('averages Request CSAT from listed survey results and skips unscoreable rows', () => {
    const summary = averageCsatPoints([
      { ok: true, overall_satisfaction: 'Very satisfied' },
      { ok: true, overall_satisfaction: 'Very satisfied' },
      { ok: true, overall_satisfaction: 'Very satisfied' },
      { ok: true, overall_satisfaction: 'Dissatisfied' },
      { ok: true, overall_satisfaction: 'Very satisfied' },
      { ok: true, overall_satisfaction: 'Very satisfied' },
      { ok: true, overall_satisfaction: 'Very satisfied' },
      { ok: true, overall_satisfaction: 'Very satisfied' },
      { ok: true, overall_satisfaction: 'Satisfied' },
      { ok: true, overall_satisfaction: 'Neither satisfied nor dissatisfied' },
    ]);
    assert.equal(summary.count, 10);
    assert.equal(summary.average, 4.4);
    assert.equal(summary.display, '4.4');
    assert.match(summary.notice, /Average points:\s*4\.4\/5/);
  });

  it('ignores failed rows and blank CSAT when averaging', () => {
    const summary = averageCsatPoints([
      { ok: true, overall_satisfaction: 'Satisfied' },
      { ok: false, overall_satisfaction: 'Very satisfied' },
      { ok: true, overall_satisfaction: '' },
    ]);
    assert.equal(summary.count, 1);
    assert.equal(summary.average, 4);
    assert.equal(summary.display, '4.0');
  });

  it('reports unavailable when nothing in the list can be scored', () => {
    const summary = averageCsatPoints([{ ok: false, error: 'Failed' }]);
    assert.equal(summary.count, 0);
    assert.equal(summary.average, null);
    assert.match(summary.notice, /unavailable/i);
  });
});

describe('csatTrendPoints', () => {
  it('orders listed surveys oldest to newest and keeps scores', () => {
    const trend = csatTrendPoints([
      { ok: true, req_number: 'REQ-493085', submitted_at: '09/22/2026', overall_satisfaction: 'Very satisfied' },
      { ok: true, req_number: 'REQ-493085', submitted_at: '09/22/2026', overall_satisfaction: 'Very satisfied' },
      { ok: true, req_number: 'REQ-442912', submitted_at: '09/14/2026', overall_satisfaction: 'Very satisfied' },
      { ok: true, req_number: 'REQ-480273', submitted_at: '09/14/2026', overall_satisfaction: 'Dissatisfied' },
      { ok: true, req_number: 'REQ-482623', submitted_at: '08/31/2026', overall_satisfaction: 'Very satisfied' },
      { ok: true, req_number: 'REQ-484668', submitted_at: '08/31/2026', overall_satisfaction: 'Very satisfied' },
      { ok: true, req_number: 'REQ-484668', submitted_at: '08/31/2026', overall_satisfaction: 'Very satisfied' },
      { ok: true, req_number: 'OPR-375594', submitted_at: '08/25/2026', overall_satisfaction: 'Very satisfied' },
      { ok: true, req_number: 'REQ-481565', submitted_at: '08/19/2026', overall_satisfaction: 'Satisfied' },
      { ok: true, req_number: 'OPR-383477', submitted_at: '08/18/2026', overall_satisfaction: 'Neither satisfied nor dissatisfied' },
    ]);
    assert.deepEqual(
      trend.map((point) => point.score),
      [3, 4, 5, 5, 5, 5, 2, 5, 5, 5]
    );
    assert.equal(trend[0].date, '08/18/2026');
    assert.equal(trend[0].label, 'OPR-383477');
    assert.equal(trend.at(-1).date, '09/22/2026');
  });

  it('skips failed and unscored rows', () => {
    const trend = csatTrendPoints([
      { ok: false, submitted_at: '09/22/2026', overall_satisfaction: 'Very satisfied' },
      { ok: true, submitted_at: '09/01/2026', overall_satisfaction: '' },
      { ok: true, req_number: 'REQ-1', submitted_at: '08/01/2026', overall_satisfaction: 'Dissatisfied' },
    ]);
    assert.deepEqual(trend, [{ score: 2, date: '08/01/2026', label: 'REQ-1' }]);
  });
});

describe('csatTrendByContact', () => {
  it('builds one oldest-to-newest line per contact on a shared timeline', () => {
    const { points, series } = csatTrendByContact([
      { ok: true, submitted_by: 'Mitch Yeh', req_number: 'REQ-2', submitted_at: '09/22/2026', overall_satisfaction: 'Very satisfied' },
      { ok: true, submitted_by: 'Sonya Huang', req_number: 'REQ-1', submitted_at: '09/14/2026', overall_satisfaction: 'Dissatisfied' },
      { ok: true, submitted_by: 'Mitch Yeh', req_number: 'REQ-0', submitted_at: '08/18/2026', overall_satisfaction: 'Satisfied' },
      { ok: false, submitted_by: 'Celine Hsieh', submitted_at: '09/01/2026', overall_satisfaction: 'Very satisfied' },
    ]);

    assert.deepEqual(
      points.map((point) => [point.contact, point.score]),
      [
        ['Mitch Yeh', 4],
        ['Sonya Huang', 2],
        ['Mitch Yeh', 5],
      ]
    );
    const mitch = series.find((entry) => entry.contact === 'Mitch Yeh');
    const sonya = series.find((entry) => entry.contact === 'Sonya Huang');
    assert.deepEqual(mitch.points.map((point) => point.score), [4, 5]);
    assert.deepEqual(mitch.points.map((point) => point.index), [0, 2]);
    assert.deepEqual(sonya.points.map((point) => point.index), [1]);
    assert.equal(series[0].contact, 'Mitch Yeh');
  });

  it('labels a blank customer as Unknown', () => {
    const { series } = csatTrendByContact([
      { ok: true, submitted_by: '  ', submitted_at: '08/01/2026', overall_satisfaction: 'Satisfied' },
    ]);
    assert.equal(series[0].contact, 'Unknown');
    assert.equal(series[0].points[0].score, 4);
  });
});
