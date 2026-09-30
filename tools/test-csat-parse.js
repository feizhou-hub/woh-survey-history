/**
 * node --test tools/test-csat-parse.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  mapQuestionsToFields,
  extractCsatFromBodyText,
} = require('../extension/content/csat-parse.js');

const OPR_BODY = [
  'Feedback Details Submitted Date: 04/01/2026 Submitted By: Courtney Deel',
  'Request: OPR-319294 Consultants: Wendy Klopp Product: Core Payroll',
  'Sub Product: Functional Review Feedback Form',
  'Overall, how satisfied were you with this Optimization Package? Very satisfied',
  'Overall, how satisfied were you with the consultant(s) assigned to this engagement? Very satisfied',
  'The service delivery was well-aligned with the expectations set during our planning and introduction calls. Strongly agree',
  'As a result of the review/working sessions, our team has a better understanding of the covered topics. Strongly agree',
].join(' ');

const AAE_BODY =
  'Overall, how satisfied were you with this Ask-an-Expert request? Somewhat satisfied ' +
  'Overall, how satisfied were you with the consultant(s) assigned to this request? Very satisfied';

describe('extractCsatFromBodyText', () => {
  it('reads Very satisfied from Optimization Package (OPR) questions', () => {
    const parsed = extractCsatFromBodyText(OPR_BODY);
    assert.equal(parsed.overall_satisfaction, 'Very satisfied');
    assert.equal(parsed.consultant_satisfaction, 'Very satisfied');
  });

  it('still reads Ask-an-Expert request CSAT', () => {
    const parsed = extractCsatFromBodyText(AAE_BODY);
    assert.equal(parsed.overall_satisfaction, 'Somewhat satisfied');
    assert.equal(parsed.consultant_satisfaction, 'Very satisfied');
  });
});

describe('mapQuestionsToFields', () => {
  it('maps Optimization Package overall CSAT and does not treat consultant overall as request CSAT', () => {
    const mapped = mapQuestionsToFields([
      {
        question: 'Overall, how satisfied were you with this Optimization Package?',
        answer: 'Very satisfied',
      },
      {
        question: 'Overall, how satisfied were you with the consultant(s) assigned to this engagement?',
        answer: 'Somewhat satisfied',
      },
    ]);
    assert.equal(mapped.overall_satisfaction, 'Very satisfied');
    assert.equal(mapped.consultant_satisfaction, 'Somewhat satisfied');
  });
});
