/**
 * lib/gsheets.js — Google Sheets API v4 דרך Service Account, בלי ספריות.
 * ----------------------------------------------------------------------
 * client(spreadsheetId) מחזיר אובייקט עם קריאות גולמיות ועם שכבת "טבלאות":
 * גיליון = טבלה, שורה 1 = כותרות, כל שורה = רשומה (אובייקט לפי הכותרות).
 */
const crypto = require('crypto');

const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
/**
 * המפתח הפרטי כמו שהוא מגיע מ-env, בכל הצורות שנתקלנו בהן: "\\n" מילולי (שורה אחת, כמו ב-Vercel),
 * ירידות שורה אמיתיות, סופי שורה של Windows, ומירכאות שנשארו מסביב.
 */
function keyOf(v){
  let k = String(v || '').trim();
  if (k.length > 1 && (k[0] === '"' || k[0] === "'") && k.endsWith(k[0])) k = k.slice(1, -1);
  return k.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim() + (k ? '\n' : '');
}
const SA_KEY   = keyOf(process.env.GOOGLE_PRIVATE_KEY);
let tok = { value: '', exp: 0 };

const b64url = b => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function token(){
  if (tok.value && Date.now() < tok.exp - 60000) return tok.value;
  if (!SA_EMAIL || !SA_KEY) throw new Error('חסרים GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY');
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64url(JSON.stringify({ iss: SA_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  let sig;
  try { sig = crypto.createSign('RSA-SHA256').update(h + '.' + c).end().sign(SA_KEY) }
  catch (e){
    throw new Error('GOOGLE_PRIVATE_KEY לא נקרא כמפתח (' + e.message + '). מעתיקים את private_key מקובץ ה-JSON של ה-Service Account כמו שהוא — ' +
      'בשורה אחת עם \\n, או במירכאות על כמה שורות — מ-"-----BEGIN PRIVATE KEY-----" ועד "-----END PRIVATE KEY-----"' +
      (/BEGIN PRIVATE KEY/.test(SA_KEY) && !/END PRIVATE KEY/.test(SA_KEY) ? '. כרגע נקרא רק ההתחלה שלו — חסר ה-END.' : '.'));
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + encodeURIComponent(h + '.' + c + '.' + b64url(sig))
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('כשל בקבלת טוקן מ-Google: ' + (j.error_description || j.error || r.status));
  tok = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tok.value;
}

function colA1(n){ let s = ''; while (n > 0){ const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const q = name => "'" + String(name).replace(/'/g, "''") + "'";
function a1(sheet, r0, c0, nRows, nCols){ return q(sheet) + '!' + colA1(c0) + r0 + ':' + colA1(c0 + nCols - 1) + (r0 + nRows - 1) }
function pad(values, rows, cols){
  const out = [];
  for (let r = 0; r < rows; r++){ const src = (values && values[r]) || [], row = []; for (let c = 0; c < cols; c++) row.push(src[c] === undefined ? '' : src[c]); out.push(row) }
  return out;
}
function hexRgb(hex){
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return { red: .87, green: .89, blue: .91 };
  return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 };
}
function rgbHex(c){ const f = x => ('0' + Math.round((x || 0) * 255).toString(16)).slice(-2); return '#' + f(c.red) + f(c.green) + f(c.blue) }

const EPOCH = Date.UTC(1899, 11, 30), DAYMS = 86400000;
function serialToIso(s){
  if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s); if (!isFinite(n) || n < 20000) return '';
  const d = new Date(EPOCH + Math.floor(n + 1e-9) * DAYMS);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function client(spreadsheetId){
  if (!spreadsheetId) throw new Error('חסר מזהה גיליון');
  const BASE = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId;

  async function call(method, path, body, query){
    const t = await token();
    let url = BASE + path;
    if (query){
      const qs = [];
      Object.keys(query).forEach(k => (Array.isArray(query[k]) ? query[k] : [query[k]]).forEach(v => qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v))));
      url += (url.includes('?') ? '&' : '?') + qs.join('&');
    }
    const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let j = {};
    try { j = text ? JSON.parse(text) : {} } catch (e) { j = { raw: text } }
    if (!r.ok){
      const msg = (j.error && j.error.message) || text || ('HTTP ' + r.status);
      if (r.status === 403 || r.status === 404) throw new Error('אין גישה לגיליון ' + spreadsheetId + ' — שתפו אותו עם ' + SA_EMAIL + '. (' + msg + ')');
      throw new Error('Sheets API: ' + msg);
    }
    return j;
  }

  /* ---- גולמי ---- */
  const api = {
    id: spreadsheetId,
    async meta(){
      const j = await call('GET', '', null, { fields: 'properties.title,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)),conditionalFormats)' });
      const sheets = {};
      (j.sheets || []).forEach(sh => { sheets[sh.properties.title] = { id: sh.properties.sheetId, index: sh.properties.index, rows: sh.properties.gridProperties.rowCount, cols: sh.properties.gridProperties.columnCount, cf: sh.conditionalFormats || [] } });
      return { title: j.properties.title, sheets };
    },
    async batchGet(specs){
      if (!specs.length) return [];
      const j = await call('GET', '/values:batchGet', null, { ranges: specs.map(s => s.range), valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
      return specs.map((s, i) => pad(j.valueRanges[i] && j.valueRanges[i].values, s.rows, s.cols));
    },
    /** גיליונות שלמים בקריאה אחת — מחזיר מערך של מטריצות גולמיות (לא מרופדות) */
    async batchGetWhole(names){
      if (!names.length) return [];
      const j = await call('GET', '/values:batchGet', null, { ranges: names.map(q), valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
      return names.map((n, i) => (j.valueRanges[i] && j.valueRanges[i].values) || []);
    },
    async getRaw(range){
      const j = await call('GET', '/values/' + encodeURIComponent(range), null, { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
      return j.values || [];
    },
    /** כתיבת טווחים. מחולק לחבילות כדי שייבוא גדול (אלפי תאים) לא ינסה בקשה אחת ענקית. */
    async batchSet(data){
      let out;
      for (let i = 0; i < data.length; i += 500) out = await call('POST', '/values:batchUpdate', { valueInputOption: 'RAW', data: data.slice(i, i + 500) });
      return out;
    },
    async set(range, values){ return api.batchSet([{ range, values }]) },
    async append(range, values){ if (values.length) return call('POST', '/values/' + encodeURIComponent(range) + ':append', { values }, { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }) },
    async clear(range){ return call('POST', '/values/' + encodeURIComponent(range) + ':clear', {}) },
    async batchUpdate(requests){ if (requests.length) return call('POST', ':batchUpdate', { requests }) },

    /* ---- טבלאות ---- */
    /** יוצר גיליון-טבלה עם כותרות, הקפאה, עיצוב. טבלה קיימת — רק משלימה עמודות חדשות של הסכימה, בסוף. */
    async ensureTable(name, columns, opts){
      opts = opts || {};
      const m = await api.meta();
      let info = m.sheets[name];
      if (!info){
        const res = await api.batchUpdate([{ addSheet: { properties: { title: name, hidden: !!opts.hidden, gridProperties: { rowCount: opts.rows || 1000, columnCount: Math.max(columns.length, 4), frozenRowCount: 1 } } } }]);
        info = { id: res.replies[0].addSheet.properties.sheetId, isNew: true };
        await api.set(a1(name, 1, 1, 1, columns.length), [columns]);
        await api.batchUpdate([
          { repeatCell: { range: { sheetId: info.id, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: hexRgb('#1E4B3B'), textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } },
          { repeatCell: { range: { sheetId: info.id, startRowIndex: 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } },
          { updateDimensionProperties: { range: { sheetId: info.id, dimension: 'COLUMNS', startIndex: 0, endIndex: columns.length }, properties: { pixelSize: 130 }, fields: 'pixelSize' } }
        ]);
      }
      else {
        // טבלה קיימת — משלימים עמודות שנוספו לסכימה. תמיד בסוף, כדי לא להזיז עמודות קיימות.
        const have = ((await api.getRaw(q(name) + '!1:1'))[0] || []).map(String);
        const missing = columns.filter(c => have.indexOf(c) < 0);
        if (missing.length){
          const at = have.length + 1, end = at + missing.length - 1;
          if (info.cols < end) await api.batchUpdate([{ appendDimension: { sheetId: info.id, dimension: 'COLUMNS', length: end - info.cols } }]);
          await api.set(a1(name, 1, at, 1, missing.length), [missing]);
          await api.batchUpdate([
            { repeatCell: { range: { sheetId: info.id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: at - 1, endColumnIndex: end }, cell: { userEnteredFormat: { backgroundColor: hexRgb('#1E4B3B'), textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } },
            { repeatCell: { range: { sheetId: info.id, startRowIndex: 1, startColumnIndex: at - 1, endColumnIndex: end }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } },
            { updateDimensionProperties: { range: { sheetId: info.id, dimension: 'COLUMNS', startIndex: at - 1, endIndex: end }, properties: { pixelSize: 130 }, fields: 'pixelSize' } }
          ]);
          info.added = missing;
        }
      }
      return info;
    },
    /** כל הרשומות של טבלה כאובייקטים */
    async rows(name){
      const v = await api.getRaw(q(name));
      if (!v.length) return { header: [], rows: [] };
      const header = v[0].map(String);
      const rows = [];
      for (let i = 1; i < v.length; i++){
        const r = v[i]; if (!r || !r.some(x => x !== '' && x !== undefined)) continue;
        const o = { _row: i + 1 };
        header.forEach((h, c) => { o[h] = r[c] === undefined ? '' : r[c] });
        rows.push(o);
      }
      return { header, rows };
    },
    /** מוסיף רשומות (אובייקטים לפי הכותרות) */
    async insert(name, header, objs){
      if (!objs.length) return;
      const vals = objs.map(o => header.map(h => { const v = o[h]; return v === undefined || v === null ? '' : (typeof v === 'boolean' ? v : v) }));
      for (let i = 0; i < vals.length; i += 2000) await api.append(q(name) + '!A:A', vals.slice(i, i + 2000));
    },
    /** מוחק את כל הרשומות (משאיר כותרות) */
    async truncate(name){ await api.clear(q(name) + '!A2:ZZ') },
    /** ערכי עמודה אחת (לפי אות), משורה 2 */
    async colValues(name, colLetter){ const v = await api.getRaw(q(name) + '!' + colLetter + '2:' + colLetter); return v.map(r => (r[0] === undefined ? '' : r[0])) },
    /** מוחק שורה פיזית (1-based) */
    async deleteRow(name, rowNumber, sheetId){ return api.batchUpdate([{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } } }]) },
    async deleteSheet(name){ const m = await api.meta(); if (m.sheets[name] && Object.keys(m.sheets).length > 1) await api.batchUpdate([{ deleteSheet: { sheetId: m.sheets[name].id } }]) }
  };
  return api;
}

/** מזהה גיליון מתוך קישור מלא או מזהה גולמי. '' אם לא נראה כמו מזהה. */
function sheetIdFrom(v){
  v = String(v || '').trim();
  const m = v.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(v) ? v : '';
}

module.exports = { keyOf, client, sheetIdFrom, colA1, a1, q, pad, hexRgb, rgbHex, serialToIso, SA_EMAIL };
