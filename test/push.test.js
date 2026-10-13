/**
 * test/push.test.js — התראות לטלפון (Web Push): ההצפנה, VAPID, למי כל התראה מגיעה, וה-Service Worker.
 *   node test/push.test.js
 *
 * בלי רשת: ההצפנה נבדקת מול הדוגמה שב-RFC 8291 (נספח A) בית אחר בית ובפענוח עצמאי, והשליחה — מול
 * fetch מזויף שרושם את הבקשה ומפענח אותה כמו הדפדפן. חלקים 1–4 מ-Platoon-web (lib/webpush.js מועתק משם).
 */
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.CHIEF_CODE = '24680';
process.env.SITE_URL = 'https://toranut.example';

const assert = require('assert');
const crypto = require('crypto');
const webpush = require('../lib/webpush');

const KEYS = webpush.generateKeys();
process.env.VAPID_PUBLIC_KEY = KEYS.publicKey; process.env.VAPID_PRIVATE_KEY = KEYS.privateKey;
process.env.VAPID_SUBJECT = 'mailto:ops@toranut.example';

const { b64u, unb64u } = webpush;
function hkdf(salt, ikm, info, len){ return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len)) }
/** הצד של הדפדפן — פענוח לפי RFC 8291, נכתב כאן בנפרד מ-lib/webpush.js */
function decrypt(body, uaPriv, auth){
  const salt = body.slice(0, 16), rs = body.readUInt32BE(16), idlen = body[20];
  const as = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const e = crypto.createECDH('prime256v1'); e.setPrivateKey(uaPriv);
  const ua = e.getPublicKey();
  const ikm = hkdf(auth, e.computeSecret(as), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32);
  const d = crypto.createDecipheriv('aes-128-gcm', hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12));
  d.setAuthTag(ct.slice(-16));
  const pt = Buffer.concat([d.update(ct.slice(0, -16)), d.final()]);
  assert.equal(pt[pt.length - 1], 2, 'רשומה אחרונה מסתיימת במפריד 0x02');
  return { rs, text: pt.slice(0, -1).toString('utf8') };
}
/** מנוי אמיתי (מפתחות תקינים) של "דפדפן" — עם המפתח הפרטי, כדי לפענח מה שנשלח אליו */
function device(host){
  const e = crypto.createECDH('prime256v1'); e.generateKeys();
  const auth = crypto.randomBytes(16);
  return { priv: e.getPrivateKey(), auth, sub: { endpoint: 'https://' + (host || 'fcm.googleapis.com') + '/fcm/send/' + crypto.randomBytes(8).toString('hex'), keys: { p256dh: b64u(e.getPublicKey()), auth: b64u(auth) } } };
}

