/**
 * test/memdb.js — DB בזיכרון במקום Google Sheets: דורס את הפונקציות של lib/db.js על המודול עצמו,
 * כך ש-lib/api.js רץ כמו שהוא. לבדיקות ולשרת הפיתוח.
 *   const mem = require('./memdb').use(data)   // data = {table: [rows]}; טבלה חסרה = ריקה
 */
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'x';
process.env.GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY || 'x';
process.env.SHEET_ID = process.env.SHEET_ID || 'mem';
const db = require('../lib/db');
const { TABLES, SEED } = require('../lib/schema');

const S = v => String(v == null ? '' : v);
const copy = r => Object.assign({}, r);

function fresh(data){
  const m = {};
  Object.keys(TABLES).forEach(t => m[t] = []);
  Object.keys(SEED).forEach(t => m[t] = SEED[t].map(r => Object.fromEntries(TABLES[t].map((h, i) => [h, r[i] === undefined ? '' : r[i]]))));
  Object.keys(data || {}).forEach(t => { m[t] = data[t].map(r => Object.fromEntries(TABLES[t].map(h => [h, r[h] === undefined ? '' : r[h]]))) });
  return m;
}

function use(data){
  const m = fresh(data);
  const calls = [];
  const set = (k, v) => { const r = m.settings.find(x => x.key === k); if (r) r.value = v; else m.settings.push({ key: k, value: v }) };
  Object.assign(db, {
    readAll: async names => { calls.push('readAll'); const o = {}; names.forEach(n => o[n] = (m[n] || []).filter(r => n === 'settings' || n === 'log' || S(r.id).trim()).map(copy)); return o },
    insert: async (t, objs) => { calls.push('insert ' + t); objs.forEach(o => m[t].push(Object.fromEntries(TABLES[t].map(h => [h, o[h] === undefined ? '' : o[h]])))); return objs },
    update: async (t, id, patch) => { const r = m[t].find(x => S(x.id) === S(id)); if (!r) throw new Error('רשומה לא נמצאה: ' + t + '/' + id); Object.keys(patch).forEach(k => { if (TABLES[t].includes(k) && k !== 'id') r[k] = patch[k] }); return 1 },
    updateMany: async (t, patches) => { calls.push('updateMany ' + t); let n = 0; (patches || []).forEach(p => { const r = m[t].find(x => S(x.id) === S(p.id)); if (r){ n++; Object.keys(p.patch).forEach(k => { if (TABLES[t].includes(k) && k !== 'id') r[k] = p.patch[k] }) } }); return n },
    remove: async (t, id) => { const i = m[t].findIndex(x => S(x.id) === S(id)); if (i < 0) return false; m[t].splice(i, 1); return true },
    removeMany: async (t, ids) => { calls.push('removeMany ' + t); const want = {}; (ids || []).forEach(i => want[S(i)] = 1); const n = m[t].length; m[t] = m[t].filter(x => !want[S(x.id)]); return n - m[t].length },
    clearTable: async t => { m[t] = []; return true },
    getById: async (t, id) => { const r = m[t].find(x => S(x.id) === S(id)); return r ? copy(r) : null },
    getSetting: async k => { const r = m.settings.find(x => x.key === k); return r ? { value: r.value } : null },
    getSettings: async () => { const o = {}; m.settings.forEach(r => { if (r.key && o[r.key] === undefined) o[r.key] = r.value }); return o },
    setSetting: async (k, v) => set(k, v),
    setSettings: async (map, bump) => {
      const vals = Object.assign({}, map || {});
      if (bump){ const r = m.settings.find(x => x.key === 'version'); vals.version = (Number(r && r.value) || 0) + 1 }
      Object.keys(vals).forEach(k => set(k, vals[k]));
      return vals;
    },
    bump: async () => { const r = m.settings.find(x => x.key === 'version'); const v = (Number(r && r.value) || 0) + 1; set('version', v); return v },
    log: async (env, action, entity, id, before, after) => { m.log.push({ at: new Date().toISOString(), who: env.who || '—', role: env.role, action, entity, entity_id: S(id), before: S(before), after: S(after) }) }
  });
  return { m, calls, version: () => Number((m.settings.find(x => x.key === 'version') || {}).value) || 0 };
}

module.exports = { use, fresh };
