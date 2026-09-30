/**
 * node --test tools/test-primary-nsc.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractPrimaryNscFromUiRecord,
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
