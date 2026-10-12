/**
 * lib/db.js — שכבת הטבלאות, מעל lib/gsheets.js. מועתק מ-Platoon-web כמעט כמו שהוא.
 * ---------------------------------------------------------------------------------
 * הגיליון הוא ה-DB: כל טבלה = גיליון, כל רשומה = שורה, עמודה A = id.
 * החלפה עתידית ל-Postgres = כתיבה מחדש של הקובץ הזה בלבד.
 *
 * כאן יש גיליון אחד (SHEET_ID). forSheet / run נשארו מהמקור: הם מאפשרים לבדיקות ולשרת הפיתוח
 * להריץ את ה-API על מופע אחר, ו-lib/api.js לא יודע על זה כלום.
 */
const { AsyncLocalStorage } = require('async_hooks');
const gs = require('./gsheets');
const { TABLES, HIDDEN, newId } = require('./schema');

const SHEET_ID = process.env.SHEET_ID;
const als = new AsyncLocalStorage();
const instances = new Map();

/** מופע DB לגיליון אחד. נשמר במטמון לפי id — מטא־נתונים חמים בין בקשות באותו instance. */
function forSheet(sheetId){
  if (!sheetId) throw new Error('חסר מזהה גיליון');
  let inst = instances.get(sheetId);
  if (!inst){ inst = createInstance(sheetId); instances.set(sheetId, inst) }
  return inst;
}
/** מריץ fn כשכל קריאות ה-DB בתוכה פונות למופע הזה */
function run(inst, fn){ return als.run(inst, fn) }
/** המופע של ההקשר הנוכחי, או ברירת המחדל מהסביבה */
function current(){ return als.getStore() || forSheet(SHEET_ID) }

