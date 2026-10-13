/**
 * lib/api.js — פונקציות השרת שהממשק קורא דרך /api/rpc {fn, args}.
 * ------------------------------------------------------------------
 * env = {role: 'doctor'|'chief', did, ck} — מה-cookie החתום (lib/auth.js). כל פונקציה קוראת את הטבלאות שהיא
 * צריכה בקריאה אחת (db.readAll), ובאותה קריאה מאמתת שהמשתמש עדיין בתוקף (ctx → principal): רופא/ה שהושבת/ה,
 * צ׳יף שהורד/ה מהתפקיד, או קוד שהוחלף — מקבלים 401 והממשק חוזר למסך הכניסה.
 *
 * הרשאות (HANDOFF סעיף 6):
 *   doctor — קורא snapshot (בלי קודים ופרטי קשר של אחרים, בלי אילוצים של אחרים, ורק לוחות שפורסמו),
 *            כותב רק את האילוצים של עצמו בחודש פתוח עד המועד (או מראש, בחודש עתידי שעוד לא נפתח),
 *            ואת האילוצים הקבועים של עצמו בכל זמן
 *            (הצ׳יף מקבל/ת התראה), שולח submission ובקשת החלפה.
 *   chief  — הכול.
 *
 * התראות: לטלפון בלבד (Web Push, lib/push.js), למי שהתקין/ה את האפליקציה במסך הבית והפעיל/ה התראות.
 * כל התראה נרשמת גם בטבלת notifications (יומן). url — לאן הלחיצה עליה פותחת (?tab=…&m=YYYY-MM).
 *
 * מחזור החודש: (אין שורה = טרם נפתח) → open (אילוצים) → scheduling (שיבוץ) → published.
 * פתיחה מחדש של לוח שפורסם מחזירה ל-scheduling; published_at נשאר, והרופאים ממשיכים לראות את הלוח בזמן העדכון.
 * לוח במצב published נעול לכל שינוי.
 */
const db = require('./db');
const R = require('./rules');
const auth = require('./auth');
const gs = require('./gsheets');
const push = require('./push');
const webpush = require('./webpush');
const { TABLES, COLORS, keyOf, newId } = require('./schema');
const S = db.S;

const ALL = ['settings', 'stations', 'doctors', 'qualifications', 'fixed_constraints', 'constraints', 'submissions', 'shifts', 'months', 'holidays', 'swap_requests', 'push_subs'];
const RULE_TABLES = ['stations', 'qualifications', 'fixed_constraints', 'constraints', 'shifts', 'holidays'];
const DATE_COLS = { constraints: ['date'], shifts: ['date'], holidays: ['date', 'id'], months: ['deadline'], swap_requests: ['date'] };
const STATUS_LABEL = { open: 'פתוח לאילוצים', scheduling: 'בשיבוץ', published: 'פורסם' };

/* ---------- עזרים ---------- */
/** שגיאה למשתמש (לא תקלה): user=true — rpc מחזיר את ההודעה ולא רושם stack */
function err(msg, status){ const e = new Error(msg); e.user = true; if (status) e.status = status; return e }
const uniq = a => a.filter((x, i) => a.indexOf(x) === i);
function nowIso(){ return new Date().toISOString() }
function todayIso(now){ return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now ? new Date(now) : new Date()) }
const fmtDay = iso => 'יום ' + R.WDFULL[R.weekday(iso)] + ' ' + R.fmtShort(iso);
const chiefStored = settings => S(process.env.CHIEF_CODE) || S(settings.chief_code_hash);

/** תאריך שהוקלד ידנית בגיליון ונשמר כמספר סידורי — חזרה ל-ISO */
function clean(t){
  Object.keys(DATE_COLS).forEach(n => { if (t[n]) t[n].forEach(r => DATE_COLS[n].forEach(c => { if (typeof r[c] === 'number') r[c] = gs.serialToIso(r[c]) })) });
  if (t.months) t.months.forEach(r => { r.id = S(r.id); r.month = S(r.month) || r.id; r.status = S(r.status) });
  return t;
}
function settingsOf(rows){ const o = {}; (rows || []).forEach(r => { const k = S(r.key); if (k && o[k] === undefined) o[k] = r.value }); return o }

/** קורא טבלאות ומאמת את המשתמש. מחזיר {t, settings, me} */
async function ctx(env, names){
  const t = clean(await db.readAll(uniq(['settings', 'doctors'].concat(names || []))));
  const settings = settingsOf(t.settings);
  const me = principal(env, t.doctors, settings);
  env.who = me.name;
  return { t, settings, me };
}
function principal(env, doctors, settings){
  const role = env && env.role;
  if (!auth.rank(role)) throw err('לא מחובר', 401);
  const doc = env.did ? doctors.find(d => S(d.id) === S(env.did)) : null;
  if (env.did && (!doc || !auth.active(doc))) throw err('המשתמש כבר לא פעיל ברשימת הרופאים', 401);
  const cs = chiefStored(settings);
  const viaChiefCode = !!env.ck && !!cs && env.ck === auth.codePrint(cs);
  if (role === 'chief' && !viaChiefCode){
    if (!doc || S(doc.role) !== 'chief') throw err('הרשאת הצ׳יף בוטלה — נדרשת כניסה מחדש', 401);
  }
  if (role === 'doctor' && !doc) throw err('לא מחובר', 401);
  if (env.ck && !viaChiefCode && (!doc || env.ck !== auth.codePrint(doc.login_code_hash))) throw err('הקוד הוחלף — נדרשת כניסה מחדש', 401);
  return { id: doc ? S(doc.id) : '', name: doc ? S(doc.name) : 'צ׳יף', chief: role === 'chief' };
}
const isChief = env => env.role === 'chief';

