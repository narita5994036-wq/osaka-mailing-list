/**
 * Google Apps Script webhook for MYKITA OSAKA Frame Warranty Registration.
 * Deploy as Web App (Execute as: Me / Access: Anyone) and paste the
 * resulting /exec URL into SHEET_WEBHOOK_URL in index.html.
 *
 * Spreadsheet column order (A→J):
 * Timestamp | 会員番号 | Name | Email | Opt-in | Country | Language | Follow-up Sent | Purchased | Staff Notes
 * (会員番号 and Staff Notes are filled in manually in the sheet.)
 */
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);

  var headers = ['Timestamp', '会員番号', 'Name', 'Email', 'Opt-in', 'Country', 'Language', 'Follow-up Sent', 'Purchased', 'Staff Notes', 'Lens Order', 'Phone', 'Postcode', 'Address'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  var country = data.country || '';
  if (data.countryCode) {
    country += ' (' + data.countryCode + ')';
  }

  sheet.appendRow([
    data.timestamp || '',   // A: Timestamp
    data.memberNo || '',    // B: 会員番号
    data.name || '',        // C: Name
    data.email || '',       // D: Email
    data.optin ? 'Yes' : 'No', // E: Opt-in
    country,                // F: Country
    (data.lang || '').toUpperCase(), // G: Language
    '',                                    // H: Follow-up Sent (always blank)
    data.frameNames || '',                 // I: Purchased
    '',                                    // J: Staff Notes
    data.lensOrder ? 'Yes' : 'No',        // K: Lens Order
    data.phone || '',                      // L: Phone
    data.postcode || '',                   // M: Postcode
    data.address || ''                     // N: Address
  ]);

  return ContentService.createTextOutput(JSON.stringify({ result: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Admin API (read-only login, list, delete).
 * Set ADMIN_PASSWORD in Project Settings > Script Properties (NOT in code).
 *
 * GET params:
 *   action=admin & password=...                → list records
 *   action=admin & password=... & op=delete & row=N → delete row N
 *   action=admin & password=... & op=followup & row=N & sent=true|false → set follow-up status
 *   action=admin & password=... & op=staffnotes & row=N & notes=... → set staff notes
 */
function doGet(e) {
  var params = e.parameter || {};
  var out;

  if (params.action === 'admin') {
    out = handleAdminRequest(params);
  } else if (params.action === 'addframes') {
    out = handleAddFrames(params);
  } else if (params.action === 'settings') {
    out = handleGetSettings();
  } else {
    out = { ok: false, error: 'unknown action' };
  }

  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleAddFrames(params) {
  var targetEmail = (params.email || '').trim().toLowerCase();
  var targetTs    = (params.timestamp || '').slice(0, 19); // compare up to seconds
  var frameNames  = params.frameNames || '';

  if (!targetEmail || !targetTs || !frameNames) {
    return { ok: false, error: 'missing params' };
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return { ok: false, error: 'not found' }; }

  // Read cols A (Timestamp) and D (Email)
  var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  for (var i = values.length - 1; i >= 0; i--) { // search newest first
    var rowTs    = values[i][0] instanceof Date ? values[i][0].toISOString() : String(values[i][0] || '');
    var rowEmail = String(values[i][3] || '').trim().toLowerCase();
    if (rowEmail === targetEmail && rowTs.slice(0, 19) === targetTs) {
      sheet.getRange(i + 2, 9).setValue(frameNames); // col I = Purchased
      return { ok: true };
    }
  }
  return { ok: false, error: 'not found' };
}

function handleAdminRequest(params) {
  var stored = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!stored || params.password !== stored) {
    return { ok: false, error: 'invalid password' };
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var op = params.op || 'list';

  if (op === 'delete') {
    var row = parseInt(params.row, 10);
    if (!row || row < 2 || row > sheet.getLastRow()) {
      return { ok: false, error: 'invalid row' };
    }
    sheet.deleteRow(row);
    return { ok: true };
  }

  if (op === 'followup') {
    var row = parseInt(params.row, 10);
    if (!row || row < 2 || row > sheet.getLastRow()) {
      return { ok: false, error: 'invalid row' };
    }
    // Column H = 8
    sheet.getRange(row, 8).setValue(params.sent === 'true' ? 'TRUE' : 'FALSE');
    return { ok: true };
  }

  if (op === 'staffnotes') {
    var row = parseInt(params.row, 10);
    if (!row || row < 2 || row > sheet.getLastRow()) {
      return { ok: false, error: 'invalid row' };
    }
    // Column J = 10
    sheet.getRange(row, 10).setValue(params.notes || '');
    return { ok: true };
  }

  if (op === 'setting') {
    var settingKeys = { hideLensSection: 'HIDE_LENS_SECTION' };
    var propKey = settingKeys[params.key];
    if (!propKey) {
      return { ok: false, error: 'unknown setting key' };
    }
    PropertiesService.getScriptProperties().setProperty(propKey, params.value === 'true' ? 'true' : 'false');
    return { ok: true };
  }

  return { ok: true, records: readRecords(sheet) };
}

/**
 * Public settings that affect the customer-facing registration form.
 * Readable without a password since the form itself needs them.
 */
function handleGetSettings() {
  var props = PropertiesService.getScriptProperties();
  return {
    ok: true,
    hideLensSection: props.getProperty('HIDE_LENS_SECTION') === 'true'
  };
}

function readRecords(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }

  var values = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  var records = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    records.push({
      row: i + 2,
      timestamp:   row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ''),
      memberNo:    row[1] || '',  // B
      name:        row[2] || '',  // C
      email:       row[3] || '',  // D
      optin:       row[4] || '',  // E
      country:     row[5] || '',  // F
      lang:        row[6] || '',  // G
      followupSent: String(row[7]).toUpperCase() === 'TRUE', // H
      frameNames:  row[8] || '',  // I
      staffNotes:  row[9] || '',  // J
      lensOrder:   row[10] || '', // K
      phone:       row[11] || '', // L
      postcode:    row[12] || '', // M
      address:     row[13] || ''  // N
    });
  }
  return records;
}