function createInstance(SHEET){
let api = null;
function sheet(){ if (!api) api = gs.client(SHEET); return api }

let metaCache = { at: 0, sheets: null };
async function meta(force){
  if (!force && metaCache.sheets && Date.now() - metaCache.at < 300000) return metaCache.sheets;
  metaCache = { at: Date.now(), sheets: (await sheet().meta()).sheets };
  return metaCache.sheets;
}
async function sheetId(name){
  let m = await meta(); if (!m[name]) m = await meta(true);
  if (!m[name] && TABLES[name]){ await ensureTables([name]); m = await meta() }
  if (!m[name]) throw new Error('הטבלה "' + name + '" לא קיימת — הריצו scripts/setup.js');
  return m[name].id;
}

/* ---- טבלה שחסרה בגיליון ---- */
/**
 * גיליון-טבלה שנוסף לסכימה אבל עוד לא נוצר בקובץ (לא הריצו setup) מפיל את כל הקריאה:
 * Sheets מחזיר "Unable to parse range" לבקשה כולה, וכל רענון באתר נכשל ב-400.
 * לכן: מזהים בדיוק את השגיאה הזו, יוצרים את הטבלאות החסרות של הסכימה, ומנסים שוב.
 */
function isMissingRange(e){ return /Unable to parse range/i.test(String(e && e.message || '')) }
async function ensureTables(names){
  const want = (names || []).filter(n => TABLES[n]);
  if (!want.length) return [];
  const m = await meta(true);
  const missing = want.filter(n => !m[n]);
  for (const n of missing){
    await sheet().ensureTable(n, TABLES[n], { hidden: HIDDEN.includes(n), rows: n === 'shifts' || n === 'log' ? 5000 : 1000 });
    console.warn('נוצרה טבלה חסרה בגיליון: ' + n);
  }
  if (missing.length) await meta(true);
  return missing;
}
/**
 * עמודה שנוספה לסכימה וחסרה בכותרת של גיליון קיים לא מפילה כלום — היא פשוט נעלמת בקריאה,
 * וכתיבה נוחתת מתחת לכותרת ריקה. משלימים אותה פעם אחת לכל טבלה (ensureTable מוסיף בסוף).
 */
const fixedHeader = {};
async function fixHeader(name, header){
  if (fixedHeader[name] || !TABLES[name] || !header.length) return;
  if (!TABLES[name].some(c => header.indexOf(c) < 0)) return;
  fixedHeader[name] = 1;
  try { await sheet().ensureTable(name, TABLES[name], { hidden: HIDDEN.includes(name) }); console.warn('הושלמו עמודות חסרות בטבלה ' + name) }
  catch (e){ console.error('header fix failed', name, e.message) }
}
/** מריץ פעולה על טבלאות; אם הן חסרות בגיליון — יוצר אותן ומנסה שוב פעם אחת */
async function withTables(names, fn){
  try { return await fn() }
  catch (e){
    if (!isMissingRange(e)) throw e;
    if (!(await ensureTables(names)).length) throw e;
    return fn();
  }
}

/** הופך שורות גולמיות לאובייקטים לפי כותרת השורה הראשונה */
function parseTable(name, values){
  const header = (values[0] || []).map(String), out = [];
  for (let i = 1; i < values.length; i++){
    const r = values[i]; if (!r || !r.some(x => x !== '' && x !== undefined)) continue;
    const o = {};
    header.forEach((h, c) => { o[h] = r[c] === undefined ? '' : r[c] });
    if (name !== 'settings' && name !== 'log' && !S(o.id)) continue;
    out.push(o);
  }
  return out;
}

/* ---- גרסה ויומן ---- */
async function settingsRows(){ const v = await sheet().getRaw(gs.q('settings') + '!A1:B'); return v }
async function getSetting(key){ const v = await settingsRows(); for (let i = 1; i < v.length; i++) if (S(v[i][0]) === key) return { value: v[i][1] === undefined ? '' : v[i][1], row: i + 1 }; return null }
/** כל ההגדרות במפה אחת, בקריאה אחת */
async function getSettings(){ const v = await settingsRows(), o = {}; for (let i = 1; i < v.length; i++){ const k = S(v[i][0]); if (k && o[k] === undefined) o[k] = v[i][1] === undefined ? '' : v[i][1] } return o }
/**
 * כתיבה של כמה הגדרות בקריאה אחת וכתיבה אחת. bump=true מקדם גם את version מתוך אותה קריאה.
 * מפתח שאינו קיים בגיליון נוסף בסופו. מחזיר את מה שנכתב בפועל.
 */
async function setSettings(map, bump){
  const v = await settingsRows();
  const at = {};
  for (let i = 1; i < v.length; i++){ const k = S(v[i][0]); if (k && at[k] === undefined) at[k] = i + 1 }
  const vals = Object.assign({}, map || {});
  if (bump) vals.version = (Number(at.version ? v[at.version - 1][1] : 0) || 0) + 1;
  const keys = Object.keys(vals);
  if (!keys.length) return vals;
  const data = [], add = [];
  keys.forEach(k => {
    const val = vals[k] === null || vals[k] === undefined ? '' : vals[k];
    if (at[k]) data.push({ range: gs.a1('settings', at[k], 2, 1, 1), values: [[val]] });
    else add.push([k, val]);
  });
  if (data.length) await sheet().batchSet(data);
  if (add.length) await sheet().append(gs.q('settings') + '!A:A', add);
  return vals;
}
async function setSetting(key, value){ await setSettings({ [key]: value }) }
async function bump(){ try { return (await setSettings({}, true)).version } catch (e) { return 0 } }
async function log(env, action, entity, entityId, before, after){
  try {
    const at = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
    await sheet().append(gs.q('log') + '!A:A', [[at, env.who || '—', env.role, action, entity, S(entityId), S(before).slice(0, 500), S(after).slice(0, 500)]]);
  } catch (e) { console.error('log failed', e.message) }
}

/* ---- כתיבה ---- */
async function rowOf(table, id){
  const ids = await withTables([table], () => sheet().colValues(table, 'A'));
  const i = ids.findIndex(v => S(v) === S(id));
  return i < 0 ? -1 : i + 2;
}
function toRow(table, obj){ return TABLES[table].map(h => { const v = obj[h]; return v === undefined || v === null ? '' : v }) }

async function insert(table, objs){
  if (!TABLES[table]) throw new Error('טבלה לא מוכרת: ' + table);
  objs.forEach(o => { if (!S(o.id) && TABLES[table].includes('id')) o.id = newId(table.slice(0, 3)) });
  await withTables([table], () => sheet().insert(table, TABLES[table], objs));
  return objs;
}
async function update(table, id, patch){
  const row = await rowOf(table, id);
  if (row < 0) throw new Error('רשומה לא נמצאה: ' + table + '/' + id);
  const cols = TABLES[table], data = [];
  Object.keys(patch).forEach(k => { const c = cols.indexOf(k); if (c > 0) data.push({ range: gs.a1(table, row, c + 1, 1, 1), values: [[patch[k] === null || patch[k] === undefined ? '' : patch[k]]] }) });
  await sheet().batchSet(data);
  return row;
}
async function remove(table, id){
  const row = await rowOf(table, id);
  if (row < 0) return false;
  await sheet().deleteRow(table, row, await sheetId(table));
  return true;
}
/** מחיקת כמה רשומות בבקשה אחת. מוחקים מלמטה למעלה כדי שהשורות לא יזוזו. */
async function removeMany(table, ids){
  const want = {}; (ids || []).forEach(i => { if (S(i)) want[S(i)] = 1 });
  if (!Object.keys(want).length) return 0;
  const col = await withTables([table], () => sheet().colValues(table, 'A'));
  const rows = [];
  col.forEach((v, i) => { if (want[S(v)]) rows.push(i + 2) });
  if (!rows.length) return 0;
  const sid = await sheetId(table);
  rows.sort((a, b) => b - a);
  await sheet().batchUpdate(rows.map(r => ({ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } })));
  return rows.length;
}
/** עדכון כמה רשומות בבקשה אחת. patches = [{id, patch}] */
async function updateMany(table, patches){
  const list = (patches || []).filter(p => p && S(p.id));
  if (!list.length) return 0;
  const col = await withTables([table], () => sheet().colValues(table, 'A'));
  const rowOfId = {}; col.forEach((v, i) => { if (S(v)) rowOfId[S(v)] = i + 2 });
  const cols = TABLES[table], data = [];
  let n = 0;
  list.forEach(p => {
    const row = rowOfId[S(p.id)]; if (!row) return;
    n++;
    Object.keys(p.patch).forEach(k => { const c = cols.indexOf(k); if (c > 0) data.push({ range: gs.a1(table, row, c + 1, 1, 1), values: [[p.patch[k] === null || p.patch[k] === undefined ? '' : p.patch[k]]] }) });
  });
  await sheet().batchSet(data);
  return n;
}
/** מוחק את כל הרשומות של טבלה ומשאיר את שורת הכותרות — בקשה אחת, לא שורה-שורה. */
async function clearTable(table){
  if (!TABLES[table]) throw new Error('טבלה לא מוכרת: ' + table);
  await withTables([table], () => sheet().truncate(table));
  return true;
}
async function getById(table, id){
  const rows = (await readAll([table]))[table];
  return rows.find(r => S(r.id) === S(id)) || null;
}