function monthRow(t, month){ return t.months.find(r => S(r.id) === month) || null }
/** האם הרופאים רואים את השיבוץ של החודש: פורסם, או נפתח מחדש לעדכון אחרי פרסום */
function visibleMonth(r){ return !!r && (r.status === 'published' || (r.status === 'scheduling' && !!S(r.published_at))) }
function needMonth(month){ if (!R.isMonth(month)) throw err('חודש לא תקין: ' + month); return month }
function needIso(d){ if (!R.isIso(d)) throw err('תאריך לא תקין: ' + d); return S(d) }
/** חודש שאפשר לשבץ בו (לא פורסם) */
function editable(t, month){
  const r = monthRow(t, month);
  if (r && r.status === 'published') throw err('הלוח של ' + R.monthLabel(month) + ' פורסם ונעול. לשינוי — "פתיחה מחדש לעריכה".');
  return r;
}
function stationOf(t, id){
  const s = t.stations.find(x => S(x.id) === S(id));
  if (!s || !R.truthy(s.active, true)) throw err('העמדה לא קיימת');
  return s;
}
const docName = (t, id) => { const d = t.doctors.find(x => S(x.id) === S(id)); return d ? S(d.name) : S(id) };
const stLabel = (t, id) => { const s = t.stations.find(x => S(x.id) === S(id)); return s ? S(s.name) : S(id) };

/** upsert לפי id: קיימים — updateMany (בקשה אחת), חדשים — insert. existing = השורות שנקראו */
async function upsertRows(table, existing, objs){
  if (!objs.length) return;
  const have = {}; existing.forEach(r => have[S(r.id)] = 1);
  const upd = [], ins = [];
  objs.forEach(o => { if (have[S(o.id)]){ const patch = Object.assign({}, o); delete patch.id; upd.push({ id: o.id, patch }) } else { ins.push(o); have[S(o.id)] = 1 } });
  if (upd.length) await db.updateMany(table, upd);
  if (ins.length) await db.insert(table, ins);
}
/** התראות {to, text, url?}: נרשמות ביומן ונשלחות לטלפונים (lib/push.js). שליחה שנכשלה לא מפילה את הפעולה */
async function notify(list){
  list = list.filter(n => n && n.to && n.text);
  if (!list.length) return;
  await db.insert('notifications', list.map(n => ({ id: newId('n'), to: n.to, text: n.text, at: nowIso(), read_by: '' })));
  await push.send(list).catch(e => console.warn('push', e.message));
}
const link = (tab, month) => '/?tab=' + tab + (month ? '&m=' + month : '');
/** סוף כל כתיבה: קידום הגרסה (הממשקים הפתוחים מתרעננים) ושורה ביומן — במקביל */
async function finish(env, action, entity, id, before, after){
  await Promise.all([db.bump(), db.log(env, action, entity, id, before === undefined ? '' : typeof before === 'string' ? before : JSON.stringify(before), after === undefined ? '' : typeof after === 'string' ? after : JSON.stringify(after))]);
}

/* ============================ קריאה ============================ */

const COLS = {
  doctorsChief: ['id', 'name', 'email', 'active', 'role', 'phone', 'has_code'],
  doctors: ['id', 'name', 'active', 'role']
};
function pack(rows, cols){ return { cols, rows: rows.map(r => cols.map(c => r[c] === undefined || r[c] === null ? '' : r[c])) } }

async function snapshot(env){
  const { t, settings, me } = await ctx(env, ALL);
  const chief = isChief(env), mine = r => S(r.doctor_id) === me.id;
  const shown = {};
  t.months.forEach(r => { if (chief || visibleMonth(r)) shown[r.id] = 1 });
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  const counts = {};
  t.submissions.forEach(r => { const m = S(r.month); counts[m] = (counts[m] || 0) + 1 });
  const tables = {
    stations: pack(t.stations, TABLES.stations),
    doctors: chief ? pack(t.doctors.map(d => Object.assign({}, d, { has_code: !!S(d.login_code_hash) })), COLS.doctorsChief) : pack(t.doctors, COLS.doctors),
    qualifications: pack(t.qualifications, TABLES.qualifications),
    fixed_constraints: pack(chief ? t.fixed_constraints : t.fixed_constraints.filter(mine), TABLES.fixed_constraints),
    constraints: pack(chief ? t.constraints : t.constraints.filter(mine), TABLES.constraints),
    submissions: pack(chief ? t.submissions : t.submissions.filter(mine), TABLES.submissions),
    shifts: pack(t.shifts.filter(r => shown[S(r.date).slice(0, 7)]), TABLES.shifts),
    months: pack(t.months, TABLES.months),
    holidays: pack(t.holidays, TABLES.holidays),
    swap_requests: pack(chief ? t.swap_requests.filter(r => S(r.status) === 'open' || S(r.created_at) >= since) : t.swap_requests.filter(mine), TABLES.swap_requests)
  };
  return {
    me: { role: env.role, did: me.id, name: me.name },
    // push.key — המפתח הציבורי ל-pushManager.subscribe ('' = לא מוגדר בשרת); tags — המכשירים שלי שמקבלים התראות
    push: { key: webpush.publicKey(), tags: t.push_subs.filter(s => ownSub(s, env, me)).map(s => S(s.id)) },
    tables, counts,
    settings: chief ? { reminder_days: settings.reminder_days, chief_code: !!chiefStored(settings), google: !!S(process.env.GOOGLE_CLIENT_ID) } : {},
    version: Number(settings.version) || 0, today: todayIso(), ts: Date.now()
  };
}
let pollCache = { at: 0, v: 0 };
async function poll(){
  // כמה מכשירים פתוחים בודקים גרסה — במטמון של ה-instance לכמה שניות, כדי לחסוך קריאות ל-Sheets
  if (Date.now() - pollCache.at > 8000){ const v = await db.getSetting('version'); pollCache = { at: Date.now(), v: Number(v && v.value) || 0 } }
  return { version: pollCache.v, ts: Date.now() };
}