(async () => {

/* ======================================================================
   1. ההצפנה — בדיוק הדוגמה של RFC 8291, ופענוח עצמאי של שליחה רגילה
   ====================================================================== */
{
  const out = webpush.encrypt('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
    Buffer.from('When I grow up, I want to be a watermelon'), { salt: unb64u('DGv6ra1nlYgDCS1FRnbzlw'), priv: unb64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw') });
  assert.equal(b64u(out), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    'RFC 8291 נספח A — הגוף המוצפן, בית אחר בית');

  const dv = device();
  const msg = 'נובמבר 2026 נפתח לאילוצים — אפשר למלא עד יום שלישי 20.10';
  const a = webpush.encrypt(dv.sub.keys.p256dh, dv.sub.keys.auth, Buffer.from(msg));
  const b = webpush.encrypt(dv.sub.keys.p256dh, dv.sub.keys.auth, Buffer.from(msg));
  assert.notEqual(b64u(a), b64u(b), 'salt ומפתח זמני חדשים בכל הצפנה');
  const d = decrypt(a, dv.priv, dv.auth);
  assert.equal(d.text, msg, 'הדפדפן מפענח בדיוק את מה שנשלח, כולל עברית');
  assert.equal(d.rs, 4096);
  console.log('  ✓ ההצפנה — RFC 8291 בית אחר בית, ופענוח עצמאי');
}

/* ======================================================================
   2. VAPID — מפתחות שנבדקים, ו-JWT חתום ב-ES256 שאפשר לאמת
   ====================================================================== */
{
  assert.ok(webpush.enabled(), 'זוג מפתחות תקין');
  assert.equal(webpush.publicKey(), KEYS.publicKey);
  assert.equal(unb64u(KEYS.publicKey).length, 65); assert.equal(unb64u(KEYS.privateKey).length, 32);

  const other = webpush.generateKeys();
  process.env.VAPID_PRIVATE_KEY = other.privateKey;
  assert.equal(webpush.enabled(), false, 'מפתח פרטי שלא שייך לציבורי — כבוי, לא שליחה שתידחה');
  assert.equal(webpush.publicKey(), '');
  process.env.VAPID_PRIVATE_KEY = 'short';
  assert.equal(webpush.enabled(), false, 'מפתח באורך לא נכון');
  process.env.VAPID_PRIVATE_KEY = KEYS.privateKey;
  assert.ok(webpush.enabled());

  const now = Date.UTC(2026, 9, 12, 10);
  const t = webpush.jwt('https://web.push.apple.com', now);
  const [h, c, sig] = t.split('.');
  assert.deepEqual(JSON.parse(unb64u(h)), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(unb64u(c));
  assert.equal(claims.aud, 'https://web.push.apple.com', 'aud — ה-origin של שירות ה-push');
  assert.equal(claims.sub, 'mailto:ops@toranut.example');
  assert.ok(claims.exp > now / 1000 && claims.exp - now / 1000 <= 86400, 'אפל דוחה exp רחוק מיממה');
  const P = unb64u(KEYS.publicKey);
  const pub = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(P.slice(1, 33)), y: b64u(P.slice(33)) } });
  assert.ok(crypto.verify('sha256', Buffer.from(h + '.' + c), { key: pub, dsaEncoding: 'ieee-p1363' }, unb64u(sig)), 'החתימה מתאמתת מול המפתח הציבורי');
  assert.equal(webpush.jwt('https://web.push.apple.com', now + 60000), t, 'אותו JWT לשעה — לא חותמים לכל הודעה');
  assert.notEqual(webpush.jwt('https://fcm.googleapis.com', now), t, 'JWT נפרד לכל שירות');
  console.log('  ✓ VAPID — זוג מפתחות נבדק, JWT ב-ES256 עם aud/exp/sub');
}

/* ======================================================================
   3. המנוי מהדפדפן — רק שירותי push אמיתיים (SSRF), ומפתחות תקינים
   ====================================================================== */
{
  const keys = device().sub.keys;
  ['fcm.googleapis.com', 'web.push.apple.com', 'updates.push.services.mozilla.com', 'wns2-par02p.notify.windows.com'].forEach(host =>
    assert.equal(webpush.cleanSub({ endpoint: 'https://' + host + '/x/y', keys }).endpoint, 'https://' + host + '/x/y', host));
  const bad = ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://localhost/x', 'https://evil.example/fcm.googleapis.com',
               'https://fcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'not a url', ''];
  bad.forEach(ep => assert.throws(() => webpush.cleanSub({ endpoint: ep, keys }), undefined, 'נדחה: ' + ep));
  assert.throws(() => webpush.cleanSub({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: keys.p256dh, auth: 'AAAA' } }), /מפתחות/);
  assert.throws(() => webpush.cleanSub({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: b64u(Buffer.alloc(65)), auth: keys.auth } }), /מפתחות/);
  // base64 רגיל עם ריפוד (יש דפדפנים שמחזירים כך) — מתנרמל ל-base64url
  const std = Buffer.from(unb64u(keys.p256dh)).toString('base64');
  assert.equal(webpush.cleanSub({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: std, auth: keys.auth } }).keys.p256dh, keys.p256dh);
  assert.equal(webpush.tagOf('https://fcm.googleapis.com/x').length, 16);
  assert.equal(webpush.tagOf('https://fcm.googleapis.com/x'), crypto.createHash('sha256').update('https://fcm.googleapis.com/x').digest('hex').slice(0, 16), 'אותו גיבוב שהדפדפן מחשב');
  console.log('  ✓ המנוי — רק https לשירותי push מוכרים, מפתחות תקינים');
}

