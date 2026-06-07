/**
 * Google Apps Script webhook for MYKITA OSAKA Frame Warranty Registration.
 * Deploy as Web App (Execute as: Me / Access: Anyone) and paste the
 * resulting /exec URL into SHEET_WEBHOOK_URL in index.html.
 *
 * Spreadsheet column order:
 * Timestamp | Name | Email | Opt-in | Country | Language | 会員番号
 * (会員番号 is filled in manually in the sheet, so it is left blank here.)
 */
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);

  var headers = ['Timestamp', 'Name', 'Email', 'Opt-in', 'Country', 'Language', '会員番号'];
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
    data.memberNo || ''
  ]);

  return ContentService.createTextOutput(JSON.stringify({ result: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}
