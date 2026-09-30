/**
 * node --test tools/test-html-text.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { decodeHtmlEntities } = require('../extension/content/html-text.js');

describe('decodeHtmlEntities', () => {
  it('decodes Salesforce UI API apostrophes in account names', () => {
    assert.equal(
      decodeHtmlEntities("Hungry Jack&#39;s Australia Pty Ltd"),
      "Hungry Jack's Australia Pty Ltd"
    );
  });

  it('decodes ampersands and leaves already-plain text unchanged', () => {
    assert.equal(decodeHtmlEntities('AT&amp;T'), 'AT&T');
    assert.equal(decodeHtmlEntities("Hungry Jack&#x27;s"), "Hungry Jack's");
    assert.equal(decodeHtmlEntities("Hungry Jack's Australia Pty Ltd"), "Hungry Jack's Australia Pty Ltd");
    assert.equal(decodeHtmlEntities(''), '');
  });
});