/* ======================================================================
   4. השליחה — הבקשה לשירות ה-push, ו-404/410 = המנוי איננו
   ====================================================================== */
{
  const realFetch = global.fetch, CAP = [];
  let status = 201;
  global.fetch = async (url, o) => { CAP.push({ url, o }); return { status, text: async () => status === 410 ? 'Unregistered' : '' } };
  const dv = device('web.push.apple.com');
  await webpush.send(dv.sub, { title: 'שלום', body: 'גוף' }, { ttl: 1800, urgency: 'high' });
  const req = CAP[0];
  assert.equal(req.url, dv.sub.endpoint);
  assert.equal(req.o.method, 'POST');
  assert.equal(req.o.headers.TTL, '1800');
  assert.equal(req.o.headers.Urgency, 'high');
  assert.equal(req.o.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(req.o.headers.Authorization), req.o.headers.Authorization);
  assert.ok(req.o.headers.Authorization.endsWith('k=' + KEYS.publicKey));
  assert.deepEqual(JSON.parse(decrypt(req.o.body, dv.priv, dv.auth).text), { title: 'שלום', body: 'גוף' }, 'הדפדפן מקבל את ה-JSON');

  status = 410;
  await assert.rejects(webpush.send(dv.sub, { title: 'x' }), e => e.gone === true && e.status === 410);
  status = 404;
  await assert.rejects(webpush.send(dv.sub, { title: 'x' }), e => e.gone === true);
  status = 500;
  await assert.rejects(webpush.send(dv.sub, { title: 'x' }), e => !e.gone && e.status === 500, '5xx — לא "איננו", ננסה שוב');
  status = 201;
  await assert.rejects(webpush.send(dv.sub, 'א'.repeat(2100)), /ארוכה מדי/, 'מעבר ל-4096 בתים — שירות ה-push ידחה');
  await assert.rejects(webpush.send({ endpoint: 'https://evil.example/x', keys: dv.sub.keys }, 'x'), /לא מוכר/);
  assert.equal(CAP.length, 4, 'ארוכה מדי, ומנוי לא מוכר — בלי בקשה בכלל');
  global.fetch = realFetch;
  console.log('  ✓ השליחה — כותרות, גוף מוצפן, 404/410 מסומנים "איננו"');
}
/* ======================================================================
   5. למי מגיעה כל התראה — pushOn / pushOff, snapshot, ו-notify של lib/api.js
   ====================================================================== */
{
  const memdb = require('./memdb');
  const F = require('./fixtures');
  const R = require('../lib/rules');
  const auth = require('../lib/auth');
  const push = require('../lib/push');
  const { keyOf } = require('../lib/schema');
  const { FNS, todayIso } = require('../lib/api');
  const call = (env, fn, ...a) => FNS[fn][0](Object.assign({}, env), ...a);
  const today = todayIso(), cur = R.monthOf(today), next = R.addMonths(cur, 1), curShift = cur + '-15';
  const mem = memdb.use({
    stations: F.STATIONS, doctors: F.DOCTORS.map(d => Object.assign({}, d)), qualifications: F.QUALIFICATIONS,
    months: [{ id: cur, month: cur, status: 'published', deadline: '', published_at: '2026-01-01T00:00:00Z' }],
    shifts: [{ id: keyOf(curShift, 'icu'), date: curShift, station_id: 'icu', doctor_id: 'd1', locked: false, note: '' }]
  });
  const D1 = { role: 'doctor', did: 'd1' }, D2 = { role: 'doctor', did: 'd2' }, CHIEF = { role: 'chief', did: 'd3' };
  const CODE = { role: 'chief', did: '', ck: auth.codePrint(process.env.CHIEF_CODE) };   // כניסה בקוד הצ׳יף, בלי רופא/ה

  const realFetch = global.fetch, CAP = [], STATUS = {};
  global.fetch = async (url, o) => { CAP.push({ url, o }); const s = STATUS[url] || 201; return { status: s, text: async () => '' } };
  const devs = { a: device(), b: device('web.push.apple.com'), c: device(), d: device() };
  const got = (dv, from) => CAP.slice(from || 0).filter(x => x.url === dv.sub.endpoint).map(x => JSON.parse(decrypt(x.o.body, dv.priv, dv.auth).text));

  // הפעלה: שורה ב-push_subs והתראת פתיחה למכשיר עצמו
  const on = await call(D1, 'pushOn', devs.a.sub);
  assert.equal(on.tag, webpush.tagOf(devs.a.sub.endpoint)); assert.equal(on.sent, true);
  assert.deepEqual(got(devs.a).map(p => p.title), ['ההתראות פעילות ✓']);
  const row = mem.m.push_subs.find(s => s.id === on.tag);
  assert.deepEqual([row.doctor_id, row.role, row.endpoint], ['d1', 'doctor', devs.a.sub.endpoint]);
  await call(CHIEF, 'pushOn', devs.b.sub);
  await call(CODE, 'pushOn', devs.c.sub);
  await call(D2, 'pushOn', devs.d.sub);
  assert.deepEqual(mem.m.push_subs.map(s => [s.doctor_id, s.role]), [['d1', 'doctor'], ['d3', 'chief'], ['', 'chief'], ['d2', 'doctor']]);
  // snapshot: המפתח הציבורי, ורק המכשירים שלי
  assert.equal((await call(D1, 'snapshot')).push.key, KEYS.publicKey);
  assert.deepEqual((await call(D1, 'snapshot')).push.tags, [on.tag]);
  assert.deepEqual((await call(CODE, 'snapshot')).push.tags, [webpush.tagOf(devs.c.sub.endpoint)]);
  // מנוי לא תקין — הודעה למשתמש, לא שורה
  await assert.rejects(call(D1, 'pushOn', { endpoint: 'https://evil.example/x', keys: devs.a.sub.keys }), e => e.user && /לא מוכר/.test(e.message));
  assert.equal(mem.m.push_subs.length, 4);

  // 'all' — כל המכשירים חוץ מרופא/ה שהושבת/ה. הכותרת, הגוף ויעד הלחיצה
  mem.m.doctors.find(d => d.id === 'd2').active = false;
  let from = CAP.length;
  await call(CHIEF, 'openMonth', next, R.addDays(next + '-01', -10));
  [devs.a, devs.b, devs.c].forEach(dv => {
    const p = got(dv, from);
    assert.equal(p.length, 1);
    assert.equal(p[0].title, 'תורנויות רופאים');
    assert.match(p[0].body, /נפתח לאילוצים/);
    assert.equal(p[0].url, '/?tab=mine&m=' + next);
  });
  assert.equal(got(devs.d, from).length, 0, 'רופא/ה שהושבת/ה לא מקבל/ת');
  assert.ok(mem.m.notifications.some(n => n.to === 'all' && /נפתח לאילוצים/.test(n.text)), 'נרשם ביומן');

  // 'chief' — מי שצ׳יף עכשיו וכניסת קוד הצ׳יף. הכותרת עד הנקודתיים
  from = CAP.length;
  await call(D1, 'requestSwap', curShift, 'icu', 'רועי מוכן');
  assert.equal(got(devs.a, from).length, 0);
  [devs.b, devs.c].forEach(dv => { const p = got(dv, from)[0]; assert.equal(p.title, 'בקשת החלפה'); assert.match(p.body, /^נועה ברק · יחידת טיפול נמרץ/); assert.equal(p.url, '/?tab=plan&m=' + cur) });

  // מכשיר שאיננו (410) — נמחק; תקלה אחרת (500) — נשאר, והפעולה לא נופלת
  STATUS[devs.a.sub.endpoint] = 410; STATUS[devs.b.sub.endpoint] = 500;
  const r = await push.send([{ to: 'all', text: 'בדיקה' }]);
  assert.deepEqual(r, { sent: 1, failed: 1, gone: 1 });
  assert.ok(!mem.m.push_subs.some(s => s.doctor_id === 'd1'), '410 — המכשיר נמחק');
  assert.ok(mem.m.push_subs.some(s => s.doctor_id === 'd3'), '500 — נשאר, ננסה בפעם הבאה');
  await call(CHIEF, 'closeMonth', next);
  await call(CHIEF, 'publish', next);                                  // שליחה שנכשלה לא מפילה את הפרסום
  assert.equal(mem.m.months.find(m => m.id === next).status, 'published');
  delete STATUS[devs.b.sub.endpoint];

  // כיבוי: רק המכשיר שלי (או לצ׳יף — כל מכשיר)
  await call(D1, 'pushOn', devs.a.sub);
  await assert.rejects(call(D1, 'pushOff', devs.b.sub.endpoint), /רשום למשתמש אחר/);
  await call(D1, 'pushOff', devs.a.sub.endpoint);
  await call(CHIEF, 'pushOff', devs.c.sub.endpoint);
  assert.deepEqual(mem.m.push_subs.map(s => s.doctor_id), ['d3', 'd2']);
  assert.deepEqual(await call(D1, 'pushOff', 'https://fcm.googleapis.com/fcm/send/none'), { off: true }, 'מכשיר לא מוכר — כבר כבוי');

  // הטקסט → כותרת וגוף
  assert.deepEqual(push.payloadOf({ text: 'תזכורת: האילוצים לנובמבר עוד לא נשלחו', url: '/?tab=mine' }), { title: 'תזכורת', body: 'האילוצים לנובמבר עוד לא נשלחו', url: '/?tab=mine', tag: undefined });
  assert.equal(push.payloadOf({ text: 'הלוח של נובמבר 2026 פורסם' }).title, 'תורנויות רופאים');

  // בלי מפתחות — כבוי בשקט, וההפעלה מסבירה למה
  process.env.VAPID_PRIVATE_KEY = 'short';
  from = CAP.length;
  assert.deepEqual(await push.send([{ to: 'all', text: 'x' }]), { sent: 0, failed: 0, gone: 0 });
  assert.equal(CAP.length, from);
  await assert.rejects(call(D1, 'pushOn', devs.a.sub), /לא הוגדרו בשרת/);
  assert.equal((await call(D1, 'snapshot')).push.key, '');
  process.env.VAPID_PRIVATE_KEY = KEYS.privateKey;
  global.fetch = realFetch;
  console.log('  ✓ היעדים — all / chief / רופא/ה, מושבת/ת לא מקבל/ת, 410 נמחק, כיבוי רק למכשיר שלי');
}