/* ============================ רופא/ה ============================ */

/**
 * שמירת אילוצים לחודש. changes = {date: 'ok'|'no'|'prefer'} ('ok' = פנוי/ה, מוחק את השורה).
 * רופא/ה — רק לעצמו/ה: בחודש פתוח ועד המועד האחרון (כולל), או מראש — בחודש עתידי שעוד לא נפתח, עד R.AHEAD
 * חודשים קדימה (השליחה לצ׳יף — רק כשייפתח). צ׳יף — לכל רופא/ה (doctorId), בכל חודש שלא פורסם.
 * ימים עם אילוץ קבוע נעולים ומדולגים.
 */
async function saveConstraints(env, month, changes, doctorId){
  needMonth(month);
  const { t, me } = await ctx(env, ['months', 'constraints', 'fixed_constraints']);
  return writeConstraints(env, t, me, month, changes, doctorId);
}
async function writeConstraints(env, t, me, month, changes, doctorId){
  const chief = isChief(env);
  const who = chief && doctorId ? S(doctorId) : me.id;
  if (!who) throw err('אין רופא/ה מחובר/ת');
  if (!t.doctors.some(d => S(d.id) === who)) throw err('רופא/ה לא קיימ/ת');
  const r = monthRow(t, month);
  if (chief && doctorId){ if (r && r.status === 'published') throw err('הלוח של ' + R.monthLabel(month) + ' כבר פורסם') }
  else if (!r){
    const cur = R.monthOf(todayIso());
    if (month <= cur) throw err('החודש ' + R.monthLabel(month) + ' לא פתוח לאילוצים');
    if (month > R.addMonths(cur, R.AHEAD)) throw err('אפשר לסמן מראש עד ' + R.AHEAD + ' חודשים קדימה');
  } else {
    if (r.status !== 'open') throw err('החודש ' + R.monthLabel(month) + ' לא פתוח לאילוצים');
    if (S(r.deadline) && todayIso() > S(r.deadline)) throw err('המועד האחרון לאילוצים עבר (' + R.fmtShort(r.deadline) + '). לשינוי — פנו לצ׳יף.');
  }
  const fixedWd = {};
  t.fixed_constraints.forEach(f => { if (S(f.doctor_id) === who && (S(f.status) === 'no' || S(f.status) === 'prefer')) fixedWd[Number(f.weekday)] = 1 });
  const ups = [], dels = [], at = nowIso();
  Object.keys(changes || {}).forEach(date => {
    const v = S(changes[date]);
    if (!R.isIso(date) || R.monthOf(date) !== month) throw err('תאריך מחוץ לחודש: ' + date);
    if (v !== 'ok' && v !== 'no' && v !== 'prefer') throw err('מצב לא מוכר: ' + v);
    if (fixedWd[R.weekday(date)]) return;
    const id = keyOf(who, date);
    if (v === 'ok') dels.push(id); else ups.push({ id, doctor_id: who, date, status: v, updated_at: at });
  });
  const have = {}; t.constraints.forEach(c => have[S(c.id)] = 1);
  const delIds = dels.filter(id => have[id]);
  await upsertRows('constraints', t.constraints, ups);
  if (delIds.length) await db.removeMany('constraints', delIds);
  if (ups.length || delIds.length) await finish(env, 'constraints', 'constraints', who + '|' + month, '', JSON.stringify(changes).slice(0, 400));
  return { saved: ups.length + delIds.length };
}
/** שמירה ושליחה לצ׳יף: האילוצים (אם יש) + סימון submitted לחודש. אפשר לשלוח שוב עד המועד. */
async function submit(env, month, changes){
  needMonth(month);
  const { t, me } = await ctx(env, ['months', 'constraints', 'fixed_constraints', 'submissions']);
  if (!monthRow(t, month)) throw err(R.monthLabel(month) + ' עוד לא נפתח. מה שסימנת נשמר — שולחים לצ׳יף כשהחודש ייפתח.');
  await writeConstraints(env, t, me, month, changes || {}, '');
  const id = keyOf(me.id, month);
  await upsertRows('submissions', t.submissions, [{ id, doctor_id: me.id, month, submitted_at: nowIso() }]);
  await finish(env, 'submit', 'submissions', id);
  return { submitted: true };
}
/**
 * אילוצים קבועים לפי יום בשבוע. changes = {weekday: 'no'|'prefer'|''} ('' = מחיקה).
 * note — הערה אחת לכל הימים של הרופא/ה; null/undefined = כל יום שומר את ההערה שלו, ויום חדש מקבל את הקיימת.
 * רופא/ה — רק לעצמו/ה (doctorId מתעלמים), בכל זמן. הצ׳יף מקבל/ת התראה עם המצב החדש, ועם תורנויות
 * שכבר שובצו (מהיום והלאה) ונופלות על יום שנחסם עכשיו. צ׳יף — לכל רופא/ה, בלי התראה.
 */
