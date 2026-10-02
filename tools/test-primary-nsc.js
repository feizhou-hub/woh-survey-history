/**
 * node --test tools/test-primary-nsc.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractPrimaryNscFromUiRecord,
  primaryNscSurveyFilter,
  surveysSubmittedBy,
  cleanPersonName,
} = require('../extension/content/primary-nsc.js');

describe('cleanPersonName', () => {
  it('strips Preview/Open chrome and keeps the person name', () => {
    assert.equal(cleanPersonName('Open Praveen Gupta Preview'), 'Praveen Gupta');
  });
});

describe('extractPrimaryNscFromUiRecord', () => {
  it('reads string Primary_NSC_Contact__c value when displayValue is null', () => {
    // Real SF shape: Primary_NSC_Contact__c is a String field, not a Contact lookup.
    const hit = extractPrimaryNscFromUiRecord({
      fields: {
        Primary_NSC_Contact__c: {
          displayValue: null,
          value: 'Praveen Gupta',
        },
      },
    });
    assert.ok(hit);
    assert.equal(hit.name, 'Praveen Gupta');
    assert.equal(hit.apiName, 'Primary_NSC_Contact__c');
  });

  it('reads User__r when that is the Primary NSC Contact lookup', () => {
    const hit = extractPrimaryNscFromUiRecord({
      fields: {
        User__r: {
          displayValue: 'Praveen Gupta',
          value: {
            id: '0054X00000Ea18YQAR',
            apiName: 'User',
            fields: { Name: { value: 'Praveen Gupta' } },
          },
        },
      },
    });
    assert.ok(hit);
    assert.equal(hit.name, 'Praveen Gupta');
    assert.equal(hit.apiName, 'User__r');
    assert.match(hit.href, /\/User\//);
  });

  it('reads displayValue from Primary_NSC_Contact__c', () => {
    const hit = extractPrimaryNscFromUiRecord({
      fields: {
        Primary_NSC_Contact__c: {
          displayValue: 'Praveen Gupta',
          value: '0038000000AbCdEFGH',
        },
      },
    });
    assert.ok(hit);
    assert.equal(hit.name, 'Praveen Gupta');
    assert.equal(hit.id, '0038000000AbCdEFGH');
    assert.equal(hit.source, 'ui_api');
  });

  it('keeps the User id when the name is stored on the string field', () => {
    const hit = extractPrimaryNscFromUiRecord({
      fields: {
        Primary_NSC_Contact__c: { displayValue: null, value: 'Tri Sudjono' },
        User__c: { displayValue: null, value: '0054X00000Ea18YQAR' },
      },
    });
    assert.equal(hit.name, 'Tri Sudjono');
    assert.equal(hit.id, '0054X00000Ea18YQAR');
    assert.match(hit.href, /\/User\//);
  });

  it('reads nested relationship Primary_NSC_Contact__r.Name', () => {
    const hit = extractPrimaryNscFromUiRecord({
      fields: {
        Primary_NSC_Contact__r: {
          displayValue: null,
          value: {
            id: '0038000000AbCdEFGH',
            apiName: 'Contact',
            fields: { Name: { value: 'Praveen Gupta' } },
          },
        },
      },
    });
    assert.ok(hit);
    assert.equal(hit.name, 'Praveen Gupta');
  });

  it('ignores email fields when scanning NSC contact keys', () => {
    const hit = extractPrimaryNscFromUiRecord({
      fields: {
        Primary_NSC_Email__c: { displayValue: 'praveen.gupta@michelin.com', value: 'praveen.gupta@michelin.com' },
        Custom_NSC_Contact__c: { displayValue: 'Praveen Gupta', value: '0038000000AbCdEFGH' },
      },
    });
    assert.ok(hit);
    assert.equal(hit.name, 'Praveen Gupta');
    assert.equal(hit.apiName, 'Custom_NSC_Contact__c');
  });

  it('returns null when Primary NSC Contact is missing', () => {
    assert.equal(extractPrimaryNscFromUiRecord({ fields: { Account__c: { value: '001xx' } } }), null);
  });
});

describe('primaryNscSurveyFilter', () => {
  it('filters the string Primary NSC Contact field by name', () => {
    assert.deepEqual(
      primaryNscSurveyFilter({ name: 'Tri Sudjono', apiName: 'Primary_NSC_Contact__c' }),
      { field: 'Appointment__r.Primary_NSC_Contact__c', value: 'Tri Sudjono' }
    );
  });

  it('filters the User lookup when that field is the Primary NSC Contact', () => {
    assert.deepEqual(
      primaryNscSurveyFilter({
        name: 'Tri Sudjono',
        id: '0054X00000Ea18YQAR',
        apiName: 'User__r',
      }),
      { field: 'Appointment__r.User__c', value: '0054X00000Ea18YQAR' }
    );
  });

  it('filters a scraped User id when the page has no API name', () => {
    assert.deepEqual(primaryNscSurveyFilter({ name: 'Tri Sudjono', id: '0054X00000Ea18YQAR' }), {
      field: 'Appointment__r.User__c',
      value: '0054X00000Ea18YQAR',
    });
  });

  it('returns null when there is no contact to filter on', () => {
    assert.equal(primaryNscSurveyFilter(null), null);
    assert.equal(primaryNscSurveyFilter({ name: '' }), null);
  });
});

describe('surveysSubmittedBy', () => {
  const namesMatch = (left, right) =>
    String(left || '').replace(/\s+/g, ' ').trim().toLowerCase() ===
    String(right || '').replace(/\s+/g, ' ').trim().toLowerCase();

  it('keeps only surveys submitted by the Primary NSC Contact', () => {
    const kept = surveysSubmittedBy(
      [
        { submitted_by: 'Megan Spencer', overall_satisfaction: 'Satisfied' },
        { submitted_by: 'Kathryn LaViolette', overall_satisfaction: 'Very satisfied' },
        { submitted_by: 'Kathryn LaViolette', overall_satisfaction: 'Very satisfied' },
      ],
      'Kathryn LaViolette',
      namesMatch
    );
    assert.deepEqual(
      kept.map((survey) => survey.submitted_by),
      ['Kathryn LaViolette', 'Kathryn LaViolette']
    );
  });

  it('returns nothing when the Primary NSC Contact is missing', () => {
    assert.deepEqual(surveysSubmittedBy([{ submitted_by: 'Megan Spencer' }], '', namesMatch), []);
  });
});