/* ======================================================================
   6. ה-Service Worker — public/sw.js עצמו, מול self/clients מזויפים
   ====================================================================== */
{
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const on = {}, shown = [], posted = [], opened = [];
  let windows = [];
  const self = {
    addEventListener: (t, fn) => { on[t] = fn },
    location: { origin: 'https://toranut.example' },
    registration: { showNotification: (t, o) => { shown.push([t, o]); return Promise.resolve() } },
    clients: { matchAll: () => Promise.resolve(windows), openWindow: u => { opened.push(u); return Promise.resolve() } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), { self, fetch: () => Promise.reject(new Error('offline')), URL, Promise, caches: {}, setTimeout, Response: function(){} });
  const fire = async (t, ev) => { let p = null; on[t](Object.assign({ waitUntil: x => { p = x } }, ev)); await p };

  await fire('push', { data: { json: () => ({ title: 'בקשת החלפה', body: 'נועה ברק · טנ״מ', url: '/?tab=plan&m=2026-11' }) } });
  assert.equal(shown[0][0], 'בקשת החלפה');
  assert.deepEqual([shown[0][1].body, shown[0][1].dir, shown[0][1].lang, shown[0][1].icon], ['נועה ברק · טנ״מ', 'rtl', 'he', '/icon-192.png']);
  assert.deepEqual(shown[0][1].data, { url: '/?tab=plan&m=2026-11' });
  await fire('push', { data: { json: () => { throw new Error('not json') }, text: () => 'טקסט גולמי' } });
  assert.equal(shown[1][0], 'טקסט גולמי', 'push שאינו JSON עדיין מציג התראה — Safari מבטל מנוי שמקבל push שקט');

  // לחיצה: אין חלון — נפתח על הקישור; יש — מובא קדימה ומקבל את הקישור בלי טעינה מחדש
  await fire('notificationclick', { notification: { close(){}, data: { url: '/?tab=mine&m=2026-11' } } });
  assert.deepEqual(opened, ['https://toranut.example/?tab=mine&m=2026-11']);
  windows = [{ url: 'https://toranut.example/', focus(){ return Promise.resolve(this) }, postMessage: m => posted.push(m) }];
  await fire('notificationclick', { notification: { close(){}, data: { url: '/?tab=board&m=2026-11' } } });
  assert.deepEqual(posted, [{ type: 'push-open', url: '/?tab=board&m=2026-11' }]);
  assert.equal(opened.length, 1, 'לא נפתח חלון נוסף');
  console.log('  ✓ ה-Service Worker — הצגה, ולחיצה שפותחת או מעבירה קישור');
}

console.log('✔ push: הצפנה (RFC 8291), VAPID, מנויים, יעדים, ניקוי מכשירים שאינם, Service Worker');
})().catch(e => { console.error(e); process.exit(1) });