async function saveFixed(env, changes, note, doctorId){
  const { t, me } = await ctx(env, ['fixed_constraints', 'shifts']);
  const chief = isChief(env), who = chief && doctorId ? S(doctorId) : me.id;
  if (!who) throw err('אין רופא/ה מחובר/ת');
  if (!t.doctors.some(d => S(d.id) === who)) throw err('רופא/ה לא קיימ/ת');
  const rows = t.fixed_constraints.filter(f => S(f.doctor_id) === who);
  const before = {};
  rows.forEach(f => { const s = S(f.status); if (s === 'no' || s === 'prefer') before[Number(f.weekday)] = s });
  const after = Object.assign({}, before);
  Object.keys(changes || {}).forEach(k => {
    const wd = Number(k), s = S(changes[k]);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) throw err('יום בשבוע לא תקין');
    if (s !== 'no' && s !== 'prefer' && s !== '') throw err('מצב לא מוכר: ' + s);
    if (s) after[wd] = s; else delete after[wd];
  });
  const keep = note === undefined || note === null, oldNote = rows.map(f => S(f.note)).find(Boolean) || '';
  const newNote = keep ? oldNote : S(note).slice(0, 80);
  const ups = [];
  Object.keys(after).forEach(k => {
    const wd = Number(k), id = keyOf(who, wd), cur = rows.find(f => S(f.id) === id);
    const row = { id, doctor_id: who, weekday: wd, status: after[wd], note: keep && cur ? S(cur.note) : newNote };
    if (!cur || S(cur.status) !== row.status || S(cur.note) !== row.note) ups.push(row);
  });
  const dels = rows.filter(f => !after[Number(f.weekday)]).map(f => S(f.id));
  if (!ups.length && !dels.length) return { changed: false };
  await upsertRows('fixed_constraints', t.fixed_constraints, ups);
  if (dels.length) await db.removeMany('fixed_constraints', dels);
  if (!chief){
    const today = todayIso(), wds = Object.keys(after).map(Number).sort();
    const clash = t.shifts.filter(s => S(s.doctor_id) === who && R.isIso(S(s.date)) && S(s.date) >= today && after[R.weekday(S(s.date))] === 'no' && before[R.weekday(S(s.date))] !== 'no')
      .map(s => S(s.date)).sort();
    await notify([{ to: 'chief', url: link('settings'), text: 'אילוצים קבועים: ' + me.name + ' · ' +
      (wds.length ? wds.map(wd => 'יום ' + R.WDFULL[wd] + ' ' + (after[wd] === 'no' ? 'לא יכול/ה' : 'מעדיף/ה שלא')).join(' · ') + (newNote ? ' ("' + newNote + '")' : '') : 'בלי אילוצים קבועים') +
      (clash.length ? ' · שימו לב: ' + (clash.length === 1 ? 'תורנות שכבר שובצה נופלת' : clash.length + ' תורנויות שכבר שובצו נופלות') + ' על יום חסום — ' + clash.slice(0, 6).map(R.fmtShort).join(', ') + (clash.length > 6 ? '…' : '') : '') }]);
  }
  await finish(env, 'fixed', 'fixed_constraints', who, before, after);
  return { changed: true };
}
/** בקשת החלפה: רק על תורנות שלי בלוח שהרופאים רואים. מגיעה לצ׳יף כהתראה; ההחלפה עצמה — רק הצ׳יף. */
async function requestSwap(env, date, stationId, note){
  needIso(date);
  const { t, me } = await ctx(env, ['shifts', 'months', 'stations', 'swap_requests']);
  if (!visibleMonth(monthRow(t, R.monthOf(date)))) throw err('הלוח של החודש הזה עוד לא פורסם');
  const sh = t.shifts.find(r => S(r.id) === keyOf(date, stationId));
  if (!sh || S(sh.doctor_id) !== me.id) throw err('זו לא התורנות שלך');
  note = S(note).slice(0, 300);
  const open = t.swap_requests.find(r => S(r.doctor_id) === me.id && S(r.date) === date && S(r.station_id) === S(stationId) && S(r.status) === 'open');
  const row = open ? Object.assign({}, open, { note }) : { id: newId('sw'), doctor_id: me.id, date, station_id: S(stationId), note, status: 'open', created_at: nowIso() };
  await upsertRows('swap_requests', t.swap_requests, [row]);
  await notify([{ to: 'chief', url: link('plan', R.monthOf(date)), text: 'בקשת החלפה: ' + me.name + ' · ' + stLabel(t, stationId) + ' · ' + fmtDay(date) + (note ? ' · "' + note + '"' : '') }]);
  await finish(env, 'swap_request', 'swap_requests', row.id, '', note);
  return { id: row.id };
}
/* ============================ התראות לטלפון ============================ */

/** המכשיר s שייך למשתמש הזה: אותו/ה רופא/ה, או — בכניסה בקוד הצ׳יף בלי רופא/ה — מכשיר צ׳יף בלי רופא/ה */
function ownSub(s, env, me){ return me.id ? S(s.doctor_id) === me.id : isChief(env) && !S(s.doctor_id) && S(s.role) === 'chief' }
/**
 * הפעלת התראות במכשיר הזה. sub = PushSubscription.toJSON() מהדפדפן. מכשיר אחד יכול לשמש רק משתמש אחד:
 * הפעלה ממכשיר שהיה רשום למישהו אחר מעבירה אותו (אחרי כניסה מחדש באותו טלפון). שולח התראת פתיחה.
 */
