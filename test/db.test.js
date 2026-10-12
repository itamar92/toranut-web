/**
 * test/db.test.js — ריפוי עצמי של הגיליון, בלי רשת.
 * מדמה את lib/gsheets מול "קובץ" בזיכרון: טבלה שחסרה מפילה את הקריאה בדיוק כמו Sheets
 * ("Unable to parse range"), ואנחנו בודקים ש-lib/db יוצר אותה וממשיך.
 */
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'x'; process.env.GOOGLE_PRIVATE_KEY = 'x'; process.env.SHEET_ID = 'x';
const assert = require('assert');
const gs = require('../lib/gsheets');
const { TABLES } = require('../lib/schema');

// "קובץ" בזיכרון: שם גיליון → מטריצת ערכים (שורה 1 = כותרות)
const file = {
  settings: [['key', 'value'], ['version', 3]],
  doctors:  [['id', 'name'], ['d_1', 'נועה']]     // כותרת חלקית — חסרות עמודות של הסכימה
};
const created = [], headersFixed = [];
let calls = [];
gs.client = () => ({
  async meta(){ const sheets = {}; Object.keys(file).forEach((n, i) => sheets[n] = { id: i + 1, index: i, rows: 1000, cols: 26, cf: [] }); return { title: 'test', sheets } },
  async batchGetWhole(names){
    const bad = names.find(n => !file[n]);
    if (bad) throw new Error("Sheets API: Unable to parse range: '" + bad + "'");
    return names.map(n => file[n].map(r => r.slice()));
  },
  async colValues(name){ if (!file[name]) throw new Error("Sheets API: Unable to parse range: '" + name + "'"); return file[name].slice(1).map(r => r[0] === undefined ? '' : r[0]) },
  async insert(name, header, objs){
    if (!file[name]) throw new Error("Sheets API: Unable to parse range: '" + name + "'");
    objs.forEach(o => file[name].push(header.map(h => o[h] === undefined ? '' : o[h])));
  },
  async getRaw(range){
    calls.push('getRaw ' + range);
    const n = range.replace(/^'|'!.*$/g, '').replace(/'.*$/, '');
    if (!file[n]) throw new Error("Sheets API: Unable to parse range: '" + n + "'");
    return file[n].map(r => r.slice());
  },
  async batchSet(data){
    calls.push('batchSet ' + data.length);
    data.forEach(d => {
      const m = d.range.match(/^'(.+)'!([A-Z]+)(\d+)/);
      const n = m[1], col = m[2].charCodeAt(0) - 65, row = +m[3] - 1;
      while (file[n].length <= row) file[n].push([]);
      file[n][row][col] = d.values[0][0];
    });
  },
  async append(range, values){
    calls.push('append ' + values.length);
    const n = range.replace(/^'/, '').split('!')[0].replace(/'/g, '');
    values.forEach(v => file[n].push(v.slice()));
  },
  async truncate(name){
    calls.push('truncate ' + name);
    if (!file[name]) throw new Error("Sheets API: Unable to parse range: '" + name + "'");
    file[name] = [file[name][0]];
  },
  async ensureTable(name, columns){
    if (!file[name]){ file[name] = [columns.slice()]; created.push(name); return { id: 99, isNew: true } }
    const have = file[name][0].map(String), missing = columns.filter(c => have.indexOf(c) < 0);
    if (missing.length){ file[name][0] = have.concat(missing); headersFixed.push(name) }
    return { id: 1, added: missing };
  }
});
const db = require('../lib/db');

(async () => {
  // טבלה שחסרה בגיליון (constraints — נוספה לסכימה ולא הריצו setup): נוצרת, והקריאה מצליחה
  const t = await db.readAll(['settings', 'doctors', 'constraints']);
  assert.deepEqual(created, ['constraints']);
  assert.equal(t.doctors.length, 1);
  assert.deepEqual(t.constraints, []);
  assert.deepEqual(file.constraints[0], TABLES.constraints);

  // כותרת חסרת עמודות בטבלה קיימת — מושלמת פעם אחת, בלי להפיל את הקריאה
  assert.deepEqual(headersFixed, ['doctors']);
  assert.deepEqual(file.doctors[0], TABLES.doctors);
  await db.readAll(['doctors']);
  assert.deepEqual(headersFixed, ['doctors']);           // לא מנסה שוב ושוב

  // כתיבה לטבלה שנמחקה מהגיליון — נוצרת מחדש והרשומה נכנסת
  delete file.constraints;
  const [rec] = await db.insert('constraints', [{ id: 'd_1|2026-11-03', doctor_id: 'd_1', date: '2026-11-03', status: 'no' }]);
  assert.equal(rec.id, 'd_1|2026-11-03');
  assert.equal(file.constraints.length, 2);
  assert.equal((await db.readAll(['constraints'])).constraints[0].doctor_id, 'd_1');

  // ---- setSettings: כמה מפתחות + קידום גרסה בקריאה אחת ובכתיבה אחת ----
  file.settings.push(['reminder_days', 2], ['timezone', 'Asia/Jerusalem']);
  calls = [];
  const wrote = await db.setSettings({ reminder_days: 3, timezone: 'UTC' }, true);
  assert.deepEqual(calls, ['getRaw \'settings\'!A1:B', 'batchSet 3'], 'קריאה אחת וכתיבה אחת לשלושת הערכים');
  assert.equal(wrote.version, 4);                                    // 3 → 4
  const val = k => (file.settings.find(r => r[0] === k) || [])[1];
  assert.equal(val('reminder_days'), 3); assert.equal(val('timezone'), 'UTC'); assert.equal(val('version'), 4);

  // מפתח שאינו בגיליון — נוסף בסופו; בלי bump אין נגיעה ב-version
  calls = [];
  await db.setSettings({ 'reminded_2026-11': '2026-10-20' });
  assert.deepEqual(calls, ['getRaw \'settings\'!A1:B', 'append 1']);
  assert.equal(val('reminded_2026-11'), '2026-10-20'); assert.equal(val('version'), 4);

  // setSetting ו-bump בנויים מעליו — שתי בקשות כל אחד, לא שלוש
  calls = [];
  await db.setSetting('reminder_days', 1);
  assert.deepEqual(calls, ['getRaw \'settings\'!A1:B', 'batchSet 1']);
  assert.equal(val('reminder_days'), 1);
  calls = [];
  assert.equal(await db.bump(), 5);
  assert.deepEqual(calls, ['getRaw \'settings\'!A1:B', 'batchSet 1']);
  assert.equal(val('version'), 5);

  // ---- clearTable: מרוקן שורות ומשאיר את הכותרת ----
  assert.equal(await db.clearTable('doctors'), true);
  assert.equal(file.doctors.length, 1); assert.deepEqual(file.doctors[0], TABLES.doctors);
  await assert.rejects(db.clearTable('nope'), /טבלה לא מוכרת/);

  // שגיאה אחרת לא נבלעת ולא גוררת יצירת טבלאות
  db.sheet().batchGetWhole = async () => { throw new Error('Sheets API: quota exceeded') };
  await assert.rejects(db.readAll(['doctors']), /quota exceeded/);

  console.log('✔ db: ריפוי טבלה חסרה, השלמת כותרת, כתיבת הגדרות מרוכזת, ריקון טבלה, ושגיאה אמיתית עוברת הלאה');
})().catch(e => { console.error('✖ ' + (e && e.stack || e)); process.exit(1) });
