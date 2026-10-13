/**
 * lib/push.js — התראות לטלפון: למי שהתקין/ה את האפליקציה במסך הבית והפעיל/ה בה התראות (טבלת push_subs).
 * ------------------------------------------------------------------------------------------------------
 * ההצפנה והשליחה עצמן — lib/webpush.js (מ-Platoon-web). כאן רק: לאילו מכשירים הולכת כל התראה, ומה מוצג בה.
 *
 * יעד (to): doctor_id — המכשירים של הרופא/ה; 'chief' — המכשירים של מי שצ׳יף עכשיו, וכניסות בקוד הצ׳יף;
 * 'all' — כולם. רופא/ה שהושבת/ה לא מקבל/ת. בלי מפתחות VAPID (פיתוח, בדיקות) — לא נשלח כלום, בשקט.
 * מכשיר ששירות ה-push אמר עליו שאיננו (404/410: האפליקציה נמחקה, ההרשאה בוטלה) — נמחק מהטבלה.
 * תקלה בשליחה לא מפילה את הפעולה שגרמה להתראה.
 */
const db = require('./db');
const auth = require('./auth');
const webpush = require('./webpush');
const S = db.S;

const TITLE = 'תורנויות רופאים';
const TTL = 3 * 86400;                         // התראה על חודש שנפתח רלוונטית גם אחרי יומיים שהטלפון כבוי

/** הטקסט של ההתראה → {title, body}: "בקשת החלפה: נועה · …" — הכותרת עד הנקודתיים. אחרת — שם האפליקציה */
function payloadOf(n){
  const t = S(n.text), i = t.indexOf(': ');
  const head = i > 0 && i <= 30 ? { title: t.slice(0, i), body: t.slice(i + 2) } : { title: TITLE, body: t };
  return { title: head.title, body: head.body.slice(0, 1400), url: S(n.url) || '/', tag: S(n.tag) || undefined };
}

/** האם המכשיר s מקבל התראה ליעד to */
function reaches(s, to, docs){
  const did = S(s.doctor_id), d = did ? docs[did] : null;
  if (did && (!d || !auth.active(d))) return false;
  if (to === 'all') return true;
  if (to === 'chief') return did ? S(d.role) === 'chief' : S(s.role) === 'chief';
  return !!did && did === to;
}

/**
 * שולח את ההתראות (שורות {to, text, url?, tag?}) לכל המכשירים שלהן. t — טבלאות שכבר נקראו
 * ({push_subs, doctors}); בלי — נקראות כאן. מחזיר {sent, failed, gone}.
 */
async function send(list, t){
  const out = { sent: 0, failed: 0, gone: 0 };
  if (!webpush.enabled() || !list.length) return out;
  if (!t || !t.push_subs || !t.doctors) t = await db.readAll(['push_subs', 'doctors']);
  if (!t.push_subs.length) return out;
  const docs = {}; t.doctors.forEach(d => docs[S(d.id)] = d);
  const jobs = [];
  list.forEach(n => t.push_subs.forEach(s => { if (reaches(s, S(n.to), docs)) jobs.push({ s, n }) }));
  const gone = {};
  await Promise.all(jobs.map(j => webpush.send({ endpoint: S(j.s.endpoint), keys: { p256dh: S(j.s.p256dh), auth: S(j.s.auth) } }, payloadOf(j.n), { ttl: TTL })
    .then(() => { out.sent++ }, e => { if (e && e.gone) gone[S(j.s.id)] = 1; else { out.failed++; console.warn('push', S(j.s.id), e && e.message) } })));
  const ids = Object.keys(gone);
  out.gone = ids.length;
  if (ids.length) await db.removeMany('push_subs', ids).catch(e => console.warn('push cleanup', e.message));
  return out;
}

module.exports = { send, payloadOf, reaches, TITLE };
