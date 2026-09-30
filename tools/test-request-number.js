/**
 * node --test tools/test-request-number.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractAppointmentNumber,
  appointmentNameFromRelatedRecord,
  requestNumberLabel,
} = require('../extension/content/request-number.js');

describe('extractAppointmentNumber', () => {
  it('extracts OPR appointment numbers from feedback text', () => {
    assert.equal(
      extractAppointmentNumber('Submitted 7/13/2026 By: Someone Request: OPR-360365'),
      'OPR-360365'
    );
  });

  it('extracts REQ appointment numbers', () => {
    assert.equal(extractAppointmentNumber('Request: REQ-475159 Feedback Form'), 'REQ-475159');
  });

  it('does not treat WOH SR survey result names as appointment numbers', () => {
    assert.equal(extractAppointmentNumber('WOH SR-29923'), '');
  });
});

describe('appointmentNameFromRelatedRecord', () => {
  it('reads Appointment__c displayValue as the related appointment number', () => {
    const record = {
      fields: {
        Name: { value: 'WOH SR-29923', displayValue: 'WOH SR-29923' },
        Appointment__c: {
          displayValue: 'OPR-360365',
          value: 'a3NVT00000AbCdEFGH',
        },
      },
    };
    assert.equal(appointmentNameFromRelatedRecord(record), 'OPR-360365');
  });

  it('reads the Request field when Appointment Name is an APP number', () => {
    const record = {
      fields: {
        Name: { value: 'WOH SR-30500', displayValue: 'WOH SR-30500' },
        Appointment__c: { displayValue: 'APP-00557483', value: 'a3NVT000005lthJ2AQ' },
        Appointment__r: {
          displayValue: 'APP-00557483',
          value: {
            fields: {
              Name: { value: 'APP-00557483', displayValue: 'APP-00557483' },
              Request__c: { value: 'REQ-474692', displayValue: 'REQ-474692' },
            },
          },
        },
      },
    };
    assert.equal(appointmentNameFromRelatedRecord(record), 'REQ-474692');
  });

  it('ignores Salesforce Ids when displayValue is missing', () => {
    const record = {
      fields: {
        Appointment__c: { displayValue: null, value: 'a3NVT00000AbCdEFGH' },
      },
    };
    assert.equal(appointmentNameFromRelatedRecord(record), '');
  });
});

describe('requestNumberLabel', () => {
  it('shows the related appointment number instead of WOH SR-29923', () => {
    assert.equal(
      requestNumberLabel({
        req_number: '',
        appointment_name: 'OPR-360365',
        survey_result_name: 'WOH SR-29923',
      }),
      'OPR-360365'
    );
  });

  it('keeps REQ numbers when that is the appointment name', () => {
    assert.equal(
      requestNumberLabel({
        req_number: 'REQ-475159',
        survey_result_name: 'WOH SR-30500',
      }),
      'REQ-475159'
    );
  });

  it('shows the REQ number instead of the APP appointment name', () => {
    assert.equal(
      requestNumberLabel({
        req_number: 'REQ-474692',
        appointment_name: 'APP-00557483',
        survey_result_name: 'WOH SR-30500',
      }),
      'REQ-474692'
    );
  });

  it('does not show an APP appointment name as the request number', () => {
    assert.equal(
      requestNumberLabel({
        req_number: 'APP-00567809',
        appointment_name: 'APP-00567809',
      }),
      '—'
    );
  });

  it('does not fall back to WOH SR survey result names', () => {
    assert.equal(
      requestNumberLabel({
        req_number: '',
        survey_result_name: 'WOH SR-29923',
      }),
      '—'
    );
  });
});
