// scripts/build.js
// Build JSON files from Google Sheets directly into the "site" folder

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

/* ========= 1) Read & sanitize env ========= */
const rawId = process.env.GOOGLE_SHEET_ID || '';
const SHEET_ID = rawId.trim().replace(/\s+/g, ''); // remove all whitespace
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
} catch {
  throw new Error('GOOGLE_SERVICE_ACCOUNT is not valid JSON.');
}

const auth = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

/* ========= 3) Helpers ========= */

// Normalize any string: strip BOM, convert non-breaking spaces to normal spaces,
// collapse all whitespace (incl. \u00A0), and trim.
function normStr(x) {
  return String(x ?? '')
    .replace(/^\uFEFF/, '') // BOM
    .replace(/\u00A0/g, ' ') // NBSP -> space
    .replace(/[\s\u00A0]+/g, ' ')
    .trim();
}

async function fetchRange(range) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return res.data.values || [];
}

// Try a list of possible tab names; return the first non-empty result.
async function fetchFirstExistingRange(possibleTabs, a1Range) {
  for (const tab of possibleTabs) {
    const range = `${tab}!${a1Range}`;
    try {
      const rows = await fetchRange(range);
      if (rows.length) {
        console.log(`✅ Found data in tab "${tab}" (${rows.length} rows).`);
        return { rows, usedTab: tab };
      } else {
        console.log(`ℹ️ Tab "${tab}" is empty; trying next…`);
      }
    } catch (err) {
      const msg = err?.response?.data?.error?.message || err.message;
      console.log(`ℹ️ Could not read "${range}": ${msg}`);
    }
  }
  return { rows: [], usedTab: null };
}

// rows[0] are headers; normalize headers robustly
function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headersOriginal = rows[0].map(h => normStr(h));
  const headersKey = headersOriginal.map(h => h.toLowerCase()); // spaces already collapsed by normStr
  return rows.slice(1).map(r => {
    const o = {};
    headersKey.forEach((h, i) => (o[h] = normStr(r[i])));
    // keep the original header row for reference (for logging)
    o.__headers = headersOriginal;
    return o;
  });
}

// pick first non-empty value across a list of header synonyms
function pick(obj, keys) {
  for (const k of keys) {
    const key = normStr(k).toLowerCase();
    const val = obj[key];
    if (val !== undefined && val !== null && `${val}`.trim() !== '') {
      return `${val}`.trim();
    }
  }
  return '';
}

/* ========= 4) Build ========= */
async function build() {
  console.log('🔄 Building JSON into site/ …');

  const outDir = path.join(process.cwd(), 'site');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  /* ----- Translations: flexible tab & headers ----- */
  const candidateTranslationTabs = [
    'Translations',
    'Translation',               // allow singular
    'Translation Requests',
    'Translations Dashboard',
  ];

  let translations = [];
  try {
    const { rows, usedTab } = await fetchFirstExistingRange(candidateTranslationTabs, 'A:Z');
    if (!rows.length) {
      throw new Error(
        `No rows found in any of these tabs: ${candidateTranslationTabs.join(', ')}`
      );
    }

    const objs = rowsToObjects(rows);
    console.log('📝 Translations headers detected:', objs[0]?.__headers || []);

    // Your exact headers (plus common variants):
    const K = {
      program: ['Program', 'Department', 'Program Name'],
      title: ['Document Name', 'Document', 'Title', 'Request', 'Document title'],
      language: ['Language', 'Language/Type', 'Target Language'],
      status: ['Status', 'Current Status'],
      dateRequested: ['Date Requested', 'Requested', 'Request Date', 'Created'],
      date: ['Deadline', 'Due Date', 'Event Date', 'Date'],
      link: ['Completed Request Link', 'Link', 'URL', 'Output Link'],
    };

    const preCount = objs.length;

    translations = objs
      .map((r, idx) => ({
        id: idx + 1,
        type: 'Translation',
        program: pick(r, K.program),
        title: pick(r, K.title),
        language: pick(r, K.language),
        status: pick(r, K.status) || 'Pending',
        dateRequested: pick(r, K.dateRequested),
        date: pick(r, K.date),
        link: pick(r, K.link),
      }))
      // keep row if it has EITHER a program OR a title (looser filter)
      .filter(x => (x.program && x.program !== '') || (x.title && x.title !== ''));

    console.log(`ℹ️ Translations rows: raw=${preCount}, after-filter=${translations.length}`);

    fs.writeFileSync(
      path.join(outDir, 'translations.json'),
      JSON.stringify(translations, null, 2)
    );
    console.log(
      `✅ Wrote site/translations.json (${translations.length} items) from tab "${usedTab}".`
    );
  } catch (e) {
    console.error('⚠️ Translations build issue:', e.message);
    fs.writeFileSync(path.join(outDir, 'translations.json'), JSON.stringify([], null, 2));
  }

  /* ----- Interpretation (your headers are fine) ----- */
  const candidateInterpTabs = ['Interpretation', 'Interpretation Requests', 'Interpretations'];

  try {
    const { rows, usedTab } = await fetchFirstExistingRange(candidateInterpTabs, 'A:Z');
    if (!rows.length) throw new Error('No rows found for Interpretation.');

    const objs = rowsToObjects(rows);
    console.log('📝 Interpretation headers detected:', objs[0]?.__headers || []);

    const K = {
      program: ['Program', 'Department', 'Program Name'],
      type: ['Language/Type', 'Type', 'Language'],
      eventName: ['Event name', 'Event', 'Title', 'Session'],
      eventDate: ['Event Date', 'Date'],
      eventTime: ['Event Time', 'Time'],
      interpreter: ['Interpreter', 'Assigned To'],
      status: ['Status'],
    };

    const interpretation = objs.map((r, idx) => ({
      id: idx + 1,
      program: pick(r, K.program),
      type: pick(r, K.type),
      eventName: pick(r, K.eventName),
      eventDate: pick(r, K.eventDate),
      eventTime: pick(r, K.eventTime),
      interpreter: pick(r, K.interpreter),
      status: pick(r, K.status),
    }));

    fs.writeFileSync(
      path.join(outDir, 'interpretation.json'),
      JSON.stringify(interpretation, null, 2)
    );
    console.log(
      `✅ Wrote site/interpretation.json (${interpretation.length} items) from tab "${usedTab}".`
    );
  } catch (e) {
    console.log('ℹ️ Interpretation skipped:', e.message);
  }
}

build().catch(err => {
  console.error('❌ Build error:', err);
  process.exit(1);
});
