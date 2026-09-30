/**
 * node --test tools/test-survey-query.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  surveyLookupFieldFromDescribe,
  appointmentRequestSelect,
  isAccountSurveySoql,
  recentSurveySoql,
  soqlSurveyToUiRecord,
} = require('../extension/content/sf-api.js');
const { appointmentNameFromRelatedRecord } = require('../extension/content/request-number.js');

describe('surveyLookupFieldFromDescribe', () => {
  it('uses the Account child relationship behind WOH_Survey_Results__r', () => {
    const field = surveyLookupFieldFromDescribe({
      childRelationships: [
        { childSObject: 'Contact', relationshipName: 'Contacts', field: 'AccountId' },
        {
          childSObject: 'WOH_Survey_Result__c',
          relationshipName: 'Other_Surveys',
          field: 'Other_Account__c',
        },
        {
          childSObject: 'WOH_Survey_Result__c',
          relationshipName: 'WOH_Survey_Results',
          field: 'Account__c',
        },
      ],
    });
    assert.equal(field, 'Account__c');
  });

  it('reads the same relationship from UI API object info', () => {
    const field = surveyLookupFieldFromDescribe({
      childRelationships: [
        {
          childObjectApiName: 'WOH_Survey_Result__c',
          relationshipName: 'WOH_Survey_Results',
          fieldName: 'Account__c',
        },
      ],
    });
    assert.equal(field, 'Account__c');
  });

  it('returns null when that relationship is missing', () => {
    assert.equal(surveyLookupFieldFromDescribe({ childRelationships: [] }), null);
  });
});

describe('appointmentRequestSelect', () => {
  it('selects the Appointment field labeled Request, not the APP record name', () => {
    assert.equal(
      appointmentRequestSelect({
        fields: {
          Name: { apiName: 'Name', label: 'Appointment Number', dataType: 'String' },
          Request__c: { apiName: 'Request__c', label: 'Request', dataType: 'String' },
          Account__c: { apiName: 'Account__c', label: 'Account', dataType: 'Reference', relationshipName: 'Account__r' },
        },
      }),
      'Appointment__r.Request__c'
    );
  });

  it('selects the related name when Request is a lookup', () => {
    assert.equal(
      appointmentRequestSelect({
        fields: {
          Request__c: {
            apiName: 'Request__c',
            label: 'Request',
            dataType: 'Reference',
            relationshipName: 'Request__r',
          },
        },
      }),
      'Appointment__r.Request__r.Name'
    );
  });
});

describe('recentSurveySoql', () => {
  it('lists newest survey results for an account without a related list', () => {
    assert.equal(
      recentSurveySoql('00180000014Y2uBAAS', 'Account__c', 20),
      'SELECT Id, Name, Appointment__c, Appointment__r.Name, Date_Time_Survey_Submitted__c ' +
        'FROM WOH_Survey_Result__c ' +
        "WHERE Account__c = '00180000014Y2uBAAS' " +
        'ORDER BY Date_Time_Survey_Submitted__c DESC NULLS LAST ' +
        'LIMIT 20'
    );
  });

  it('includes the request-number field beside the appointment name', () => {
    assert.equal(
      recentSurveySoql('00180000014Y2uBAAS', 'Account__c', 20, 'Appointment__r.Request__c'),
      'SELECT Id, Name, Appointment__c, Appointment__r.Name, Appointment__r.Request__c, Date_Time_Survey_Submitted__c ' +
        'FROM WOH_Survey_Result__c ' +
        "WHERE Account__c = '00180000014Y2uBAAS' " +
        'ORDER BY Date_Time_Survey_Submitted__c DESC NULLS LAST ' +
        'LIMIT 20'
    );
    assert.equal(
      isAccountSurveySoql(recentSurveySoql('00180000014Y2uBAAS', 'Account__c', 20, 'Appointment__r.Request__c')),
      true
    );
  });

  it('rejects ids and field names that are not safe to interpolate', () => {
    assert.throws(() => recentSurveySoql("001' OR Name != null", 'Account__c', 10));
    assert.throws(() => recentSurveySoql('00180000014Y2uBAAS', 'Account__c; DELETE', 10));
    assert.throws(() => recentSurveySoql('00180000014Y2uBAAS', 'Account__c', 10, 'Appointment__r.Name; DELETE'));
  });

  it('is the only query the background page will run', () => {
    assert.equal(isAccountSurveySoql(recentSurveySoql('00180000014Y2uBAAS', 'Account__c', 20)), true);
    assert.equal(isAccountSurveySoql('SELECT Id FROM Account'), false);
  });
});

describe('soqlSurveyToUiRecord', () => {
  it('keeps the appointment number the request column already reads', () => {
    const record = soqlSurveyToUiRecord({
      Id: 'a08VT00000zdlK6YAI',
      Name: 'WOH SR-30500',
      Appointment__c: 'a3NVT000004LeZd2AK',
      Appointment__r: { Name: 'REQ-477733' },
      Date_Time_Survey_Submitted__c: '2026-07-31T04:00:00.000+0000',
    });
    assert.equal(record.id, 'a08VT00000zdlK6YAI');
    assert.equal(record.fields.Name.value, 'WOH SR-30500');
    assert.equal(record.fields.Appointment__c.value, 'a3NVT000004LeZd2AK');
    assert.equal(appointmentNameFromRelatedRecord(record), 'REQ-477733');
    assert.equal(record.fields.Date_Time_Survey_Submitted__c.value, '2026-07-31T04:00:00.000+0000');
  });

  it('keeps the REQ number when Appointment Name is APP-', () => {
    const record = soqlSurveyToUiRecord({
      Id: 'a08VT00000zdlK6YAI',
      Name: 'WOH SR-30500',
      Appointment__c: 'a3NVT000005lthJ2AQ',
      Appointment__r: { Name: 'APP-00557483', Request__c: 'REQ-474692' },
    });
    assert.equal(record.fields.Appointment__c.displayValue, 'APP-00557483');
    assert.equal(appointmentNameFromRelatedRecord(record), 'REQ-474692');
  });
});
