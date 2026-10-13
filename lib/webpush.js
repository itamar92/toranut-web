/**
 * lib/webpush.js — Web Push בלי ספרייה: VAPID (RFC 8292) והצפנת aes128gcm (RFC 8291).
 * ===================================================================================
 * כל מה שצריך כדי לשלוח התראה לאפליקציה שבמסך הבית — באייפון (iOS 16.4 ומעלה, ורק
 * כשהיא נפתחת מהאייקון), באנדרואיד ובמחשב — בלי תלות ב-npm. Node נותן את כל החלקים:
 * ECDH על P-256, HKDF, AES-128-GCM וחתימת ES256. test/push.test.js בודק את ההצפנה
 * מול הדוגמה שב-RFC 8291 (נספח A), בית אחר בית.
 *
 * משתני סביבה (`npm run push keys` מייצר את שני הראשונים):
 *   VAPID_PUBLIC_KEY   הנקודה הציבורית, 65 בתים לא דחוסים, ב-base64url — גם הדפדפן מקבל אותה
 *   VAPID_PRIVATE_KEY  הסקלר הפרטי, 32 בתים, ב-base64url
 *   VAPID_SUBJECT      אופציונלי: mailto: או https: — ברירת המחדל היא כתובת האתר
 * זה הפורמט של ספריית web-push, כך שמפתחות עוברים בין השתיים בלי להנפיק מחדש.
 * הכול אופציונלי: בלי המפתחות enabled() שקר, והתכונה כבויה בשקט.
 *
 * **SSRF.** כתובת המנוי (endpoint) מגיעה מהדפדפן, והשרת שולח אליה POST. לכן היא
 * מתקבלת רק ב-https ורק לשירותי ה-push של הדפדפנים (PUSH_HOSTS) — לא לכל כתובת.
 *
 * **החלפת מפתחות** מבטלת את כל המנויים: הם נחתמו מול המפתח הציבורי הישן, ושירות
 * ה-push ידחה את השליחה. כל מכשיר יופעל מחדש ("איך זה עובד" ← התראות).
 *
 * מועתק מ-Platoon-web כמו שהוא. הצנרת של תורנויות (למי שולחים) — lib/push.js.
 */
const crypto = require('crypto');

const S = v => String(v == null ? '' : v).trim();
const RS = 4096;                                  // גודל הרשומה בכותרת. הודעה אחת = רשומה אחת
// שירותי ה-push מקבלים עד 4096 בתים בגוף: פחות 86 של הכותרת, 16 של תג ה-GCM ובית המפריד
const MAX_PLAIN = 4096 - 86 - 16 - 1;
const JWT_TTL = 12 * 3600;                        // שניות. אפל דוחה exp רחוק מיממה
const JWT_REUSE = 3600000;                        // אותו JWT לשעה — לא חותמים מחדש לכל הודעה
const TIMEOUT_MS = 10000;

/** Chrome / Edge-על-אנדרואיד / Samsung / Opera (FCM), Safari ו-iOS, Firefox, Edge במחשב */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

function b64u(buf){ return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') }
function unb64u(s){ return Buffer.from(S(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64') }

/* ============================ המפתחות ============================ */

let keyCache = { src: null, ok: false, priv: null };
/** המפתחות מהסביבה, בדוקים: הציבורי באורך הנכון, והפרטי באמת מייצר אותו. נבדק פעם אחת לכל ערך */
function keys(){
  const pub = S(process.env.VAPID_PUBLIC_KEY), d = S(process.env.VAPID_PRIVATE_KEY), src = pub + '|' + d;
  if (keyCache.src === src) return keyCache;
  keyCache = { src, ok: false, priv: null };
  if (!pub || !d) return keyCache;
  try {
    const P = unb64u(pub), D = unb64u(d);
    if (P.length !== 65 || P[0] !== 4 || D.length !== 32) throw new Error('אורך לא נכון');
    const e = crypto.createECDH('prime256v1'); e.setPrivateKey(D);
    if (!e.getPublicKey().equals(P)) throw new Error('המפתח הפרטי לא שייך לציבורי');
    keyCache.priv = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(P.slice(1, 33)), y: b64u(P.slice(33)), d: b64u(D) } });
    keyCache.ok = true;
  } catch (e){ console.error('VAPID לא תקין:', e.message) }
  return keyCache;
}
function enabled(){ return keys().ok }
/** המפתח שהדפדפן מקבל ב-pushManager.subscribe. ריק כשהתכונה כבויה */
function publicKey(){ return enabled() ? S(process.env.VAPID_PUBLIC_KEY) : '' }

/** זוג מפתחות חדש — `npm run push keys` */
function generateKeys(){
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const j = privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(j.x), unb64u(j.y)])), privateKey: j.d };
}

/** ה-sub של ה-JWT: איך שירות ה-push פונה אלינו אם משהו משתבש. אפל דורשת mailto: או https: */
function subject(){
  const s = S(process.env.VAPID_SUBJECT);
  if (s) return s;
  const u = S(process.env.SITE_URL) || (S(process.env.VERCEL_PROJECT_PRODUCTION_URL) && 'https://' + S(process.env.VERCEL_PROJECT_PRODUCTION_URL));
  return /^https:\/\//.test(u) ? u.replace(/\/+$/, '') : 'mailto:admin@localhost';
}

