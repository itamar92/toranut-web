/**
 * scripts/smoke.js — בדיקת חיבור מקומית לגיליון האמיתי, בלי Vercel: קורא snapshot כצ׳יף ומדפיס סיכום.
 *   node scripts/smoke.js
 */
require('./env');
const db = require('../lib/db');
const { snapshot } = require('../lib/api');
(async () => {
  const t0 = Date.now();
  const d = (await db.readAll(['doctors'])).doctors.find(x => String(x.role).trim() === 'chief');
  const s = await snapshot(d ? { role: 'chief', did: String(d.id) } : { role: 'chief', did: '', ck: require('../lib/auth').codePrint(process.env.CHIEF_CODE || '') });
  console.log('snapshot ב-' + (Date.now() - t0) + 'ms · גרסה ' + s.version + ' · צ׳יף: ' + s.me.name);
  Object.keys(s.tables).forEach(k => console.log('  ' + k.padEnd(18) + s.tables[k].rows.length));
  console.log('  גודל JSON: ' + Math.round(JSON.stringify(s).length / 1024) + ' KB');
})().catch(e => { console.error('✖ ' + e.message); process.exit(1) });