async function pushOn(env, sub){
  if (!webpush.enabled()) throw err('ההתראות לטלפון עוד לא הוגדרו בשרת (VAPID)');
  let clean;
  try { clean = webpush.cleanSub(sub) } catch (e){ throw err(e.message) }
  const { t, me } = await ctx(env, ['push_subs']);
  const id = webpush.tagOf(clean.endpoint), cur = t.push_subs.find(s => S(s.id) === id);
  const row = { id, doctor_id: me.id, role: env.role, endpoint: clean.endpoint, p256dh: clean.keys.p256dh, auth: clean.keys.auth, created_at: cur ? S(cur.created_at) : nowIso() };
  await upsertRows('push_subs', t.push_subs, [row]);
  await db.log(env, 'push_on', 'push_subs', id, cur ? S(cur.doctor_id) : '', me.id || 'chief');
  const r = await webpush.send(clean, { title: 'ההתראות פעילות ✓', body: 'כאן יגיעו התראות על חודש שנפתח לאילוצים, לוח שפורסם, תזכורות והחלפות.', url: '/' }, { ttl: 600 })
    .then(() => true, e => { console.warn('push welcome', e.message); return false });
  return { tag: id, sent: r };
}
/** כיבוי ההתראות במכשיר (גם ביציאה מהאפליקציה). רק המכשיר שלי — או כל מכשיר, לצ׳יף */
async function pushOff(env, endpoint){
  const { t, me } = await ctx(env, ['push_subs']);
  const id = webpush.tagOf(endpoint), cur = t.push_subs.find(s => S(s.id) === id);
  if (!cur) return { off: true };
  if (!ownSub(cur, env, me) && !isChief(env)) throw err('המכשיר הזה רשום למשתמש אחר');
  await db.removeMany('push_subs', [id]);
  await db.log(env, 'push_off', 'push_subs', id, S(cur.doctor_id), '');
  return { off: true };
}

/* ============================ צ׳יף: שיבוץ ============================ */

/** שיבוץ (או ריקון, doctorId='') של משבצת. כלל קשיח חוסם — גם לצ׳יף; עדיפות לא. */
async function assign(env, date, stationId, doctorId){
  needIso(date);
  const month = R.monthOf(date);
  const { t } = await ctx(env, RULE_TABLES.concat(['months', 'swap_requests']));
  editable(t, month); stationOf(t, stationId);
  const id = keyOf(date, stationId);
  const row = t.shifts.find(r => S(r.id) === id) || { id, date, station_id: S(stationId), doctor_id: '', locked: false, note: '' };
  const prev = S(row.doctor_id);
  doctorId = S(doctorId);
  if (doctorId && doctorId !== prev){
    const m = R.model(t);
    R.setSlot(m, date, stationId, null);
    const d = m.docById[doctorId];
    if (!d || !d.active) throw err('רופא/ה לא פעיל/ה');
    const ev = R.evaluate(m, doctorId, date, stationId);
    if (!ev.ok) throw err('אי אפשר לשבץ את ' + d.name + ': ' + ev.hard.join(', '));
  }
  await upsertRows('shifts', t.shifts, [Object.assign({}, row, { doctor_id: doctorId })]);
  // בקשת החלפה פתוחה של מי שהיה משובץ/ת כאן — בוצעה
  const swaps = prev && prev !== doctorId ? t.swap_requests.filter(r => S(r.status) === 'open' && S(r.doctor_id) === prev && S(r.date) === date && S(r.station_id) === S(stationId)) : [];
  if (swaps.length){
    await db.updateMany('swap_requests', swaps.map(r => ({ id: r.id, patch: { status: 'done' } })));
    await notify([{ to: prev, url: link('shifts', R.monthOf(date)), text: 'ההחלפה בוצעה: ' + stLabel(t, stationId) + ' · ' + fmtDay(date) + (doctorId ? ' · משובץ/ת עכשיו ' + docName(t, doctorId) : '') }]);
  }
  await finish(env, 'assign', 'shifts', id, prev, doctorId);
  return { date, station_id: S(stationId), doctor_id: doctorId, swapsDone: swaps.length };
}
/** נעילת משבצת: השיבוץ האוטומטי והניקוי לא נוגעים בה */
async function setLock(env, date, stationId, locked){
  needIso(date);
  const { t } = await ctx(env, ['shifts', 'months', 'stations']);
  editable(t, R.monthOf(date)); stationOf(t, stationId);
  const id = keyOf(date, stationId);
  const row = t.shifts.find(r => S(r.id) === id) || { id, date, station_id: S(stationId), doctor_id: '', locked: false, note: '' };
  await upsertRows('shifts', t.shifts, [Object.assign({}, row, { locked: !!locked })]);
  await finish(env, locked ? 'lock' : 'unlock', 'shifts', id);
  return { locked: !!locked };
}
/** שיבוץ אוטומטי למשבצות הריקות שאינן נעולות (lib/rules.js autoAssign) */
async function autoAssign(env, month){
  needMonth(month);
  const { t } = await ctx(env, RULE_TABLES.concat(['months']));
  editable(t, month);
  const m = R.model(t);
  const r = R.autoAssign(m, month);
  const byId = {}; t.shifts.forEach(x => byId[S(x.id)] = x);
  const rows = r.assigned.map(a => { const id = keyOf(a.date, a.station_id); return Object.assign({ id, date: a.date, station_id: a.station_id, locked: false, note: '' }, byId[id] || {}, { doctor_id: a.doctor_id }) });
  await upsertRows('shifts', t.shifts, rows);
  await finish(env, 'auto_assign', 'months', month, '', rows.length + ' filled, ' + r.unfilled.length + ' unfilled');
  return { filled: rows.length, unfilled: r.unfilled };
}
/** ניקוי כל המשבצות שאינן נעולות בחודש */
async function clearMonth(env, month){
  needMonth(month);
  const { t } = await ctx(env, ['shifts', 'months']);
  editable(t, month);
  const patches = t.shifts.filter(r => S(r.date).slice(0, 7) === month && S(r.doctor_id) && !R.truthy(r.locked)).map(r => ({ id: r.id, patch: { doctor_id: '' } }));
  if (patches.length) await db.updateMany('shifts', patches);
  await finish(env, 'clear', 'months', month, '', patches.length + ' cleared');
  return { cleared: patches.length };
}

/* ============================ צ׳יף: מחזור החודש ============================ */

