// scripts/build.js
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const fs = require('fs');

const ensureDir = (p) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };
const write = (p, s) => fs.writeFileSync(p, s);
const exists = (p) => fs.existsSync(p);

function parseCreds(raw) {
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT secret.');
  const c = JSON.parse(raw);
  if (c.private_key && c.private_key.includes('\\n')) c.private_key = c.private_key.replace(/\\n/g, '\n');
  return c;
}

async function getRows(auth, spreadsheetId, range) {
  const sheets = google.sheets({ version: 'v4', auth });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.data.values || [];
}

(async () => {
  const SHEET_ID = (process.env.GOOGLE_SHEET_ID || '').trim();
  if (!SHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID secret.');
  const creds = parseCreds(process.env.GOOGLE_SERVICE_ACCOUNT);

  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  ensureDir('src');

  // ===== TRANSLATIONS (Translations!A:G)
  let t = await getRows(auth, SHEET_ID, 'Translations!A:G');
  if (t.length && t[0].join(' ').toLowerCase().includes('document')) t = t.slice(1);

  const translations = t.map((r, i) => ({
    id: i + 1,
    dateRequested: (r[0] || '').trim(),
    program:       (r[1] || '').trim(),
    language:      (r[2] || '').trim(),
    title:         (r[3] || '').trim(), // Document Name
    deadline:      (r[4] || '').trim(),
    status:        (r[5] || 'Pending').trim(),
    link:          (r[6] || '').trim(),
  })).filter(d => d.program || d.title);

  write('src/translations.json', JSON.stringify(translations, null, 2));

  // ===== INTERPRETATION (Interpretation!A:G)
  let i = await getRows(auth, SHEET_ID, 'Interpretation!A:G');
  if (i.length && i[0].join(' ').toLowerCase().includes('event')) i = i.slice(1);

  const interp = i.map((r, n) => ({
    id: n + 1,
    program:      (r[0] || '').trim(),
    languageType: (r[1] || '').trim(),
    eventName:    (r[2] || '').trim(),
    eventDate:    (r[3] || '').trim(),
    eventTime:    (r[4] || '').trim(),
    interpreter:  (r[5] || '').trim(),
    status:       (r[6] || 'Pending').trim(),
  })).filter(d => d.program || d.eventName);

  write('src/interpretation.json', JSON.stringify(interp, null, 2));

  // Minimal pages (only created if not already in repo)
  if (!exists('src/index.html')) {
    write('src/index.html', `<!doctype html><meta charset="utf-8"><title>Translations</title>
<body style="font-family:system-ui;background:#0f172a;color:#e2e8f0;margin:0">
  <div style="max-width:1100px;margin:32px auto;padding:0 16px">
    <div><a href="./interpretation.html" style="color:#93c5fd;text-decoration:none">Go to Interpretation »</a></div>
    <h1>Translations Dashboard</h1>
    <div id="ts" style="color:#94a3b8"></div>
    <div style="margin:12px 0">
      Program <select id="program"></select>
      Status <select id="status"></select>
    </div>
    <div id="cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px"></div>
  </div>
<script>
(async function(){
  const res = await fetch('./translations.json',{cache:'no-store'}); const data = await res.json();
  document.getElementById('ts').textContent='Last updated: '+new Date().toLocaleString();
  const programs=['All',...new Set(data.map(d=>d.program).filter(Boolean)).values()];
  const statuses=['All',...new Set(data.map(d=>d.status).filter(Boolean)).values()];
  const pSel=document.getElementById('program'), sSel=document.getElementById('status');
  pSel.innerHTML=programs.map(x=>\`<option>\${x}</option>\`).join(''); sSel.innerHTML=statuses.map(x=>\`<option>\${x}</option>\`).join('');
  pSel.onchange=render; sSel.onchange=render;
  function render(){
    const p=pSel.value,s=sSel.value;
    const rows=data.filter(d=>(p==='All'||d.program===p)&&(s==='All'||d.status===s));
    document.getElementById('cards').innerHTML=rows.map(d=>\`
      <div style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:16px">
        <div style="display:flex;justify-content:space-between;">
          <div style="font-weight:600">\${d.title||'(Untitled)'}</div>
          <span style="border:1px solid rgba(255,255,255,.2);padding:2px 8px;border-radius:999px;font-size:12px">\${d.status||''}</span>
        </div>
        <div style="color:#94a3b8;margin:6px 0 10px">\${d.program||''} • \${d.language||''}</div>
        <div style="color:#94a3b8;font-size:13px">Requested: \${d.dateRequested||'—'} • Deadline: \${d.deadline||'—'}</div>
        \${d.link? \`<div style="margin-top:10px"><a href="\${d.link}" target="_blank" style="color:#93c5fd">Open file</a></div>\` : ''}
      </div>\`).join('');
  }
  render();
})();
</script></body>`);
  }

  if (!exists('src/interpretation.html')) {
    write('src/interpretation.html', `<!doctype html><meta charset="utf-8"><title>Interpretation</title>
<body style="font-family:system-ui;background:#0f172a;color:#e2e8f0;margin:0">
  <div style="max-width:1100px;margin:32px auto;padding:0 16px">
    <div><a href="./index.html" style="color:#93c5fd;text-decoration:none">« Back to Translations</a></div>
    <h1>Interpretation Dashboard</h1>
    <div id="ts" style="color:#94a3b8"></div>
    <div style="margin:12px 0">
      Program <select id="program"></select>
      Language/Type <select id="lang"></select>
      Status <select id="status"></select>
      Date on/after <input type="date" id="date"/>
      <button id="clear">Clear</button>
    </div>
    <div id="cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px"></div>
  </div>
<script>
(async function(){
  const res = await fetch('./interpretation.json',{cache:'no-store'}); const data = await res.json();
  document.getElementById('ts').textContent='Last updated: '+new Date().toLocaleString();
  const programs=['All',...new Set(data.map(d=>d.program).filter(Boolean)).values()];
  const langs=['All',...new Set(data.map(d=>d.languageType).filter(Boolean)).values()];
  const statuses=['All',...new Set(data.map(d=>d.status).filter(Boolean)).values()];
  const pSel=document.getElementById('program'), lSel=document.getElementById('lang'), sSel=document.getElementById('status'), dInp=document.getElementById('date');
  pSel.innerHTML=programs.map(x=>\`<option>\${x}</option>\`).join('');
  lSel.innerHTML=langs.map(x=>\`<option>\${x}</option>\`).join('');
  sSel.innerHTML=statuses.map(x=>\`<option>\${x}</option>\`).join('');
  document.getElementById('clear').onclick=()=>{pSel.value='All';lSel.value='All';sSel.value='All';dInp.value='';render();};
  pSel.onchange=render; lSel.onchange=render; sSel.onchange=render; dInp.onchange=render;
  function render(){
    const p=pSel.value, l=lSel.value, s=sSel.value, dv=dInp.value? new Date(dInp.value): null; if (dv) dv.setHours(0,0,0,0);
    const rows=data.filter(d=>(p==='All'||d.program===p)&&(l==='All'||d.languageType===l)&&(s==='All'||d.status===s)&&(!dv || (d.eventDate && new Date(d.eventDate)>=dv)));
    document.getElementById('cards').innerHTML=rows.map(d=>\`
      <div style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:16px">
        <div style="display:flex;justify-content:space-between;">
          <div style="font-weight:600">\${d.eventName||'(Untitled event)'}</div>
          <span style="border:1px solid rgba(255,255,255,.2);padding:2px 8px;border-radius:999px;font-size:12px">\${d.status||''}</span>
        </div>
        <div style="color:#94a3b8;margin:6px 0 10px">\${d.program||''} • \${d.languageType||''}</div>
        <div style="color:#94a3b8;font-size:13px">Date: \${d.eventDate||'—'} • Time: \${d.eventTime||'—'}</div>
        <div style="color:#94a3b8;margin-top:8px;font-size:13px">Interpreter: \${d.interpreter||'TBD'}</div>
      </div>\`).join('');
  }
  render();
})();
</script></body>`);
  }

  console.log('Build finished.');
})().catch(e => { console.error('Build error:', e?.response?.data || e?.stack || e); process.exit(1); });
