/**
 * Google Apps Script webhook for MYKITA OSAKA Frame Warranty Registration.
 * Deploy as Web App (Execute as: Me / Access: Anyone) and paste the
 * resulting /exec URL into SHEET_WEBHOOK_URL in index.html.
 *
 * Spreadsheet column order (A→U), matching the live sheet's actual headers:
 * A Timestamp | B ID | C Name | D Email | E Opt-in | F Country | G Language |
 * H Follow-up Sent | I Purchased (Frame) | J Staff Notes | K Purchased (Lenses) |
 * L Phone Number | M Postcode | N Address(Street) | O Address(Building) |
 * P City/Town | Q State/Province | R considerFrame/Color | S SMS Opt-in |
 * T Customer Type | U considerFrameURL
 * (B is filled in manually in the sheet for a purchaser, or auto-filled
 * with the Confirm Token for a prospect — see below. J (Staff Notes) is
 * auto-filled with the purchaser's optional Gender when given, otherwise
 * left blank for staff to use as an actual note. K (Purchased (Lenses),
 * no longer tracked — the header label is stale) is auto-filled with the
 * purchaser's optional Date of Birth (YYYY-MM-DD, from the form's date
 * input) when given. U is always blank on submission — staff fill it in
 * manually afterward.)
 *
 * A prospect's optional phone number reuses column L (Phone Number) — the
 * same column a purchaser's lens-shipping phone uses — since a single
 * registration is always one or the other, never both. N-Q hold a
 * purchaser's lens-shipping address, split the same way the intl address
 * form splits it (street / building / city / state-province); the JA
 * address form doesn't separate street and building, so both go into N.
 * SMS Opt-in (S) and Customer Type (T) are blank/"Purchaser" for a normal
 * purchaser registration, since they only apply to prospects.
 *
 * Up to 3 considering frames (model + color number) are combined into a
 * single cell (column R), each formatted as "Frame Name/C###" and joined
 * with ", ", e.g. "Kelly Sun/C301, Aiko/C204". Column U optionally holds
 * one product-page URL per frame, in the same order and also joined with
 * ", " (e.g. "https://.../kelly-sun, https://.../aiko") — staff type these
 * in directly; a blank entry for a given position just leaves that frame
 * unlinked. buildConfirmFrameListHtml() matches them to frames by index.
 * Timestamp (column A) is stored as a real date and displayed in Japan
 * time as yyyy/mm/dd hh:mm:ss; run fixExistingTimestamps() once to apply
 * the same formatting to rows submitted before this was added.
 *
 * Confirm Token: column B (ID) is only used for purchasers, filled
 * in manually by staff, so a prospect's row reuses that same column to
 * store its random confirm token (generated client-side) instead of
 * adding a new column. It lets a prospect's SMS link that one
 * registration's name and considered frames, without a password.
 *
 * That link (built by index.html as SHEET_WEBHOOK_URL + "?page=confirm
 * &id=...") is rendered by renderConfirmPage() below as a full HTML page
 * on this Web App's own script.google.com domain, rather than pointing to
 * the GitHub Pages copy of confirm.html — a customer-facing link should
 * not surface the personal GitHub account the Pages site is deployed
 * under. handleGetConfirm() (action=confirm, JSON) is kept for the static
 * confirm.html page in the repo, but nothing links to that page anymore.
 * Both intentionally expose only name + considered frames — never email/
 * phone/address — since this is unauthenticated.
 *
 * Phone Number (L) is stored encrypted, not as plain text, so the raw
 * cell is unreadable to anyone who can merely view the spreadsheet.
 * Apps Script has no built-in symmetric cipher (Utilities only offers
 * hashing/HMAC), so encryptPhone_()/decryptPhone_() build one from
 * HMAC-SHA-256: a keyed counter-mode keystream (HMAC(key, nonce||counter))
 * XORed with the plaintext, plus an encrypt-then-MAC tag so a corrupted or
 * tampered cell decrypts to "[復号エラー]" instead of garbage. The key is
 * a random 32 bytes generated on first use and stored in this project's
 * Script Properties (PHONE_ENC_KEY) — never in the sheet, never returned
 * by any endpoint. Randomness comes from hashing pairs of Utilities.
 * getUuid() (backed by a real CSPRNG), not Math.random(). doPost()
 * encrypts on write; readRecords() decrypts for the password-gated admin
 * panel only. Run encryptExistingPhoneNumbers() once (see its own comment)
 * to convert phone numbers saved before this was added.
 */