/* ---- קריאה ---- */
async function readAll(names){
  // values:batchGet עם גיליונות שלמים — קריאה אחת
  const t = sheet();
  const j = await withTables(names, () => t.batchGetWhole(names));
  const out = {};
  names.forEach((n, i) => out[n] = parseTable(n, j[i]));
  await Promise.all(names.map((n, i) => fixHeader(n, (j[i][0] || []).map(String))));
  return out;
}

return { id: SHEET, sheet, meta, ensureTables, readAll, insert, update, updateMany, remove, removeMany, clearTable, getById, getSetting, getSettings, setSetting, setSettings, bump, log };
}

const S = v => String(v == null ? '' : v).trim();
const TRUE = v => v === true || String(v).toUpperCase() === 'TRUE';

/* הפונקציות המיוצאות פונות למופע של הבקשה הנוכחית. בדיקות ושרת הפיתוח דורסים אותן על המודול — וזה עדיין עובד. */
const METHODS = ['sheet', 'meta', 'ensureTables', 'readAll', 'insert', 'update', 'updateMany', 'remove', 'removeMany', 'clearTable', 'getById', 'getSetting', 'getSettings', 'setSetting', 'setSettings', 'bump', 'log'];
const exp = { forSheet, run, current, currentId: () => current().id, S, TRUE, SHEET_ID };
METHODS.forEach(m => { exp[m] = (...a) => current()[m](...a) });
module.exports = exp;
