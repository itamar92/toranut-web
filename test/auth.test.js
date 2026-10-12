/**
 * test/auth.test.js — cookie חתום, קודים מגובבים, כניסה בקוד, אימות Google (מול fetch מדומה) ו-api/login.
 *   node test/auth.test.js
 */
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
process.env.CHIEF_CODE = '';
const assert = require('assert');
const memdb = require('./memdb');
const auth = require('../lib/auth');
const F = require('./fixtures');

(async () => {
  /* ---- cookie ---- */
  const tok = auth.issue({ role: 'doctor', did: 'd1', ck: 'abc' });
  const s = auth.verify(tok);
  assert.deepEqual([s.role, s.did, s.ck], ['doctor', 'd1', 'abc']);
  assert.equal(auth.verify(tok.slice(0, -2) + 'xx'), null, 'חתימה מזויפת');
  const [p] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ role: 'chief', did: 'd1', exp: Date.now() + 1e6 })).toString('base64url');
  assert.equal(auth.verify(forged + '.' + tok.split('.')[1]), null, 'שינוי תפקיד בלי הסוד');
  assert.equal(auth.verify(Buffer.from(JSON.stringify({ role: 'admin', did: 'x', exp: Date.now() + 1e6 })).toString('base64url') + '.x'), null);
  assert.ok(p);
  assert.equal(auth.session({ headers: { cookie: 'a=1; ' + auth.COOKIE + '=' + tok } }).did, 'd1');
  assert.ok(auth.atLeast('chief', 'doctor') && !auth.atLeast('doctor', 'chief'));

  /* ---- קודים ---- */
  const h = auth.hashCode('123456');
  assert.ok(h.startsWith('scrypt$') && !h.includes('123456'));
  assert.equal(await auth.codeMatches(h, '123456'), true);
  assert.equal(await auth.codeMatches(h, ' 123456 '), true);
  assert.equal(await auth.codeMatches(h, '123457'), false);
  assert.equal(await auth.codeMatches('', ''), false);
  assert.equal(await auth.codeMatches('plain', 'plain'), true);
  assert.match(auth.newCode(), /^\d{6}$/);

  const docs = F.DOCTORS.map((d, i) => Object.assign({}, d, { login_code_hash: i < 3 ? auth.hashCode('10' + i + '0') : '' }));
  assert.equal((await auth.loginByCode('1010', docs, {})).did, 'd2');
  assert.equal((await auth.loginByCode('1020', docs, {})).role, 'chief', 'd3 מסומנת chief');
  assert.equal(await auth.loginByCode('9999', docs, {}), null);
  assert.equal(await auth.loginByCode('', docs, {}), null);
  docs[1].active = 'FALSE';
  assert.equal(await auth.loginByCode('1010', docs, {}), null, 'רופא/ה לא פעיל/ה');
  // קוד צ׳יף: מהגיליון (hash) או מהסביבה (גובר)
  const viaSheet = await auth.loginByCode('7777', docs, { chief_code_hash: auth.hashCode('7777') });
  assert.deepEqual([viaSheet.role, viaSheet.did], ['chief', 'd3']);
  process.env.CHIEF_CODE = '5555';
  assert.equal((await auth.loginByCode('5555', docs, {})).role, 'chief');
  assert.equal(await auth.loginByCode('7777', docs, { chief_code_hash: auth.hashCode('7777') }), null, 'CHIEF_CODE גובר על הגיליון');
  process.env.CHIEF_CODE = '';

  /* ---- Google ---- */
  const claims = o => Object.assign({ aud: process.env.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 600), email: 'Doctor1@Example.com', email_verified: 'true' }, o);
  let answer = claims(), seen = '';
  auth.fetch = async url => { seen = url; return { ok: answer !== null, json: async () => answer } };
  assert.equal(await auth.verifyGoogle('tok.en'), 'doctor1@example.com');
  assert.match(seen, /^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=tok\.en$/);
  answer = claims({ aud: 'other' }); await assert.rejects(auth.verifyGoogle('x'), /לא הונפק לאתר הזה/);
  answer = claims({ email_verified: 'false' }); await assert.rejects(auth.verifyGoogle('x'), /לא מאומת/);
  answer = claims({ iss: 'evil.com' }); await assert.rejects(auth.verifyGoogle('x'), /מנפיק/);
  answer = claims({ exp: '100' }); await assert.rejects(auth.verifyGoogle('x'), /פג תוקף/);
  answer = null; await assert.rejects(auth.verifyGoogle('x'), /לא אישר/);
  await assert.rejects(auth.verifyGoogle(''), /חסר אסימון/);
  assert.equal(auth.doctorByEmail(F.DOCTORS, ' DOCTOR3@example.com ').id, 'd3');
  assert.equal(auth.doctorByEmail(F.DOCTORS, 'nobody@example.com'), null);

  /* ---- api/login ---- */
  const mem = memdb.use({ doctors: F.DOCTORS.map((d, i) => Object.assign({}, d, { login_code_hash: i === 0 ? auth.hashCode('424242') : '' })) });
  const login = require('../api/login');
  const run = async (body, ip) => {
    const req = { method: 'POST', headers: { 'x-forwarded-for': ip || '1.1.1.1' }, body };
    const res = { headers: {}, setHeader(k, v){ this.headers[k] = v }, status(c){ this.code = c; return this }, json(o){ this.body = o; return this } };
    await login(req, res); return res;
  };
  answer = claims({ email: 'doctor3@example.com' });
  let r = await run({ credential: 'google-jwt' });
  assert.equal(r.code, 200); assert.deepEqual([r.body.role, r.body.did, r.body.name], ['chief', 'd3', 'מאיה כהן']);
  const c = auth.verify(String(r.headers['Set-Cookie']).split(';')[0].split('=')[1]);
  assert.deepEqual([c.role, c.did, c.ck], ['chief', 'd3', undefined], 'כניסת Google — בלי ck');
  answer = claims({ email: 'stranger@example.com' });
  r = await run({ credential: 'google-jwt' });
  assert.equal(r.code, 403); assert.match(r.body.error, /לא רשום ברשימת הרופאים/);
  r = await run({ code: '424242' });
  assert.equal(r.code, 200); assert.equal(r.body.did, 'd1'); assert.equal(r.body.role, 'doctor');
  r = await run({ code: '000000' }, '2.2.2.2');
  assert.equal(r.code, 401);
  for (let i = 0; i < 8; i++) await run({ code: '000000' }, '3.3.3.3');
  r = await run({ code: '424242' }, '3.3.3.3');
  assert.equal(r.code, 429, 'אחרי 8 ניסיונות שגויים — חסום');
  assert.ok(mem.m.doctors.length === 18);

  console.log('✔ auth: cookie חתום, קודים מגובבים, כניסה בקוד, קוד צ׳יף, Google, api/login והגבלת ניסיונות');
})().catch(e => { console.error('✖ ' + (e && e.stack || e)); process.exit(1) });