var SPREADSHEET_TIMEZONE = 'Asia/Tokyo';
var TIMESTAMP_DISPLAY_FORMAT = 'yyyy/mm/dd hh:mm:ss';

// ── Phone number encryption (see the header comment above for the design) ──
var PHONE_ENC_KEY_PROP = 'PHONE_ENC_KEY';
var PHONE_ENC_PREFIX = 'ENC1:';

// Utilities.getUuid() is backed by a real CSPRNG (unlike Math.random()),
// so hashing pairs of them is a reasonable way to get random bytes without
// a native crypto.getRandomValues() in Apps Script.
function generateRandomBytes_(n) {
  var out = [];
  while (out.length < n) {
    var raw = Utilities.getUuid() + '-' + Utilities.getUuid();
    out = out.concat(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw));
  }
  return out.slice(0, n);
}

function getPhoneEncKeyBytes_() {
  var props = PropertiesService.getScriptProperties();
  var keyB64 = props.getProperty(PHONE_ENC_KEY_PROP);
  if (!keyB64) {
    keyB64 = Utilities.base64Encode(generateRandomBytes_(32));
    props.setProperty(PHONE_ENC_KEY_PROP, keyB64);
  }
  return Utilities.base64Decode(keyB64);
}

// HMAC-SHA-256 in counter mode: keystream block i = HMAC(key, nonce || i).
// XORing this with the plaintext is the same construction as AES-CTR, just
// with HMAC-SHA-256 as the keyed PRF instead of an AES block cipher.
function hmacKeystream_(keyBytes, nonceBytes, byteLen) {
  var out = [];
  var counter = 0;
  while (out.length < byteLen) {
    var counterBytes = [(counter >>> 24) & 0xff, (counter >>> 16) & 0xff, (counter >>> 8) & 0xff, counter & 0xff];
    out = out.concat(Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, nonceBytes.concat(counterBytes), keyBytes));
    counter++;
  }
  return out.slice(0, byteLen);
}

function xorBytes_(a, b) {
  var out = [];
  for (var i = 0; i < a.length; i++) { out.push((a[i] & 0xff) ^ (b[i] & 0xff)); }
  return out;
}

// Constant-time-ish comparison so MAC verification doesn't leak timing.
function bytesEqual_(a, b) {
  if (a.length !== b.length) { return false; }
  var diff = 0;
  for (var i = 0; i < a.length; i++) { diff |= (a[i] & 0xff) ^ (b[i] & 0xff); }
  return diff === 0;
}

function encryptPhone_(plaintext) {
  var text = String(plaintext || '');
  if (!text) { return ''; }
  var keyBytes = getPhoneEncKeyBytes_();
  var nonceBytes = generateRandomBytes_(16);
  var ptBytes = Utilities.newBlob(text).getBytes();
  var ctBytes = xorBytes_(ptBytes, hmacKeystream_(keyBytes, nonceBytes, ptBytes.length));
  var mac = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, nonceBytes.concat(ctBytes), keyBytes);
  return PHONE_ENC_PREFIX + Utilities.base64Encode(nonceBytes) + '.' + Utilities.base64Encode(ctBytes) + '.' + Utilities.base64Encode(mac);
}

// Returns the stored value unchanged if it isn't in our encrypted format
// (a legacy plaintext row), and "[復号エラー]" if it's tagged as encrypted
// but the MAC doesn't check out (corrupted cell or wrong key).
function decryptPhone_(stored) {
  var text = String(stored || '');
  if (!text) { return ''; }
  if (text.indexOf(PHONE_ENC_PREFIX) !== 0) { return text; }

  var parts = text.slice(PHONE_ENC_PREFIX.length).split('.');
  if (parts.length !== 3) { return '[復号エラー]'; }

  try {
    var nonceBytes = Utilities.base64Decode(parts[0]);
    var ctBytes = Utilities.base64Decode(parts[1]);
    var macBytes = Utilities.base64Decode(parts[2]);
    var keyBytes = getPhoneEncKeyBytes_();

    var expectedMac = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, nonceBytes.concat(ctBytes), keyBytes);
    if (!bytesEqual_(expectedMac, macBytes)) { return '[復号エラー]'; }

    var ptBytes = xorBytes_(ctBytes, hmacKeystream_(keyBytes, nonceBytes, ctBytes.length));
    return Utilities.newBlob(ptBytes).getDataAsString('UTF-8');
  } catch (err) {
    return '[復号エラー]';
  }
}

