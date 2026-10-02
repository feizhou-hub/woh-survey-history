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
  surveyCountSoql,
  appointmentCountSoql,
  countFromQueryResult,
  returnRatioSummary,
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

  it('limits an appointment query to the Primary NSC Contact name', () => {
    const soql = recentSurveySoql('00180000014Y2uBAAS', 'Account__c', 10, '', {
      field: 'Appointment__r.Primary_NSC_Contact__c',
      value: 'Tri Sudjono',
    });
    assert.equal(
      soql,
      'SELECT Id, Name, Appointment__c, Appointment__r.Name, Date_Time_Survey_Submitted__c ' +
        'FROM WOH_Survey_Result__c ' +
        "WHERE Account__c = '00180000014Y2uBAAS' AND Appointment__r.Primary_NSC_Contact__c = 'Tri Sudjono' " +
        'ORDER BY Date_Time_Survey_Submitted__c DESC NULLS LAST ' +
        'LIMIT 10'
    );
    assert.equal(isAccountSurveySoql(soql), true);
  });

  it('limits an appointment query to the Primary NSC User id and escapes names', () => {
    const byUser = recentSurveySoql('00180000014Y2uBAAS', 'Account__c', 10, 'Appointment__r.Request__c', {
      field: 'Appointment__r.User__c',
      value: '0054X00000Ea18YQAR',
    });
    assert.match(byUser, /AND Appointment__r\.User__c = '0054X00000Ea18YQAR'/);
    assert.equal(isAccountSurveySoql(byUser), true);

    const escaped = recentSurveySoql('00180000014Y2uBAAS', 'Account__c', 10, '', {
      field: 'Appointment__r.Primary_NSC_Contact__c',
      value: "O'Brien",
    });
    assert.match(escaped, /Primary_NSC_Contact__c = 'O\\'Brien'/);
    assert.equal(isAccountSurveySoql(escaped), true);
  });

  it('rejects a contact filter that is not the Primary NSC field', () => {
    assert.throws(() =>
      recentSurveySoql('00180000014Y2uBAAS', 'Account__c', 10, '', {
        field: 'Name',
        value: 'Tri',
      })
    );
    assert.throws(() =>
      recentSurveySoql('00180000014Y2uBAAS', 'Account__c', 10, '', {
        field: 'Appointment__r.User__c',
        value: "005' OR Name != null",
      })
    );
  });
});

describe('return ratio counts', () => {
  it('counts every survey result for an account', () => {
    const soql = surveyCountSoql('00180000014Y2uBAAS', 'Account__c');
    assert.equal(
      soql,
      "SELECT COUNT() FROM WOH_Survey_Result__c WHERE Account__c = '00180000014Y2uBAAS'"
    );
    assert.equal(isAccountSurveySoql(soql), true);
  });

  it('counts survey results for the Primary NSC Contact', () => {
    const byName = surveyCountSoql('00180000014Y2uBAAS', 'Account__c', {
      field: 'Appointment__r.Primary_NSC_Contact__c',
      value: 'Tri Sudjono',
    });
    assert.equal(
      byName,
      'SELECT COUNT() FROM WOH_Survey_Result__c ' +
        "WHERE Account__c = '00180000014Y2uBAAS' AND Appointment__r.Primary_NSC_Contact__c = 'Tri Sudjono'"
    );
    assert.equal(isAccountSurveySoql(byName), true);

    const byUser = surveyCountSoql('00180000014Y2uBAAS', 'Account__c', {
      field: 'Appointment__r.User__c',
      value: '0054X00000Ea18YQAR',
    });
    assert.match(byUser, /AND Appointment__r\.User__c = '0054X00000Ea18YQAR'$/);
    assert.equal(isAccountSurveySoql(byUser), true);
  });

  it('counts appointments on the account, using the contact field without Appointment__r', () => {
    assert.equal(
      appointmentCountSoql('00180000014Y2uBAAS'),
      "SELECT COUNT() FROM Appointment__c WHERE Account__c = '00180000014Y2uBAAS'"
    );
    const byName = appointmentCountSoql('00180000014Y2uBAAS', {
      field: 'Appointment__r.Primary_NSC_Contact__c',
      value: "O'Brien",
    });
    assert.equal(
      byName,
      'SELECT COUNT() FROM Appointment__c ' +
        "WHERE Account__c = '00180000014Y2uBAAS' AND Primary_NSC_Contact__c = 'O\\'Brien'"
    );
    assert.equal(isAccountSurveySoql(byName), true);
    assert.equal(
      isAccountSurveySoql(
        appointmentCountSoql('00180000014Y2uBAAS', {
          field: 'Appointment__r.User__c',
          value: '0054X00000Ea18YQAR',
        })
      ),
      true
    );
  });

  it('rejects count queries the background page must not run', () => {
    assert.equal(isAccountSurveySoql('SELECT COUNT() FROM Account'), false);
    assert.equal(isAccountSurveySoql("SELECT COUNT() FROM Appointment__c WHERE Name != 'x'"), false);
    assert.throws(() => surveyCountSoql("001' OR Name != null", 'Account__c'));
    assert.throws(() => appointmentCountSoql('00180000014Y2uBAAS', { field: 'Name', value: 'Tri' }));
  });

  it('reads the Salesforce count and formats CSAT divided by requests', () => {
    assert.equal(countFromQueryResult({ totalSize: 8, done: true, records: [] }), 8);
    assert.equal(countFromQueryResult({ records: [] }), null);

    assert.deepEqual(returnRatioSummary(8, 20), {
      csat_count: 8,
      request_count: 20,
      return_ratio: 0.4,
      return_ratio_display: '40.0%',
    });
    assert.equal(returnRatioSummary(0, 12).return_ratio_display, '0.0%');
    assert.equal(returnRatioSummary(1, 3).return_ratio_display, '33.3%');
    assert.equal(returnRatioSummary(78, 1000).return_ratio_display, '7.8%');
    assert.equal(returnRatioSummary(102, 1000).return_ratio_display, '10.2%');
    assert.equal(returnRatioSummary(66, 998).return_ratio_display, '6.6%');
    assert.equal(returnRatioSummary(0, 0).return_ratio_display, '—');
    assert.equal(returnRatioSummary(2, 0).return_ratio, null);
    assert.equal(returnRatioSummary(2, 0).return_ratio_display, '—');
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