async function setMonth(t, month, patch){
  const r = monthRow(t, month) || { id: month, month, status: '', deadline: '', published_at: '' };
  const row = Object.assign({}, r, patch, { id: month, month });
  await upsertRows('months', t.months, [row]);
  return row;
}
/** פתיחת חודש לאילוצים עם מועד אחרון. כולם מקבלים התראה. */
async function openMonth(env, month, deadline){
  needMonth(month); needIso(deadline);
  const { t } = await ctx(env, ['months']);
  const r = monthRow(t, month);
  if (r && r.status === 'published') throw err('הלוח של ' + R.monthLabel(month) + ' כבר פורסם');
  await setMonth(t, month, { status: 'open', deadline });
  if (!r || r.status !== 'open') await notify([{ to: 'all', url: link('mine', month), text: R.monthLabel(month) + ' נפתח לאילוצים. אפשר למלא עד ' + fmtDay(deadline) }]);
  await finish(env, 'open_month', 'months', month, r ? r.status : '', 'open ' + deadline);
  return { status: 'open' };
}
async function setDeadline(env, month, deadline){
  needMonth(month); needIso(deadline);
  const { t } = await ctx(env, ['months']);
  const r = monthRow(t, month);
  if (!r) throw err('החודש עוד לא נפתח');
  await setMonth(t, month, { deadline });
  if (r.status === 'open' && S(r.deadline) !== deadline) await notify([{ to: 'all', url: link('mine', month), text: 'המועד האחרון לאילוצים ל' + R.monthLabel(month) + ' עודכן: ' + fmtDay(deadline) }]);
  await finish(env, 'deadline', 'months', month, S(r.deadline), deadline);
  return { deadline };
}
/** סגירת האילוצים ומעבר לשיבוץ. יוצר שורה ריקה לכל משבצת שעוד אין לה (שורה לכל משבצת, HANDOFF 5) */
async function closeMonth(env, month){
  needMonth(month);
  const { t } = await ctx(env, ['months', 'shifts', 'stations']);
  const r = monthRow(t, month);
  if (!r || r.status !== 'open') throw err('החודש לא פתוח לאילוצים');
  await setMonth(t, month, { status: 'scheduling' });
  const have = {}; t.shifts.forEach(x => have[S(x.id)] = 1);
  const st = t.stations.filter(s => R.truthy(s.active, true)), add = [];
  R.daysOf(month).forEach(d => st.forEach(s => { const id = keyOf(d, s.id); if (!have[id]) add.push({ id, date: d, station_id: S(s.id), doctor_id: '', locked: false, note: '' }) }));
  if (add.length) await db.insert('shifts', add);
  await finish(env, 'close_month', 'months', month, 'open', 'scheduling');
  return { status: 'scheduling', slots: add.length };
}
/** פרסום: הלוח ננעל ומופיע לכולם. פעם שנייה (אחרי פתיחה מחדש) — "עודכן". */
async function publish(env, month){
  needMonth(month);
  const { t } = await ctx(env, ['months']);
  const r = monthRow(t, month);
  if (r && r.status === 'published') return { status: 'published' };
  const again = !!(r && S(r.published_at));
  await setMonth(t, month, { status: 'published', published_at: nowIso() });
  await notify([{ to: 'all', url: link('board', month), text: 'הלוח של ' + R.monthLabel(month) + (again ? ' עודכן' : ' פורסם') }]);
  await finish(env, 'publish', 'months', month, r ? r.status : '', 'published');
  return { status: 'published' };
}
/** פתיחה מחדש לעריכה (למשל להחלפה). הרופאים ממשיכים לראות את הלוח. */
async function reopen(env, month){
  needMonth(month);
  const { t } = await ctx(env, ['months']);
  const r = monthRow(t, month);
  if (!r || r.status !== 'published') throw err('הלוח לא במצב פורסם');
  await setMonth(t, month, { status: 'scheduling' });
  await finish(env, 'reopen', 'months', month, 'published', 'scheduling');
  return { status: 'scheduling' };
}
function missingFor(t, month){
  const sub = {}; t.submissions.forEach(s => { if (S(s.month) === month) sub[S(s.doctor_id)] = 1 });
  return t.doctors.filter(d => auth.active(d) && !sub[S(d.id)]);
}
/** תזכורת אישית לכל מי שעוד לא שלח/ה אילוצים לחודש */
async function remind(env, month){
  needMonth(month);
  const { t } = await ctx(env, ['months', 'submissions']);
  const r = monthRow(t, month);
  if (!r || r.status !== 'open') throw err('החודש לא פתוח לאילוצים');
  const miss = missingFor(t, month);
  await notify(miss.map(d => ({ to: S(d.id), url: link('mine', month), text: 'תזכורת מהצ׳יף: האילוצים ל' + R.monthLabel(month) + ' עוד לא נשלחו' + (S(r.deadline) ? '. המועד: ' + fmtDay(r.deadline) : '') })));
  await finish(env, 'remind', 'months', month, '', miss.length + ' doctors');
  return { sent: miss.length };
}
async function resolveSwap(env, id, status){
  if (status !== 'done' && status !== 'rejected') throw err('מצב לא מוכר');
  const { t } = await ctx(env, ['swap_requests', 'stations']);
  const r = t.swap_requests.find(x => S(x.id) === S(id));
  if (!r) throw err('הבקשה לא נמצאה');
  await db.updateMany('swap_requests', [{ id: r.id, patch: { status } }]);
  await notify([{ to: S(r.doctor_id), url: link('shifts', R.monthOf(S(r.date))), text: 'בקשת ההחלפה (' + stLabel(t, r.station_id) + ' · ' + fmtDay(S(r.date)) + ') ' + (status === 'done' ? 'טופלה' : 'נדחתה') }]);
  await finish(env, 'swap_' + status, 'swap_requests', r.id);
  return { status };
}

/* ============================ צ׳יף: הגדרות ============================ */