/**
 * One-time utility: open this script in the Apps Script editor, select
 * "encryptExistingPhoneNumbers" in the function dropdown next to Run, and
 * click Run. Encrypts every existing plaintext Phone Number cell (column L)
 * in place; already-encrypted or empty cells are left untouched.
 *
 * Back up the sheet first (File > Make a copy) — this overwrites column L
 * directly and there is no undo button for a script-driven edit beyond the
 * sheet's own version history.
 */
function encryptExistingPhoneNumbers() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }

  var range = sheet.getRange(2, 12, lastRow - 1, 1); // column L
  var values = range.getValues();
  var changed = 0;
  for (var i = 0; i < values.length; i++) {
    var v = String(values[i][0] || '');
    if (v && v.indexOf(PHONE_ENC_PREFIX) !== 0) {
      values[i][0] = encryptPhone_(v);
      changed++;
    }
  }
  range.setValues(values);
  Logger.log('Encrypted ' + changed + ' phone number(s).');
}

function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSpreadsheetTimeZone() !== SPREADSHEET_TIMEZONE) {
    ss.setSpreadsheetTimeZone(SPREADSHEET_TIMEZONE);
  }
  var sheet = ss.getActiveSheet();
  var data = JSON.parse(e.postData.contents);

  var headers = ['Timestamp', 'ID', 'Name', 'Email', 'Opt-in', 'Country', 'Language', 'Follow-up Sent', 'Purchased (Frame)', 'Staff Notes', 'Purchased (Lenses)', 'Phone Number', 'Postcode', 'Address(Street)', 'Address(Building)', 'City/Town', 'State/Province', 'considerFrame/Color', 'SMS Opt-in', 'Customer Type', 'considerFrameURL'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  var country = data.country || '';
  if (data.countryCode) {
    country += ' (' + data.countryCode + ')';
  }

  var isProspect = data.customerType === 'prospect';

  // Up to 3 candidate frames, each combined into "Model/C###" and joined
  // with ", " into the single considerFrame/Color cell (column R).
  var prospectFrames = Array.isArray(data.prospectFrames) ? data.prospectFrames.slice(0, 3) : [];
  var considerFrameColor = prospectFrames.map(function(f) {
    var model = (f && f.model) || '';
    var color = (f && f.color) || '';
    if (model && color) { return model + '/C' + color; }
    if (model) { return model; }
    if (color) { return 'C' + color; }
    return '';
  }).filter(function(s) { return s; }).join(', ');

  // Store a real Date (not a string) so the sheet can render it in Japan
  // time via the cell number format below, while readRecords() can still
  // recover the exact instant with row[0].toISOString().
  var timestampValue = data.timestamp ? new Date(data.timestamp) : '';

  sheet.appendRow([
    timestampValue,          // A: Timestamp
    isProspect ? (data.confirmToken || '') : (data.memberNo || ''), // B: ID / Confirm Token
    data.name || '',        // C: Name
    data.email || '',       // D: Email
    isProspect ? 'N/A' : (data.optin ? 'Yes' : 'No'), // E: Opt-in
    country,                // F: Country
    (data.lang || '').toUpperCase(), // G: Language
    '',                                    // H: Follow-up Sent (always blank)
    data.frameNames || '',                 // I: Purchased (Frame)
    isProspect ? '' : (data.gender || ''), // J: Staff Notes (purchaser's optional gender)
    isProspect ? '' : (data.dob || ''),    // K: Purchased (Lenses) (purchaser's optional date of birth)
    encryptPhone_(isProspect ? (data.prospectPhone || '') : (data.phone || '')), // L: Phone Number (encrypted)
    data.postcode || '',                   // M: Postcode
    data.addressStreet || '',              // N: Address(Street)
    data.addressBuilding || '',            // O: Address(Building)
    data.addressCity || '',                // P: City/Town
    data.addressState || '',               // Q: State/Province
    considerFrameColor,                    // R: considerFrame/Color
    isProspect ? (data.prospectSmsOptIn ? 'Yes' : 'No') : '', // S: SMS Opt-in
    isProspect ? 'Prospect' : 'Purchaser', // T: Customer Type
    ''                                     // U: considerFrameURL (filled in manually by staff)
  ]);

  var newRow = sheet.getLastRow();
  if (timestampValue) {
    sheet.getRange(newRow, 1).setNumberFormat(TIMESTAMP_DISPLAY_FORMAT);
  }

  return ContentService.createTextOutput(JSON.stringify({ result: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * One-time utility: open this script in the Apps Script editor, select
 * "fixExistingTimestamps" in the function dropdown next to Run, and click
 * Run. It converts every existing Timestamp cell (column A) into a real
 * date shown in Japan time as yyyy/mm/dd hh:mm:ss, matching new
 * submissions. Safe to re-run.
 */
function fixExistingTimestamps() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(SPREADSHEET_TIMEZONE);
  var sheet = ss.getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return; }

  var range = sheet.getRange(2, 1, lastRow - 1, 1);
  var values = range.getValues();
  for (var i = 0; i < values.length; i++) {
    var v = values[i][0];
    if (v && !(v instanceof Date)) {
      var d = new Date(v);
      if (!isNaN(d.getTime())) {
        values[i][0] = d;
      }
    }
  }
  range.setValues(values);
  range.setNumberFormat(TIMESTAMP_DISPLAY_FORMAT);
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

  if (params.page === 'confirm') {
    return renderConfirmPage(params);
  }

  var out;

  if (params.action === 'admin') {
    out = handleAdminRequest(params);
  } else if (params.action === 'addframes') {
    out = handleAddFrames(params);
  } else if (params.action === 'settings') {
    out = handleGetSettings();
  } else if (params.action === 'confirm') {
    out = handleGetConfirm(params);
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

/**
 * Given the random confirm token from a prospect's SMS link, finds that
 * one row and returns only what a customer-facing page needs to display
 * (name, considered frames) — never email/phone/address, since both
 * callers below (JSON and HTML) are unauthenticated.
 */
function findConfirmRecord(token) {
  if (!token) { return null; }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return null; }

  var values = sheet.getRange(2, 1, lastRow - 1, 21).getValues();
  for (var i = 0; i < values.length; i++) {
    var rowToken = String(values[i][1] || ''); // B
    if (rowToken && rowToken === token) {
      return {
        name: values[i][2] || '',              // C
        considerFrameColor: values[i][17] || '', // R
        considerFrameUrl: values[i][20] || ''    // U
      };
    }
  }
  return null;
}

/**
 * JSON lookup kept for the static confirm.html page in the repo (not
 * currently linked from anywhere live — see the header comment above).
 */
function handleGetConfirm(params) {
  var token = String(params.id || '').trim();
  if (!token) { return { ok: false, error: 'missing id' }; }
  var record = findConfirmRecord(token);
  if (!record) { return { ok: false, error: 'not found' }; }
  return {
    ok: true,
    name: record.name,
    considerFrameColor: record.considerFrameColor,
    considerFrameUrl: record.considerFrameUrl
  };
}

/**
 * Server-rendered confirmation page for a prospect's SMS link, served
 * from this Web App's own script.google.com domain (rather than GitHub
 * Pages) so the link doesn't surface the personal GitHub account the
 * Pages site is deployed under. Renders fully on the server, so there's
 * no client-side fetch/loading flash.
 */
function renderConfirmPage(params) {
  var token = String(params.id || '').trim();
  var record = token ? findConfirmRecord(token) : null;
  var bodyHtml = record ? buildConfirmContentHtml(record) : buildConfirmNotFoundHtml();

  var html = '<!DOCTYPE html><html lang="ja"><head>'
    + '<meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<title>MYKITA OSAKA - ご確認ページ</title>'
    + '<style>' + CONFIRM_PAGE_CSS + '</style>'
    + '</head><body><div class="page">'
    + '<div class="header"><div class="logo">MYKITA OSAKA</div>'
    + '<div class="logo-sub">フレームのご検討をいただきありがとうございます</div></div>'
    + bodyHtml
    + '</div></body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('MYKITA OSAKA - ご確認ページ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function escapeHtmlGs(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only http(s) links are ever emitted as href — a stray value staff might
// paste into the URL column (or leave blank) never becomes a javascript:
// or other unexpected scheme.
function isSafeHttpUrl_(url) {
  return /^https?:\/\//i.test(url);
}

function buildConfirmFrameListHtml(considerFrameColor, considerFrameUrl) {
  var frames = String(considerFrameColor || '')
    .split(',')
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return s; });

  // Not filtered: a blank between two commas (e.g. "url1, , url3") is a
  // deliberate "no link for frame 2", kept so positions still line up with
  // considerFrameColor's frames by index.
  var urls = String(considerFrameUrl || '').split(',').map(function(s) { return s.trim(); });

  return frames.map(function(frame, i) {
    var parts = frame.split('/C');
    var model = (parts[0] || '').trim();
    var color = parts.length > 1 ? 'C' + parts[1].trim() : '';

    // Staff mark a frame out of stock by appending "*" right after the
    // model name in the sheet cell (e.g. "LAGON*/C222").
    var needsCheck = model.slice(-1) === '*';
    if (needsCheck) { model = model.slice(0, -1).trim(); }

    var url = urls[i] || '';
    var modelHtml = escapeHtmlGs(model);
    if (isSafeHttpUrl_(url)) {
      modelHtml = '<a href="' + escapeHtmlGs(url) + '" target="_blank" rel="noopener">' + modelHtml + '</a>';
    }

    return '<li class="frame-item"><span class="model">' + modelHtml + '</span>'
      + '<span class="item-right">'
      + (needsCheck ? '<span class="stock-badge">要確認</span>' : '')
      + (color ? '<span class="color">' + escapeHtmlGs(color) + '</span>' : '')
      + '</span></li>';
  }).join('');
}

function hasNeedsCheckFrame(considerFrameColor) {
  return String(considerFrameColor || '')
    .split(',')
    .map(function(s) { return s.trim(); })
    .some(function(frame) {
      var model = (frame.split('/C')[0] || '').trim();
      return model.slice(-1) === '*';
    });
}

function buildConfirmContentHtml(record) {
  return '<div class="main">'
    + '<p class="greeting">' + escapeHtmlGs(record.name) + ' 様</p>'
    + '<p class="lead">この度はMYKITA Osakaへご来店いただき、誠にありがとうございます。<br>ご検討いただいたフレームは以下の通りです。</p>'
    + '<p class="section-label">ご検討中のフレーム</p>'
    + '<ul class="frame-list">' + buildConfirmFrameListHtml(record.considerFrameColor, record.considerFrameUrl) + '</ul>'
    + (hasNeedsCheckFrame(record.considerFrameColor)
        ? '<p class="stock-note">※「要確認」のフレームは、在庫がない可能性がございます。</p>'
        : '')
    + '<p class="hp-note">上記フレームの画像は<a href="https://mykita.com/en" target="_blank" rel="noopener">MYKITAの公式ホームページ</a>よりご確認いただけます。</p>'
    + '<p class="section-label">ご案内</p>'
    + '<p class="info-block">ご検討いただいたフレームの在庫状況につきましても、随時お問い合わせを承っております。<br>また、お取り置きも可能でございますので、お気軽にお問い合わせください。</p>'
    + '<p class="hold-note">※お取り置きは、原則2週間までとさせていただいております。あらかじめご了承ください。</p>'
    + '<div class="store-card">'
    + '<div class="store-name">MYKITA Osaka</div>'
    + '<div class="store-rows">'
    + '<div class="store-row"><span class="k">Tel</span><a href="tel:0665637747">06-6563-7747</a></div>'
    + '<div class="store-row"><span class="k">Email</span><a href="mailto:osaka@mykita.com">osaka@mykita.com</a></div>'
    + '<div class="store-row"><span class="k">HP</span><a href="https://mykita.com/en" target="_blank" rel="noopener">mykita.com/en</a></div>'
    + '<div class="store-row"><span class="k">Map</span><a href="https://share.google/mw7yBJWFXs3xLcj1Y" target="_blank" rel="noopener">Google マップで開く</a></div>'
    + '</div></div></div>';
}

function buildConfirmNotFoundHtml() {
  return '<div class="status-block">ページが見つかりませんでした。<br>URLをご確認いただくか、店舗までお問い合わせください。</div>';
}

var CONFIRM_PAGE_CSS = ':root{--bg:#ffffff;--surface:#f5f5f5;--border:#d0d0d0;--light:#1a1a1a;--mid:#666666;'
  + '--blue:#185FA5;--orange:#b85c00;--orange-bg:#fff3e0;--font:\'Helvetica Neue\',Helvetica,Arial,sans-serif;'
  + 'color-scheme:light;}'
  + '*{box-sizing:border-box;}'
  + 'body{margin:0;background:var(--bg);color:var(--light);font-family:var(--font);-webkit-font-smoothing:antialiased;}'
  + '.page{max-width:480px;margin:0 auto;padding-bottom:60px;}'
  + '.header{padding:48px 20px 28px;text-align:center;border-bottom:0.5px solid var(--border);}'
  + '.logo{font-size:20px;letter-spacing:0.28em;font-weight:600;}'
  + '.logo-sub{margin-top:8px;font-size:12px;letter-spacing:0.1em;color:var(--mid);}'
  + '.main{padding:32px 20px 0;}'
  + '.greeting{font-size:15px;margin-bottom:24px;}'
  + '.lead{font-size:14px;line-height:1.8;color:var(--light);margin-bottom:32px;}'
  + '.section-label{font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:var(--mid);'
  + 'border-bottom:0.5px solid var(--border);padding-bottom:10px;margin-bottom:16px;}'
  + '.frame-list{list-style:none;margin:0 0 32px;padding:0;display:flex;flex-direction:column;gap:10px;}'
  + '.frame-item{display:flex;align-items:baseline;justify-content:space-between;gap:12px;'
  + 'border:0.5px solid var(--border);padding:14px 16px;font-size:14px;}'
  + '.frame-item .model{font-weight:500;}'
  + '.frame-item .model a{color:var(--blue);text-decoration:none;}'
  + '.frame-item .model a:hover,.frame-item .model a:focus-visible{text-decoration:underline;}'
  + '.frame-item .item-right{display:flex;align-items:baseline;gap:8px;}'
  + '.frame-item .color{font-size:12px;letter-spacing:0.04em;color:var(--mid);font-variant-numeric:tabular-nums;}'
  + '.frame-item .stock-badge{font-size:11px;letter-spacing:0.04em;color:var(--orange);background:var(--orange-bg);'
  + 'padding:3px 8px;border-radius:3px;white-space:nowrap;}'
  + '.stock-note{font-size:12px;line-height:1.8;color:var(--orange);border-left:2px solid var(--orange);'
  + 'padding-left:12px;margin:-18px 0 24px;}'
  + '.hp-note{font-size:13px;line-height:1.7;color:var(--mid);margin:-18px 0 32px;}'
  + '.hp-note a{color:var(--blue);}'
  + '.info-block{font-size:13px;line-height:1.9;color:var(--light);margin-bottom:20px;}'
  + '.hold-note{font-size:12px;line-height:1.8;color:var(--mid);border-left:2px solid var(--border);'
  + 'padding-left:12px;margin-bottom:44px;}'
  + '.store-card{border-top:0.5px solid var(--border);padding-top:24px;}'
  + '.store-name{font-size:13px;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:14px;}'
  + '.store-rows{display:flex;flex-direction:column;gap:10px;}'
  + '.store-row{display:flex;align-items:center;gap:10px;font-size:13px;}'
  + '.store-row .k{width:76px;flex-shrink:0;color:var(--mid);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;}'
  + '.store-row a{color:var(--blue);text-decoration:none;word-break:break-all;}'
  + '.store-row a:hover,.store-row a:focus-visible{text-decoration:underline;}'
  + '.store-row a:focus-visible{outline:2px solid var(--blue);outline-offset:2px;}'
  + '.status-block{padding:60px 20px;text-align:center;font-size:14px;color:var(--mid);line-height:1.8;}';

function readRecords(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }

  var values = sheet.getRange(2, 1, lastRow - 1, 20).getValues();
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
      dob:         row[10] || '', // K (purchaser's optional date of birth)
      phone:       decryptPhone_(row[11]), // L (decrypted for the password-gated admin panel)
      postcode:    row[12] || '', // M
      addressStreet:   row[13] || '', // N
      addressBuilding: row[14] || '', // O
      addressCity:     row[15] || '', // P
      addressState:    row[16] || '', // Q
      considerFrameColor: row[17] || '',          // R
      smsOptIn:          row[18] || '',           // S
      customerType:      row[19] || 'Purchaser'   // T
    });
  }
  return records;
}

