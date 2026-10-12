/**
 * lib/bootstrap.js — הופך גיליון (ריק או קיים) לבסיס הנתונים של תורנויות רופאים.
 * --------------------------------------------------------------------------------
 * טבלאות עם כותרות, מחיקת הגיליון הריק שנוצר עם הקובץ, ו-seed לטבלאות ריקות (הגדרות, עמדות ברירת מחדל).
 * בטוח להריץ שוב ושוב: טבלה קיימת רק מקבלת עמודות חדשות, seed לא נכנס לטבלה שיש בה נתונים.
 */
const gs = require('./gsheets');
const { TABLES, HIDDEN, SEED } = require('./schema');

async function bootstrapSheet(api, opts){
  opts = opts || {};
  const log = opts.log || (() => {}), reset = !!opts.reset;
  const m = await api.meta();
  log('גיליון: ' + m.title);

  for (const name of Object.keys(TABLES)){
    const info = await api.ensureTable(name, TABLES[name], { hidden: HIDDEN.includes(name), rows: name === 'shifts' || name === 'log' ? 5000 : 1000 });
    if (info.isNew) log('  + נוצרה טבלה ' + name);
    if (info.added) log('  + עמודות חדשות ב' + name + ': ' + info.added.join(', '));
    if (reset && !info.isNew){ await api.truncate(name); log('  ✕ נוקתה ' + name) }
  }
  // הגיליון הראשון שנוצר עם הקובץ (Sheet1 / גיליון1) — מוחקים אם ריק
  const m2 = await api.meta();
  for (const t of Object.keys(m2.sheets)) if (!TABLES[t]){
    const v = await api.getRaw(gs.q(t) + '!A1:C3');
    if (!v.length){ await api.deleteSheet(t); log('  ✕ נמחק גיליון ריק ' + t) }
  }

  for (const name of Object.keys(SEED)){
    const cur = await api.rows(name);
    if (cur.rows.length){ log('  · ' + name + ' כבר מלא (' + cur.rows.length + ') — לא מזין seed'); continue }
    const header = TABLES[name];
    const objs = SEED[name].map(r => Array.isArray(r) ? Object.fromEntries(header.map((h, i) => [h, r[i] === undefined ? '' : r[i]])) : r);
    await api.insert(name, header, objs);
    log('  ✔ seed ' + name + ': ' + objs.length + ' שורות');
  }
  return { title: m.title };
}

module.exports = { bootstrapSheet };