/** עמדה חדשה (בלי id) או עדכון. צבע — הפנוי הבא מתוך 6 */
async function saveStation(env, o){
  o = o || {};
  const { t } = await ctx(env, ['stations']);
  const name = S(o.name).slice(0, 60);
  if (o.id){
    const cur = t.stations.find(s => S(s.id) === S(o.id));
    if (!cur) throw err('העמדה לא קיימת');
    const patch = {};
    if (o.name !== undefined){ if (!name) throw err('צריך שם לעמדה'); patch.name = name }
    if (o.short !== undefined) patch.short = S(o.short).slice(0, 12) || name.slice(0, 5);
    if (o.sort !== undefined) patch.sort = Number(o.sort) || 0;
    await db.updateMany('stations', [{ id: cur.id, patch }]);
    await finish(env, 'station', 'stations', cur.id, '', JSON.stringify(patch));
    return { id: S(cur.id) };
  }
  if (!name) throw err('צריך שם לעמדה');
  const active = t.stations.filter(s => R.truthy(s.active, true));
  if (active.some(s => S(s.name) === name)) throw err('כבר יש עמדה בשם הזה');
  const used = {}; active.forEach(s => used[Number(s.color)] = 1);
  let color = 1; while (color <= COLORS && used[color]) color++;
  if (color > COLORS) color = (active.length % COLORS) + 1;
  const row = { id: newId('st'), name, short: S(o.short).slice(0, 12) || name.slice(0, 5), color, active: true, sort: Math.max(0, ...t.stations.map(s => Number(s.sort) || 0)) + 1 };
  await db.insert('stations', [row]);
  await finish(env, 'station_add', 'stations', row.id, '', name);
  return { id: row.id };
}
/** הסרת עמדה: מסומנת לא פעילה (ההיסטוריה בלוחות שפורסמו נשמרת), והשיבוצים שלה בחודשים שלא פורסמו נמחקים */
async function removeStation(env, id){
  const { t } = await ctx(env, ['stations', 'shifts', 'months']);
  const st = stationOf(t, id);
  if (t.stations.filter(s => R.truthy(s.active, true)).length <= 1) throw err('צריך לפחות עמדה אחת');
  const pub = {}; t.months.forEach(r => { if (r.status === 'published' || S(r.published_at)) pub[r.id] = 1 });
  const del = t.shifts.filter(r => S(r.station_id) === S(id) && !pub[S(r.date).slice(0, 7)]).map(r => r.id);
  await db.updateMany('stations', [{ id: st.id, patch: { active: false } }]);
  if (del.length) await db.removeMany('shifts', del);
  await finish(env, 'station_remove', 'stations', st.id, S(st.name), del.length + ' shifts removed');
  return { removedShifts: del.length };
}
/** רופא/ה חדש/ה (בלי id) או עדכון: name, email, phone, active, role. חדש/ה — מוסמך/ת לכל העמדות הפעילות */
async function saveDoctor(env, o){
  o = o || {};
  const { t, me } = await ctx(env, ['stations', 'qualifications']);
  const email = o.email === undefined ? undefined : S(o.email).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err('כתובת מייל לא תקינה');
  if (email && t.doctors.some(d => S(d.email).toLowerCase() === email && S(d.id) !== S(o.id))) throw err('המייל הזה כבר רשום לרופא/ה אחר/ת');
  if (o.role !== undefined && o.role !== 'doctor' && o.role !== 'chief') throw err('תפקיד לא מוכר');
  if (o.id){
    const cur = t.doctors.find(d => S(d.id) === S(o.id));
    if (!cur) throw err('רופא/ה לא קיימ/ת');
    if (S(cur.id) === me.id && (o.active === false || o.role === 'doctor')) throw err('אי אפשר להוריד את עצמך מהצ׳יף או להשבית את עצמך');
    const patch = {};
    if (o.name !== undefined){ if (!S(o.name)) throw err('צריך שם'); patch.name = S(o.name).slice(0, 60) }
    if (email !== undefined) patch.email = email;
    if (o.phone !== undefined) patch.phone = S(o.phone).slice(0, 30);
    if (o.active !== undefined) patch.active = !!o.active;
    if (o.role !== undefined) patch.role = o.role;
    await db.updateMany('doctors', [{ id: cur.id, patch }]);
    await finish(env, 'doctor', 'doctors', cur.id, '', JSON.stringify(patch));
    return { id: S(cur.id) };
  }
  const name = S(o.name).slice(0, 60);
  if (!name) throw err('צריך שם');
  const row = { id: newId('d'), name, email: email || '', login_code_hash: '', active: true, role: o.role === 'chief' ? 'chief' : 'doctor', phone: S(o.phone).slice(0, 30) };
  await db.insert('doctors', [row]);
  const quals = t.stations.filter(s => R.truthy(s.active, true)).map(s => ({ id: keyOf(row.id, s.id), doctor_id: row.id, station_id: S(s.id) }));
  await upsertRows('qualifications', t.qualifications, quals);
  await finish(env, 'doctor_add', 'doctors', row.id, '', name);
  return { id: row.id };
}
async function setQual(env, doctorId, stationId, on){
  const { t } = await ctx(env, ['stations', 'qualifications']);
  if (!t.doctors.some(d => S(d.id) === S(doctorId))) throw err('רופא/ה לא קיימ/ת');
  stationOf(t, stationId);
  const id = keyOf(doctorId, stationId), has = t.qualifications.some(q => S(q.id) === id);
  if (on && !has) await db.insert('qualifications', [{ id, doctor_id: S(doctorId), station_id: S(stationId) }]);
  if (!on && has) await db.removeMany('qualifications', [id]);
  if (!!on !== has) await finish(env, on ? 'qual_on' : 'qual_off', 'qualifications', id);
  return { on: !!on };
}
async function addHoliday(env, date, name){
  needIso(date);
  name = S(name).slice(0, 40);
  if (!name) throw err('צריך שם');
  const { t } = await ctx(env, ['holidays']);
  await upsertRows('holidays', t.holidays, [{ id: date, date, name }]);
  await finish(env, 'holiday', 'holidays', date, '', name);
  return { date };
}
async function removeHoliday(env, date){
  const { t } = await ctx(env, ['holidays']);
  if (t.holidays.some(h => S(h.id) === S(date))) await db.removeMany('holidays', [S(date)]);
  await finish(env, 'holiday_remove', 'holidays', S(date));
  return { date: S(date) };
}
/** קוד כניסה אישי חדש (6 ספרות). מוצג פעם אחת לצ׳יף; נשמר מגובב. מכשירים שנכנסו בקוד הקודם מתנתקים. */
async function issueCode(env, doctorId){
  const { t, settings } = await ctx(env, []);
  const d = t.doctors.find(x => S(x.id) === S(doctorId));
  if (!d) throw err('רופא/ה לא קיימ/ת');
  let code = '';
  for (let i = 0; i < 5 && !code; i++){
    const c = auth.newCode();
    const taken = await Promise.all(t.doctors.map(x => auth.codeMatches(x.login_code_hash, c)).concat([auth.codeMatches(chiefStored(settings), c)]));
    if (taken.indexOf(true) < 0) code = c;
  }
  if (!code) throw err('לא הצלחתי ליצור קוד ייחודי. נסו שוב.');
  await db.updateMany('doctors', [{ id: d.id, patch: { login_code_hash: auth.hashCode(code) } }]);
  await finish(env, 'issue_code', 'doctors', S(d.id));
  return { code, name: S(d.name) };
}
const SETTABLE = { reminder_days: v => { const n = Number(v); if (!(n >= 0 && n <= 14) || !Number.isInteger(n)) throw err('בין 0 ל-14 ימים'); return n } };
async function setSetting(env, key, value){
  if (!SETTABLE[key]) throw err('הגדרה לא מוכרת: ' + key);
  await ctx(env, []);
  const v = SETTABLE[key](value);
  await db.setSettings({ [key]: v }, true);
  await db.log(env, 'setting', 'settings', key, '', String(v));
  return { [key]: v };
}

