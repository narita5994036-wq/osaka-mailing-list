/**
 * Google Apps Script webhook for MYKITA OSAKA Frame Warranty Registration.
 * Deploy as Web App (Execute as: Me / Access: Anyone) and paste the
 * resulting /exec URL into SHEET_WEBHOOK_URL in index.html.
 *
 * Spreadsheet column order:
 * Timestamp | Name | Email | Opt-in | Country | Language | 会員番号 | Follow-up Sent
 * (会員番号 is filled in manually in the sheet, so it is left blank here.)
 */
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);

  var headers = ['Timestamp', 'Name', 'Email', 'Opt-in', 'Country', 'Language', '会員番号', 'Follow-up Sent'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  var country = data.country || '';
  if (data.countryCode) {
    country += ' (' + data.countryCode + ')';
  }

  sheet.appendRow([
    data.timestamp || '',
    data.name || '',
    data.email || '',
    data.optin ? 'Yes' : 'No',
    country,
    (data.lang || '').toUpperCase(),
    data.memberNo || '',
    ''
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
 *   action=admin & password=... & op=followup & row=N & status=pending|sent|na → set follow-up status
 */
function doGet(e) {
  var params = e.parameter || {};
  var out;

  if (params.action === 'admin') {
    out = handleAdminRequest(params);
  } else {
    out = { ok: false, error: 'unknown action' };
  }

  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
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
    var fuRow = parseInt(params.row, 10);
    if (!fuRow || fuRow < 2 || fuRow > sheet.getLastRow()) {
      return { ok: false, error: 'invalid row' };
    }
    var value = '';
    if (params.status === 'sent') value = 'Yes';
    else if (params.status === 'na') value = 'N/A';
    sheet.getRange(fuRow, 8).setValue(value);
    return { ok: true };
  }

  return { ok: true, records: readRecords(sheet) };
}

function readRecords(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }

  var values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var records = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    records.push({
      row: i + 2,
      timestamp: row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ''),
      name: row[1] || '',
      email: row[2] || '',
      optin: row[3] || '',
      country: row[4] || '',
      lang: row[5] || '',
      memberNo: row[6] || '',
      followupStatus: row[7] === 'Yes' ? 'sent' : row[7] === 'N/A' ? 'na' : ''
    });
  }
  return records;
}
