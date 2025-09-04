// scripts/build.js
// Build JSON files from Google Sheets directly into the "site" folder

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

/* ========= 1) Read & sanitize env ========= */
const rawId = process.env.GOOGLE_SHEET_ID || '';
// strip ALL whitespace (spaces, tabs, newlines) and trim
const SHEET_ID = rawId.trim().replace(/\s+/g, '');

const SA_JSON_RAW = process.env.GOOGLE_SERVICE_ACCOUNT || '';

if (!SHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID secret.');
if (!/^[A-Za-z0-9\-_]{20,}$/.test(SHEET_ID)) {
  throw new Error(
    `GOOGLE_SHEET_ID looks malformed after sanitizing (got "${SHEET_ID}", length=${SHEET_ID.length}).`
  );
}
if (!SA_JSON_RAW) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT secret.');

console.log(`➡️ Using Sheet ID …${SHEET_ID.slice(-6)} (len=${SHEET_ID.length})`);

/* ========= 2) Service account auth ========= */
let sa;
try {
  sa = JSON.parse(SA_JSON_RAW);
} catch (e) {
  throw new Error('GOOGLE_SERVICE_ACCOUNT is not valid JSON.');
}

const auth = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

/* ========= 3) Helpers ========= */
async function fetchRange(range) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    return res.data.values || [];
  } catch (err) {
    const msg = err?.response?.data?.error?.message || err.message || String(err);
    // Common causes: wrong tab name or invalid range
    throw new Error(`Unable to read range "${range}": ${msg}`);
  }
}

// Convert a 2D array where first row is headers into objects
function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  return rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => (o[h] = r[i] ?? ''));
    return o;
  });
}

/* ========= 4) Build ========= */
async function build() {
  console.log('🔄 Building JSON into site/ …');

  // Ensure output dir exists
  const outDir = path.join(process.cwd(), 'site');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // ---- Translations (tab name must match your sheet)
  // Expected headers: Program | Language | Document name | Event Date/Deadline | Status | Completed Request Link | Date Requested
  // If your tab is named differently, change "Translations" below to the exact tab name.
  const TRANSLATIONS_RANGE = 'Translations!A:G';

  let translations = [];
  try {
    const transRows = await fetchRange(TRANSLATIONS_RANGE);
    const transObjs = rowsToObjects(transRows);

    translations = transObjs
      .map((r, idx) => ({
        id: idx + 1,
        type: 'Translation',
        program: (r['Program'] || '').toString().trim(),
        title: (r['Document name'] || r['Title'] || '').toString().trim(),
        language: (r['Language'] || '').toString().trim(),
        status: (r['Status'] || 'Pending').toString().trim(),
        dateRequested: (r['Date Requested'] || '').toString().trim(),
        date: (r['Event Date'] || r['Deadline'] || '').toString().trim(),
        link: (r['Completed Request Link'] || r['Link'] || '').toString().trim(),
      }))
      .filter(x => x.program && x.title);

    fs.writeFileSync(
      path.join(outDir, 'translations.json'),
      JSON.stringify(translations, null, 2)
    );
    console.log(`✅ Wrote site/translations.json (${translations.length} items)`);
  } catch (e) {
    console.error('⚠️ Translations build skipped:', e.message);
    // Still write an empty file so the site loads
    fs.writeFileSync(path.join(outDir, 'translations.json'), JSON.stringify([], null, 2));
  }

  // ---- Interpretation (optional)
  // Expected headers: Program | Language/Type | Event name | Event Date | Event Time | Interpreter | Status
  // Change the tab name if yours is different.
  const INTERP_RANGE = 'Interpretation!A:G';

  try {
    const interpRows = await fetchRange(INTERP_RANGE);
    const interpObjs = rowsToObjects(interpRows);

    const interpretation = interpObjs.map((r, idx) => ({
      id: idx + 1,
      program: (r['Program'] || '').toString().trim(),
      type: (r['Language/Type'] || '').toString().trim(),
      eventName: (r['Event name'] || '').toString().trim(),
      eventDate: (r['Event Date'] || '').toString().trim(),
      eventTime: (r['Event Time'] || '').toString().trim(),
      interpreter: (r['Interpreter'] || '').toString().trim(),
      status: (r['Status'] || '').toString().trim(),
    }));

    fs.writeFileSync(
      path.join(outDir, 'interpretation.json'),
      JSON.stringify(interpretation, null, 2)
    );
    console.log(`✅ Wrote site/interpretation.json (${interpretation.length} items)`);
  } catch (e) {
    // It's OK if the Interpretation tab/range doesn't exist yet.
    console.log('ℹ️ Interpretation skipped:', e.message);
  }

  if (!translations.length) {
    console.log(
      'ℹ️ No translation rows found. If this is unexpected, confirm the tab name and headers in your sheet, and the service account has at least Viewer access.'
    );
  }
}

build().catch(err => {
  console.error('❌ Build error:', err);
  process.exit(1);
});
