/**
 * scripts/setup.js — בונה את הטבלאות בגיליון ומזין נתוני התחלה (lib/bootstrap.js).
 * ----------------------------------------------------------------------------------
 *   node scripts/setup.js                 הגיליון מ-SHEET_ID
 *   node scripts/setup.js --sheet <id>    גיליון אחר
 *   node scripts/setup.js --reset         מוחק את כל הרשומות (משאיר כותרות) ומזין מחדש — זהירות!
 *
 * בטוח להריץ שוב ושוב: טבלה שקיימת לא נוצרת שוב, seed לא מוזן על טבלה שיש בה נתונים.
 */
require('./env');
const gs = require('../lib/gsheets');
const { bootstrapSheet } = require('../lib/bootstrap');

(async () => {
  const i = process.argv.indexOf('--sheet');
  const id = gs.sheetIdFrom(i > 0 ? process.argv[i + 1] : process.env.SHEET_ID);
  if (!id) throw new Error('חסר מזהה גיליון: SHEET_ID ב-.env או --sheet <id>');
  await bootstrapSheet(gs.client(id), { reset: process.argv.includes('--reset'), log: console.log });
  console.log('\nהגיליון מוכן. הבא: מוסיפים את הרופאים בטאב doctors (או מהאתר, בהגדרות), ומנפיקים קודים: node scripts/code.js');
})().catch(e => { console.error('\n✖ ' + e.message); process.exit(1) });
