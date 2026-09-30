/**
 * node --test tools/test-page-context.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isAppointmentUrl, isAccountUrl, isSurveyHostUrl, detectPageContext } = require('../extension/content/page-context.js');

const APPOINTMENT =
  'https://workday.lightning.force.com/lightning/r/Appointment__c/a3NVT000005xiIH2AY/view';
const ACCOUNT =
  'https://workday.lightning.force.com/lightning/r/Account/0018000001eZR3dAAG/view';

describe('detectPageContext', () => {
  it('classifies appointment and short appointment URLs', () => {
    assert.equal(detectPageContext(APPOINTMENT), 'appointment');
    assert.equal(
      detectPageContext('https://workday.lightning.force.com/lightning/r/a3NVT000005xiIH2AY/view'),
      'appointment'
    );
    assert.equal(isAppointmentUrl(APPOINTMENT), true);
  });

  it('classifies account and short account URLs', () => {
    assert.equal(detectPageContext(ACCOUNT), 'account');
    assert.equal(
      detectPageContext('https://workday.lightning.force.com/lightning/r/0018000001eZR3dAAG/view'),
      'account'
    );
    assert.equal(isAccountUrl(ACCOUNT), true);
  });

  it('keeps an account workspace URL as an account page', () => {
    const url = `${ACCOUNT}?ws=%2Flightning%2Fr%2FAppointment__c%2Fa3NVT000005xiIH2AY%2Fview`;
    assert.equal(detectPageContext(url), 'account');
    assert.equal(isAppointmentUrl(url), false);
  });

  it('prefers appointment when both record paths are present', () => {
    const url = `${APPOINTMENT}?related=/lightning/r/Account/0018000001eZR3dAAG/view`;
    assert.equal(detectPageContext(url), 'appointment');
  });

  it('ignores other Lightning pages', () => {
    const url = 'https://workday.lightning.force.com/lightning/o/Account/home';
    assert.equal(detectPageContext(url), null);
    assert.equal(isSurveyHostUrl(url), false);
    assert.equal(isSurveyHostUrl(APPOINTMENT), true);
    assert.equal(isSurveyHostUrl(ACCOUNT), true);
  });
});