/* ============================ תזכורת אוטומטית (api/cron.js) ============================ */

/**
 * לכל חודש פתוח עם מועד אחרון: כשנשארו reminder_days ימים או פחות — תזכורת אחת לכל מי שעוד לא שלח/ה,
 * וסיכום לצ׳יף. נרשם ב-settings (reminded_YYYY-MM = המועד) כדי שלא תישלח פעמיים; שינוי מועד = תזכורת חדשה.
 */
async function tick(now){
  const today = todayIso(now);
  const t = clean(await db.readAll(['settings', 'doctors', 'months', 'submissions']));
  const settings = settingsOf(t.settings);
  const days = Number(settings.reminder_days);
  const out = { today, sent: [] };
  if (!(days > 0)) return Object.assign(out, { off: true });
  const env = { role: 'chief', who: 'תזכורת אוטומטית' };
  for (const r of t.months){
    const dl = S(r.deadline);
    if (r.status !== 'open' || !R.isIso(dl) || today > dl || today < R.addDays(dl, -days)) continue;
    if (S(settings['reminded_' + r.id]) === dl) continue;
    const miss = missingFor(t, r.id);
    await notify(miss.map(d => ({ to: S(d.id), url: link('mine', r.id), text: 'תזכורת: האילוצים ל' + R.monthLabel(r.id) + ' עוד לא נשלחו. המועד: ' + fmtDay(dl) }))
      .concat(miss.length ? [{ to: 'chief', url: link('plan', r.id), text: miss.length + ' רופאים עוד לא מילאו אילוצים ל' + R.monthLabel(r.id) + ' (נשלחה תזכורת)' }] : []));
    await db.setSettings({ ['reminded_' + r.id]: dl }, true);
    await db.log(env, 'auto_remind', 'months', r.id, '', miss.length + ' doctors');
    out.sent.push({ month: r.id, doctors: miss.length });
  }
  return out;
}

/* fn → [פונקציה, תפקיד מינימלי] */
const FNS = {
  snapshot: [snapshot, 'doctor'], poll: [poll, 'doctor'],
  saveConstraints: [saveConstraints, 'doctor'], submit: [submit, 'doctor'], saveFixed: [saveFixed, 'doctor'], requestSwap: [requestSwap, 'doctor'], pushOn: [pushOn, 'doctor'], pushOff: [pushOff, 'doctor'],
  assign: [assign, 'chief'], setLock: [setLock, 'chief'], autoAssign: [autoAssign, 'chief'], clearMonth: [clearMonth, 'chief'],
  openMonth: [openMonth, 'chief'], setDeadline: [setDeadline, 'chief'], closeMonth: [closeMonth, 'chief'], publish: [publish, 'chief'], reopen: [reopen, 'chief'],
  remind: [remind, 'chief'], resolveSwap: [resolveSwap, 'chief'],
  saveStation: [saveStation, 'chief'], removeStation: [removeStation, 'chief'], saveDoctor: [saveDoctor, 'chief'], setQual: [setQual, 'chief'],
  addHoliday: [addHoliday, 'chief'], removeHoliday: [removeHoliday, 'chief'], issueCode: [issueCode, 'chief'], setSetting: [setSetting, 'chief']
};
// saveConstraints / saveFixed עם doctorId של מישהו אחר — רק צ׳יף. נבדק בפנים (isChief); לרופא/ה doctorId מתעלמים

module.exports = { FNS, snapshot, tick, todayIso, STATUS_LABEL, visibleMonth };