const jwtCache = new Map();
/** JWT של VAPID לשירות push אחד (aud = ה-origin שלו), חתום ב-ES256 */
function jwt(aud, now){
  now = now || Date.now();
  const k = keys(), ck = aud + '|' + k.src, hit = jwtCache.get(ck);
  if (hit && now - hit.at < JWT_REUSE) return hit.t;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + JWT_TTL, sub: subject() }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: k.priv, dsaEncoding: 'ieee-p1363' });
  const t = head + '.' + body + '.' + b64u(sig);
  jwtCache.set(ck, { at: now, t });
  return t;
}

/* ============================ המנוי ============================ */

/**
 * מנוי מהדפדפן (PushSubscription.toJSON()) → {endpoint, keys: {p256dh, auth}} נקי, או חריגה.
 * זו הבדיקה היחידה בין מה שהדפדפן שלח לבין fetch של השרת — ולכן היא קפדנית.
 */
function cleanSub(sub){
  sub = sub || {};
  const endpoint = S(sub.endpoint), k = sub.keys || {};
  let u = null;
  try { u = new URL(endpoint) } catch (e){}
  if (!u || endpoint.length > 1000) throw new Error('המנוי שהדפדפן החזיר לא תקין');
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !PUSH_HOSTS.some(r => r.test(u.hostname)))
    throw new Error('שירות ההתראות של הדפדפן הזה לא מוכר (' + u.hostname + ')');
  const ua = unb64u(k.p256dh), auth = unb64u(k.auth);
  if (ua.length !== 65 || ua[0] !== 4 || auth.length !== 16) throw new Error('מפתחות המנוי לא תקינים');
  return { endpoint, keys: { p256dh: b64u(ua), auth: b64u(auth) } };
}
/** מזהה קצר למכשיר — לא חושף את הכתובת. גם הדפדפן מחשב אותו (crypto.subtle), כדי לדעת "זה המכשיר הזה" */
function tagOf(endpoint){ return crypto.createHash('sha256').update(S(endpoint)).digest('hex').slice(0, 16) }

/* ============================ ההצפנה ============================ */

function hkdf(salt, ikm, info, len){ return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len)) }

/**
 * RFC 8291: ECDH עם המפתח של הדפדפן → HKDF עם סוד ה-auth → CEK ו-NONCE → AES-128-GCM,
 * רשומה אחת עם המפריד 0x02. fixed = {salt, priv} — רק לבדיקה מול הדוגמה שב-RFC.
 */
function encrypt(p256dh, authSecret, plain, fixed){
  const ua = unb64u(p256dh), secret = unb64u(authSecret);
  const ecdh = crypto.createECDH('prime256v1');
  if (fixed && fixed.priv) ecdh.setPrivateKey(fixed.priv); else ecdh.generateKeys();
  const as = ecdh.getPublicKey();
  const salt = (fixed && fixed.salt) || crypto.randomBytes(16);
  const ikm = hkdf(secret, ecdh.computeSecret(ua), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(plain), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0); head.writeUInt32BE(RS, 16); head[20] = as.length;
  return Buffer.concat([head, as, body]);
}

/* ============================ השליחה ============================ */

/**
 * שולח התראה אחת. payload — אובייקט (נשלח כ-JSON) או מחרוזת.
 * opts: ttl בשניות (כמה זמן שירות ה-push מחזיק אותה כשהמכשיר כבוי), urgency.
 * חריגה עם status, ו-gone=true כשהמנוי כבר לא קיים (404/410) — הקורא מכבה את היעד.
 */
async function send(sub, payload, opts){
  opts = opts || {};
  if (!enabled()) throw new Error('התראות האפליקציה לא מוגדרות (VAPID)');
  const s = cleanSub(sub);
  const plain = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8');
  if (plain.length > MAX_PLAIN) throw new Error('ההתראה ארוכה מדי (' + plain.length + ' בתים)');
  const headers = {
    TTL: String(Math.max(0, Math.round(opts.ttl == null ? 86400 : opts.ttl))),
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    Authorization: 'vapid t=' + jwt(new URL(s.endpoint).origin) + ', k=' + publicKey()
  };
  if (opts.urgency) headers.Urgency = opts.urgency;
  let res;
  try { res = await fetch(s.endpoint, { method: 'POST', headers, body: encrypt(s.keys.p256dh, s.keys.auth, plain), signal: AbortSignal.timeout(TIMEOUT_MS) }) }
  catch (e){ throw Object.assign(new Error(e && e.name === 'TimeoutError' ? 'שירות ההתראות לא ענה' : 'push: ' + (e && e.message)), { status: 0 }) }
  if (res.status >= 200 && res.status < 300) return { status: res.status };
  const txt = await res.text().catch(() => '');
  throw Object.assign(new Error('push ' + res.status + (txt ? ': ' + txt.slice(0, 200) : '')), { status: res.status, gone: res.status === 404 || res.status === 410 });
}

module.exports = { enabled, publicKey, generateKeys, subject, jwt, cleanSub, tagOf, encrypt, send, b64u, unb64u, MAX_PLAIN, PUSH_HOSTS };
