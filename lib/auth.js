/**
 * lib/auth.js — כניסה (Google או קוד), cookie חתום, והגבלת ניסיונות. הבסיס מועתק מ-Platoon-web.
 * ---------------------------------------------------------------------------------------------
 * ה-cookie מכיל {role, did, ck, exp} וחתום ב-HMAC-SHA256 (SESSION_SECRET) — אי אפשר לזייף תפקיד או רופא/ה.
 *   role — doctor / chief.  did — מזהה הרופא/ה בטבלת doctors (צ׳יף שנכנס בקוד הצ׳יף — הרופא/ה שמסומן/ת chief).
 *   ck — טביעת אצבע של הקוד השמור, כשנכנסו בקוד: הנפקת קוד חדש לרופא/ה (או החלפת קוד הצ׳יף) מנתקת מכשירים
 *        שנכנסו בקוד הקודם. כניסת Google — ck ריק.
 *
 * דרכי כניסה (HANDOFF 3.6):
 *   Google  — ה-ID token (credential של Google Identity Services) מאומת מול Google, aud = GOOGLE_CLIENT_ID,
 *             email_verified, והמייל נמצא בעמודת email בטבלת doctors. לא ברשימה = לא נכנס.
 *   קוד     — קוד אישי (doctors.login_code_hash, scrypt) או קוד צ׳יף (CHIEF_CODE בסביבה, או settings.chief_code_hash).
 */
const crypto = require('crypto');

const COOKIE = 'tr_sess';
const SECRET = process.env.SESSION_SECRET || '';
const DAYS   = parseInt(process.env.SESSION_DAYS || '60', 10);

function b64u(s){ return Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }
function unb64u(s){ return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString() }
function hmac(s){ return crypto.createHmac('sha256', SECRET).update(s).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }

/** דירוג התפקידים — גדול יותר = יותר הרשאות. 0 = לא מוכר. */
const RANK = { doctor: 1, chief: 2 };
const ROLES = Object.keys(RANK);
function rank(role){ return RANK[String(role || '')] || 0 }
function atLeast(role, min){ return rank(role) >= rank(min) }

function safeEq(a, b){
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  if (A.length !== B.length){ crypto.timingSafeEqual(A, A); return false }
  return crypto.timingSafeEqual(A, B);
}

/* ---- קודים: מגובבים (scrypt$<salt>$<hash>) או גלויים (CHIEF_CODE מהסביבה) ---- */
const HASH_PREFIX = 'scrypt$';
const SCRYPT = { N: 16384, r: 8, p: 1 };
function hashCode(code){
  const salt = crypto.randomBytes(16).toString('hex');
  return HASH_PREFIX + salt + '$' + crypto.scryptSync(String(code).trim(), salt, 32, SCRYPT).toString('hex');
}
/** האם code תואם לערך השמור. אסינכרוני — scrypt רץ ב-threadpool, וכך בדיקה מול כל הרופאים רצה במקביל. ריק לעולם לא תואם. */
function codeMatches(stored, code){
  stored = String(stored || '').trim(); code = String(code || '').trim();
  if (!stored || !code) return Promise.resolve(false);
  if (!stored.startsWith(HASH_PREFIX)) return Promise.resolve(safeEq(code, stored));
  const parts = stored.slice(HASH_PREFIX.length).split('$');
  if (parts.length !== 2) return Promise.resolve(false);
  return new Promise(ok => crypto.scrypt(code, parts[0], 32, SCRYPT, (e, key) => ok(!e && safeEq(key.toString('hex'), parts[1]))));
}
/** טביעת אצבע של ערך שמור — נכנסת ל-cookie. לא מגלה את הקוד, ומשתנה בכל הנפקה. */
function codePrint(stored){ return crypto.createHash('sha256').update(String(stored == null ? '' : stored).trim()).digest('hex').slice(0, 16) }
/** קוד אישי חדש: 6 ספרות */
function newCode(){ return String(crypto.randomInt(0, 1000000)).padStart(6, '0') }

/**
 * מי נכנס בקוד הזה. doctors — שורות הטבלה (עם login_code_hash), settings — מפה.
 * מחזיר {role, did, ck} או null. קוד הצ׳יף נבדק קודם; אחריו הקודים האישיים של הרופאים הפעילים, במקביל.
 */
