/**
 * WOH Survey → Google Sheets webhook
 *
 * Setup:
 * 1. Create a new Google Sheet (File → Make a copy of template or blank sheet)
 * 2. Extensions → Apps Script → paste this file
 * 3. Set SECRET below to a random string (same value goes in the Chrome extension)
 * 4. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone (or "Anyone with Google account" for tighter access)
 * 5. Copy the Web App URL into the Chrome extension options
 */

const SECRET = 'change-me-to-a-long-random-string';

const SHEET_NAME = 'Survey Results';

const HEADERS = [
  'survey_result_id',
  'req_number',
  'appointment_id',
  'appointment_url',
  'contact_id',
  'contact_name',
  'account_id',
  'account_name',
  'consultant_name',
  'product',
  'sub_product',
  'submitted_at',
  'submitted_by',
  'overall_satisfaction',
  'consultant_satisfaction',
  'comments',
  'synced_at',
  'synced_by',
];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.secret !== SECRET) {
      return jsonResponse({ ok: false, error: 'Invalid secret' }, 403);
    }

    const sheet = getOrCreateSheet();
    ensureHeaders(sheet);

    const row = body.record;
    if (!row) {
      return jsonResponse({ ok: false, error: 'Missing record' }, 400);
    }

    const dedupeKey = row.survey_result_id || `${row.req_number}|${row.submitted_at}`;
    if (isDuplicate(sheet, dedupeKey, row)) {
      return jsonResponse({ ok: true, status: 'duplicate', dedupeKey });
    }

    appendRow(sheet, row);
    return jsonResponse({ ok: true, status: 'inserted', dedupeKey });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
}

function doGet() {
  return jsonResponse({ ok: true, message: 'WOH Survey webhook is running' });
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  return sheet;
}

function ensureHeaders(sheet) {
  const existing = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (existing[0] !== HEADERS[0]) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
}

function isDuplicate(sheet, dedupeKey, row) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const data = sheet.getRange(2, 1, lastRow, HEADERS.length).getValues();
  const idCol = HEADERS.indexOf('survey_result_id');
  const reqCol = HEADERS.indexOf('req_number');
  const dateCol = HEADERS.indexOf('submitted_at');

  for (const existing of data) {
    const existingId = existing[idCol];
    if (existingId && existingId === row.survey_result_id) return true;

    const existingKey = `${existing[reqCol]}|${existing[dateCol]}`;
    if (!row.survey_result_id && existingKey === dedupeKey) return true;
  }
  return false;
}

function appendRow(sheet, row) {
  const values = HEADERS.map((h) => (row[h] != null ? String(row[h]) : ''));
  sheet.appendRow(values);
}

function jsonResponse(obj, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  // Apps Script web apps don't support HTTP status codes directly;
  // clients should check the `ok` field in the JSON body.
  return output;
}
