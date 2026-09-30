/**
 * Decode HTML entities in Salesforce UI API displayValue strings.
 * UI API HTML-encodes displayValue; inserting that as a text node shows &#39; literally.
 */
(function initWohHtmlText(root) {
  function decodeHtmlEntities(text) {
    if (text == null) return '';
    const str = String(text);
    if (!str.includes('&')) return str;
    return str
      .replace(/&nbsp;/gi, '\u00A0')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        const code = parseInt(hex, 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      })
      .replace(/&#(\d+);/g, (_, dec) => {
        const code = Number(dec);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      })
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  const api = { decodeHtmlEntities };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.WohHtmlText = api;
})(typeof window !== 'undefined' ? window : globalThis);
