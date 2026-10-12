/**
 * test/env.test.js — קריאת .env (scripts/env.js) והמפתח של ה-Service Account (lib/gsheets.js keyOf).
 * המפתח מודבק בכל מיני צורות — שורה אחת עם \n, כמה שורות במירכאות (כמו ב-.env.example), CRLF של Windows —
 * וכולן צריכות לתת מפתח שאפשר לחתום בו. בלי זה: "error:1E08010C:DECODER routines::unsupported".
 */
const assert = require('assert');
const crypto = require('crypto');
const { parse } = require('../scripts/env');
const { keyOf } = require('../lib/gsheets');

const pem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
const signs = k => { crypto.createSign('RSA-SHA256').update('x').end().sign(k); return true };
const esc = pem.trim().replace(/\n/g, '\\n');

const forms = {
  'כמה שורות במירכאות כפולות (.env.example)': 'GOOGLE_PRIVATE_KEY="' + pem + '"\nNEXT=1\n',
  'כמה שורות, המירכאות נסגרות בשורת ה-END': 'GOOGLE_PRIVATE_KEY="' + pem.trim() + '"\nNEXT=1\n',
  'כמה שורות במירכאות בודדות': "GOOGLE_PRIVATE_KEY='" + pem + "'\nNEXT=1\n",
  'שורה אחת עם \\n במירכאות': 'GOOGLE_PRIVATE_KEY="' + esc + '\\n"\nNEXT=1\n',
  'שורה אחת עם \\n בלי מירכאות': 'GOOGLE_PRIVATE_KEY=' + esc + '\nNEXT=1\n',
  'Windows (CRLF)': ('GOOGLE_PRIVATE_KEY="' + pem + '"\nNEXT=1\n').replace(/\n/g, '\r\n'),
  'export ורווחים': '  export GOOGLE_PRIVATE_KEY = "' + pem + '"  \nNEXT=1\n'
};
Object.keys(forms).forEach(name => {
  const env = parse(forms[name]);
  assert.equal(env.NEXT, '1', name + ' — השורה שאחרי המפתח נקראת');
  const k = keyOf(env.GOOGLE_PRIVATE_KEY);
  assert.ok(/^-----BEGIN PRIVATE KEY-----\n/.test(k) && /\n-----END PRIVATE KEY-----\n$/.test(k), name + ': ' + JSON.stringify(k.slice(0, 40)));
  assert.ok(signs(k), name);
});
// כמו ב-Vercel: הערך ב-env עצמו, בלי קובץ — עם \n מילולי, או עם המירכאות שהודבקו איתו
assert.ok(signs(keyOf(esc)));
assert.ok(signs(keyOf('"' + esc + '"')));
assert.equal(keyOf(''), '');

// השאר כמו קודם
const e = parse('# הערה\nA=1\nB="two words"\nC=\'x\'\nD=\n  # עוד הערה\nE = spaced \n');
assert.deepEqual(e, { A: '1', B: 'two words', C: 'x', D: '', E: 'spaced' });
assert.throws(() => parse('K="לא נסגר\nעוד שורה\n'), /לא נסגרו/);
console.log('env: OK');