// ── "Prospect URLs" spreadsheet menu ──
// A small custom-menu dialog for staff to fill in the U column (considering-
// frame product URLs) without having to hand-type comma-joined, position-
// matched strings directly into the cell. onOpen() runs automatically each
// time the spreadsheet is opened; it adds the menu, which opens a modal
// dialog (showProspectFrameUrlDialog) backed by getProspectFrameUrlList(),
// getProspectFrameUrlDetail() and saveProspectFrameUrls() via google.script.run.

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Prospect URLs')
    .addItem('開く', 'showProspectFrameUrlDialog')
    .addToUi();
}

function showProspectFrameUrlDialog() {
  var html = HtmlService.createHtmlOutput(PROSPECT_URL_DIALOG_HTML)
    .setWidth(480)
    .setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'Prospect URLs');
}

// Every "type=prospect" row (Customer Type = "Prospect", column T), newest
// timestamp first, for the dialog's selection list.
function getProspectFrameUrlList() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return []; }

  var values = sheet.getRange(2, 1, lastRow - 1, 21).getValues();
  var list = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (String(row[19] || '') !== 'Prospect') { continue; } // T

    var ts = row[0]; // A
    var tsDate = ts instanceof Date ? ts : new Date(ts);
    var tsMillis = isNaN(tsDate.getTime()) ? 0 : tsDate.getTime();

    list.push({
      row: i + 2,
      name: row[2] || '', // C
      timestamp: tsMillis,
      timestampDisplay: tsMillis
        ? Utilities.formatDate(tsDate, SPREADSHEET_TIMEZONE, TIMESTAMP_DISPLAY_FORMAT)
        : ''
    });
  }
  list.sort(function(a, b) { return b.timestamp - a.timestamp; });
  return list;
}

