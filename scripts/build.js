// scripts/build.js
// Builds JSON files from Google Sheets directly into the "site" folder

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA_JSON = process.env.GOOGLE_SERVICE_ACCOUNT;

if (!SHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID secret.');
if (!SA_JSON) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT secret.');

const sa = JSON.parse(SA_JSON);

// Configure auth
const auth = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

// Ensure output folder (site/) exists
const outDir = path.join(process.cwd(), 'site');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

async function fetchRange(range) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return res.data.values || [];
}

// Map rows to objects using a header row
function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = r[i] ?? ''));
    return obj;
  });
}

async function build() {
  console.log('🔄 Building JSON into site/ …');

  // ---- Translations sheet
  // Expected headers: Program | Language | Document name | Event Date/Deadline | Status | Completed Request Link | Date Requested (etc.)
  // Adjust the range to match your sheet tab name & columns:
  const transRows = await fetchRange('Translations!A:G');
  const transObjs = rowsToObjects(transRows);

  // Normalize for UI (title/program/status/date/link/language)
  const translations = transObjs
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

  // ---- Interpretation sheet (optional; keep if you have it)
  // Expected headers: Program | Language/Type | Event name | Event Date | Event Time | Interpreter | Status
  let interpretation = [];
  try {
    const interpRows = await fetchRange('Interpretation!A:G');
    interpretation = rowsToObjects(interpRows).map((r, idx) => ({
      id: idx + 1,
      program: (r['Program'] || '').toString().trim(),
      type: (r['Language/Type'] || '').toString().trim(),
      eventName: (r['Event name'] || '').toString().trim(),
      eventDate: (r['Event Date'] || '').toString().trim(),
      eventTime: (r['Event Time'] || '').toString().trim(),
      interpreter: (r['Interpreter'] || '').toString().trim(),
      status: (r['Status'] || '').toString().trim(),
    }));
  } catch (e) {
    console.log('ℹ️ Interpretation sheet not found or range mismatch; skipping that file.');
  }

  // Write JSON next to the HTML
  fs.writeFileSync(path.join(outDir, 'translations.json'), JSON.stringify(translations, null, 2));
  if (interpretation.length) {
    fs.writeFileSync(path.join(outDir, 'interpretation.json'), JSON.stringify(interpretation, null, 2));
  }

  // Log a quick summary
  console.log(`✅ Wrote site/translations.json (${translations.length} items)`);
  if (interpretation.length) console.log(`✅ Wrote site/interpretation.json (${interpretation.length} items)`);
}

build().catch(err => {
  console.error('❌ Build error:', err);
  process.exit(1);
});