async function loginByCode(code, doctors, settings){
  code = String(code || '').trim();
  if (!code) return null;
  const chiefDoc = (doctors || []).find(d => String(d.role).trim() === 'chief' && active(d));
  const chiefStored = String(process.env.CHIEF_CODE || '').trim() || String((settings || {}).chief_code_hash || '').trim();
  if (chiefStored && await codeMatches(chiefStored, code)) return { role: 'chief', did: chiefDoc ? String(chiefDoc.id) : '', ck: codePrint(chiefStored) };
  const list = (doctors || []).filter(d => active(d) && String(d.login_code_hash || '').trim());
  const hits = await Promise.all(list.map(d => codeMatches(d.login_code_hash, code)));
  const i = hits.indexOf(true);
  if (i < 0) return null;
  const d = list[i];
  return { role: String(d.role).trim() === 'chief' ? 'chief' : 'doctor', did: String(d.id), ck: codePrint(d.login_code_hash) };
}
function active(d){ const v = d.active; if (v === false) return false; const s = String(v == null ? '' : v).trim().toUpperCase(); return s !== 'FALSE' && s !== '0' }

/* ---- Google ---- */
/**
 * מאמת ID token של Google מול נקודת tokeninfo של Google (חתימה, תוקף ו-iss נבדקים שם) ובודק aud ו-email_verified.
 * מחזיר את המייל באותיות קטנות, או זורק שגיאה עם הודעה לאדם.
 */
async function verifyGoogle(idToken){
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) throw new Error('כניסה עם Google לא מוגדרת (GOOGLE_CLIENT_ID)');
  idToken = String(idToken || '').trim();
  if (!idToken || idToken.length > 4096) throw new Error('חסר אסימון Google');
  const r = await auth.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
  if (!r.ok) throw new Error('Google לא אישר את הכניסה');
  const j = await r.json();
  if (String(j.aud) !== clientId) throw new Error('האסימון לא הונפק לאתר הזה');
  if (j.iss !== 'accounts.google.com' && j.iss !== 'https://accounts.google.com') throw new Error('מנפיק לא מוכר');
  if (Number(j.exp) * 1000 < Date.now()) throw new Error('פג תוקף הכניסה. נסו שוב.');
  if (!(j.email_verified === true || j.email_verified === 'true')) throw new Error('המייל בחשבון Google לא מאומת');
  return String(j.email || '').trim().toLowerCase();
}
/** הרופא/ה הפעיל/ה עם המייל הזה, או null */
function doctorByEmail(doctors, email){
  email = String(email || '').trim().toLowerCase();
  if (!email) return null;
  return (doctors || []).find(d => active(d) && String(d.email || '').trim().toLowerCase() === email) || null;
}

/* ---- cookie ---- */
function issue(o){
  if (!SECRET || SECRET.length < 16) throw new Error('SESSION_SECRET חסר או קצר מדי');
  const body = { role: o.role, did: String(o.did || '').slice(0, 40), exp: Date.now() + DAYS * 86400000, v: 1 };
  if (o.ck) body.ck = String(o.ck).slice(0, 32);
  const payload = b64u(JSON.stringify(body));
  return payload + '.' + hmac(payload);
}
function verify(tokenStr){
  if (!tokenStr || !SECRET) return null;
  const i = tokenStr.lastIndexOf('.');
  if (i < 0) return null;
  const payload = tokenStr.slice(0, i), sig = tokenStr.slice(i + 1);
  if (!safeEq(sig, hmac(payload))) return null;
  try {
    const o = JSON.parse(unb64u(payload));
    if (!o || !o.role || !o.exp || Date.now() > o.exp || !rank(o.role)) return null;
    return o;
  } catch (e) { return null }
}
function parseCookies(req){
  if (req.cookies) return req.cookies;
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function session(req){ return verify(parseCookies(req)[COOKIE]) }
function setCookie(res, value, maxAgeSec){
  const parts = [COOKIE + '=' + value, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + maxAgeSec];
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearCookie(res){ setCookie(res, '', 0) }

/* ---- הגבלת ניסיונות: בזיכרון של ה-instance. לא מושלם על serverless, אבל מייקר משמעותית ניחוש ---- */
const attempts = new Map();
const MAX_FAIL = 8, WINDOW = 15 * 60000;
function ipOf(req){
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0] : (req.socket && req.socket.remoteAddress) || '?').trim();
}
function blocked(ip){
  const a = attempts.get(ip);
  if (!a) return false;
  if (Date.now() - a.t0 > WINDOW){ attempts.delete(ip); return false }
  return a.n >= MAX_FAIL;
}
function fail(ip){
  const a = attempts.get(ip);
  if (!a || Date.now() - a.t0 > WINDOW) attempts.set(ip, { n: 1, t0: Date.now() });
  else a.n++;
}
function ok(ip){ attempts.delete(ip) }

const auth = { COOKIE, ROLES, RANK, rank, atLeast, safeEq, hashCode, codeMatches, codePrint, newCode, loginByCode, verifyGoogle, doctorByEmail, active,
               issue, verify, session, setCookie, clearCookie, ipOf, blocked, fail, ok,
               fetch: (...a) => fetch(...a) };          // נדרס בבדיקות
module.exports = auth;