// One row's considering frames, each paired with its current U-column URL
// (blank if none yet) so the dialog can pre-fill the input fields.
function getProspectFrameUrlDetail(row) {
  var rowNum = parseInt(row, 10);
  if (!rowNum || rowNum < 2) { return null; }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var values = sheet.getRange(rowNum, 1, 1, 21).getValues()[0];
  var name = values[2] || '';               // C
  var considerFrameColor = values[17] || ''; // R
  var considerFrameUrl = values[20] || '';   // U

  var frames = String(considerFrameColor)
    .split(',')
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return s; });
  var urls = String(considerFrameUrl).split(',').map(function(s) { return s.trim(); });

  var items = frames.map(function(frame, i) {
    var parts = frame.split('/C');
    var model = (parts[0] || '').trim();
    var color = parts.length > 1 ? 'C' + parts[1].trim() : '';
    return { model: model, color: color, url: urls[i] || '' };
  });

  return { row: rowNum, name: name, frames: items };
}

// Writes urls (one per frame, in order) back into column U as the same
// comma-joined, position-matched format buildConfirmFrameListHtml() expects
// — an empty string at index i just leaves that frame unlinked. Trailing
// empty entries are dropped so an unused 2nd/3rd box doesn't leave a
// dangling ", " in the cell; a blank *between* two filled entries is kept.
function saveProspectFrameUrls(row, urls) {
  var rowNum = parseInt(row, 10);
  if (!rowNum || rowNum < 2) { return { ok: false, error: 'invalid row' }; }

  var cleaned = (urls || []).map(function(u) { return String(u || '').trim(); });
  while (cleaned.length && !cleaned[cleaned.length - 1]) { cleaned.pop(); }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.getRange(rowNum, 21).setValue(cleaned.join(', ')); // U
  return { ok: true };
}

