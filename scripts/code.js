/**
 * scripts/code.js — קודי כניסה מהמסוף (אותו דבר אפשר מהאתר: הגדרות ← רופאים ← "קוד").
 *   node scripts/code.js "נועה ברק"      קוד אישי חדש לרופא/ה (לפי שם או id). מודפס פעם אחת, נשמר מגובב.
 *   node scripts/code.js --chief 482913  קוד צ׳יף בגיליון (settings.chief_code_hash) — אם לא רוצים CHIEF_CODE בסביבה
 */
require('./env');
const db = require('../lib/db');
const auth = require('../lib/auth');
(async () => {
  const a = process.argv.slice(2);
  if (a[0] === '--chief'){
    const code = String(a[1] || '').trim();
    if (code.length < 4) throw new Error('קוד צ׳יף: לפחות 4 תווים');
    await db.setSettings({ chief_code_hash: auth.hashCode(code) }, true);
    console.log('✔ קוד הצ׳יף נשמר בגיליון (מגובב).' + (process.env.CHIEF_CODE ? ' שימו לב: CHIEF_CODE בסביבה גובר עליו.' : ''));
    return;
  }
  const q = a.join(' ').trim();
  if (!q) throw new Error('למי? node scripts/code.js "<שם או id>"');
  const docs = (await db.readAll(['doctors'])).doctors;
  const d = docs.find(x => String(x.id) === q) || docs.find(x => String(x.name).trim() === q);
  if (!d) throw new Error('לא נמצא/ה: ' + q);
  const code = auth.newCode();
  await db.update('doctors', d.id, { login_code_hash: auth.hashCode(code) });
  await db.bump();
  console.log('✔ ' + d.name + ': ' + code + '   (לא נשמר גלוי — העבירו עכשיו)');
})().catch(e => { console.error('✖ ' + e.message); process.exit(1) });