var PROSPECT_URL_DIALOG_HTML = '<!DOCTYPE html><html><head><base target="_top">'
  + '<style>'
  + 'body{margin:0;padding:16px;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;'
  + 'font-size:13px;color:#1a1a1a;}'
  + '.hint{font-size:12px;color:#666666;margin:0 0 12px;}'
  + '#list{display:flex;flex-direction:column;gap:6px;max-height:460px;overflow-y:auto;}'
  + '.list-item{display:flex;justify-content:space-between;align-items:center;gap:10px;'
  + 'width:100%;text-align:left;padding:10px 12px;border:1px solid #d0d0d0;border-radius:4px;'
  + 'background:#ffffff;font-size:13px;font-family:inherit;color:#1a1a1a;cursor:pointer;}'
  + '.list-item:hover{border-color:#185FA5;}'
  + '.list-item .name{font-weight:500;}'
  + '.list-item .ts{font-size:11px;color:#666666;white-space:nowrap;}'
  + '#detail-view{display:none;}'
  + '#back-btn{background:none;border:none;color:#185FA5;font-size:13px;cursor:pointer;'
  + 'padding:0 0 12px;font-family:inherit;}'
  + '#detail-name{font-size:14px;font-weight:500;margin:0 0 14px;}'
  + '.frame-row{margin-bottom:12px;}'
  + '.frame-label{font-size:12px;color:#666666;margin-bottom:4px;}'
  + '.url-input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d0d0d0;'
  + 'border-radius:4px;font-size:13px;font-family:inherit;}'
  + '.url-input:focus{outline:none;border-color:#185FA5;}'
  + '#save-btn{margin-top:8px;padding:10px 16px;border:none;border-radius:4px;background:#185FA5;'
  + 'color:#ffffff;font-size:13px;font-family:inherit;cursor:pointer;}'
  + '#save-btn:hover{background:#124a85;}'
  + '#status{font-size:12px;color:#666666;margin-top:10px;}'
  + '</style></head><body>'
  + '<div id="list-view">'
  + '<p class="hint">検討中のお客様を選択してください（新しい順）</p>'
  + '<div id="list"></div>'
  + '</div>'
  + '<div id="detail-view">'
  + '<button id="back-btn">&larr; 一覧に戻る</button>'
  + '<p id="detail-name"></p>'
  + '<div id="frame-fields"></div>'
  + '<button id="save-btn">保存</button>'
  + '<p id="status"></p>'
  + '</div>'
  + '<script>'
  + 'function escapeHtml(s){var d=document.createElement("div");d.textContent=s||"";return d.innerHTML;}'
  + 'function loadList(){'
  + 'google.script.run.withSuccessHandler(renderList).withFailureHandler(showError).getProspectFrameUrlList();'
  + '}'
  + 'function renderList(list){'
  + 'var el=document.getElementById("list");'
  + 'if(!list.length){el.textContent="検討中のお客様が見つかりません。";return;}'
  + 'el.innerHTML=list.map(function(item){'
  + 'return "<button class=\\"list-item\\" data-row=\\""+item.row+"\\">"'
  + '+"<span class=\\"name\\">"+escapeHtml(item.name)+"</span>"'
  + '+"<span class=\\"ts\\">"+escapeHtml(item.timestampDisplay)+"</span>"'
  + '+"</button>";'
  + '}).join("");'
  + '[].forEach.call(el.querySelectorAll(".list-item"),function(btn){'
  + 'btn.addEventListener("click",function(){openDetail(btn.dataset.row);});'
  + '});'
  + '}'
  + 'function openDetail(row){'
  + 'google.script.run.withSuccessHandler(renderDetail).withFailureHandler(showError).getProspectFrameUrlDetail(row);'
  + '}'
  + 'function renderDetail(detail){'
  + 'document.getElementById("list-view").style.display="none";'
  + 'document.getElementById("detail-view").style.display="block";'
  + 'document.getElementById("detail-name").textContent=detail.name+" 様";'
  + 'var el=document.getElementById("frame-fields");'
  + 'el.innerHTML=detail.frames.map(function(f,i){'
  + 'var label=escapeHtml(f.model)+(f.color?" / "+escapeHtml(f.color):"");'
  + 'return "<div class=\\"frame-row\\">"'
  + '+"<div class=\\"frame-label\\">"+label+"</div>"'
  + '+"<input type=\\"url\\" class=\\"url-input\\" data-index=\\""+i+"\\" value=\\""+escapeHtml(f.url)+"\\" placeholder=\\"https://...\\">"'
  + '+"</div>";'
  + '}).join("");'
  + 'document.getElementById("save-btn").dataset.row=detail.row;'
  + 'document.getElementById("status").textContent="";'
  + '}'
  + 'document.getElementById("back-btn").addEventListener("click",function(){'
  + 'document.getElementById("detail-view").style.display="none";'
  + 'document.getElementById("list-view").style.display="block";'
  + '});'
  + 'document.getElementById("save-btn").addEventListener("click",function(){'
  + 'var row=this.dataset.row;'
  + 'var inputs=[].slice.call(document.querySelectorAll(".url-input"));'
  + 'var urls=inputs.map(function(el){return el.value;});'
  + 'var status=document.getElementById("status");'
  + 'status.textContent="保存中…";'
  + 'google.script.run.withSuccessHandler(function(){'
  + 'status.textContent="保存しました。";'
  + '}).withFailureHandler(showError).saveProspectFrameUrls(row,urls);'
  + '});'
  + 'function showError(err){'
  + 'document.getElementById("status").textContent="エラー: "+(err&&err.message?err.message:err);'
  + '}'
  + 'loadList();'
  + '</script></body></html>';
