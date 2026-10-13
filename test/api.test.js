/**
 * test/api.test.js — פונקציות השרת (lib/api.js) על DB בזיכרון: הרשאות, מחזור החודש, שיבוץ, החלפות, התראות (היומן; השליחה לטלפון — test/push.test.js).
 *   node test/api.test.js
 */
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.CHIEF_CODE = '';
const assert = require('assert');
const memdb = require('./memdb');
const F = require('./fixtures');
const R = require('../lib/rules');
const auth = require('../lib/auth');
const { keyOf } = require('../lib/schema');
const { FNS, todayIso, tick } = require('../lib/api');

const call = (env, fn, ...a) => FNS[fn][0](Object.assign({}, env), ...a);
const unpack = t => t.rows.map(r => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])));
const today = todayIso(), cur = R.monthOf(today), next = R.addMonths(cur, 1), later = R.addMonths(cur, 2);
const nd = n => next + '-' + String(n).padStart(2, '0');             // יום בחודש הבא
const curShift = cur + '-15';
const CHIEF = { role: 'chief', did: 'd3' }, D1 = { role: 'doctor', did: 'd1' }, D2 = { role: 'doctor', did: 'd2' };

function setup(extra){
  return memdb.use(Object.assign({
    stations: F.STATIONS, doctors: F.DOCTORS.map(d => Object.assign({}, d)), qualifications: F.QUALIFICATIONS, fixed_constraints: F.FIXED,
    months: [{ id: cur, month: cur, status: 'published', deadline: '', published_at: '2026-01-01T00:00:00Z' },
             { id: next, month: next, status: 'open', deadline: R.addDays(today, 3), published_at: '' }],
    shifts: [{ id: keyOf(curShift, 'icu'), date: curShift, station_id: 'icu', doctor_id: 'd1', locked: true, note: '' }]
  }, extra || {}));
}
const rejects = (p, re) => assert.rejects(p, re);

(async () => {
  /* ---- snapshot: מה רופא/ה רואה ---- */
  {
    const mem = setup({ constraints: [{ id: keyOf('d1', nd(3)), doctor_id: 'd1', date: nd(3), status: 'no' }, { id: keyOf('d5', nd(4)), doctor_id: 'd5', date: nd(4), status: 'no' }] });
    mem.m.doctors[0].login_code_hash = auth.hashCode('123456');
    await call(CHIEF, 'assign', nd(10), 'icu', 'd8');                  // טיוטה בחודש שעוד לא פורסם
    const s = await call(D1, 'snapshot');
    assert.equal(s.me.did, 'd1'); assert.equal(s.me.name, 'נועה ברק'); assert.equal(s.me.role, 'doctor');
    assert.deepEqual(s.tables.doctors.cols, ['id', 'name', 'active', 'role'], 'בלי קוד, מייל וטלפון');
    assert.ok(!JSON.stringify(s).includes('scrypt$'));
    assert.deepEqual(unpack(s.tables.constraints).map(c => c.doctor_id), ['d1'], 'רק האילוצים שלי');
    const shifts = unpack(s.tables.shifts);
    assert.ok(shifts.some(x => x.date === curShift), 'לוח שפורסם');
    assert.ok(!shifts.some(x => x.date === nd(10)), 'טיוטה של הצ׳יף לא נראית');
    const c = await call(CHIEF, 'snapshot');
    assert.ok(unpack(c.tables.shifts).some(x => x.date === nd(10)));
    assert.equal(unpack(c.tables.constraints).length, 2);
    assert.equal(unpack(c.tables.doctors).find(d => d.id === 'd1').has_code, true);
    assert.ok(!JSON.stringify(c).includes('scrypt$'), 'גם הצ׳יף לא מקבל את ה-hash');
  }

  /* ---- אילוצים ---- */
  {
    const mem = setup();
    const r = await call(D1, 'saveConstraints', next, { [nd(5)]: 'no', [nd(6)]: 'prefer', [nd(7)]: 'ok' });
    assert.equal(r.saved, 2);
    assert.deepEqual(mem.m.constraints.map(c => [c.id, c.status]), [[keyOf('d1', nd(5)), 'no'], [keyOf('d1', nd(6)), 'prefer']]);
    await call(D1, 'saveConstraints', next, { [nd(5)]: 'ok', [nd(6)]: 'no' });           // פנוי מוחק, שינוי מעדכן
    assert.deepEqual(mem.m.constraints.map(c => [c.date, c.status]), [[nd(6), 'no']]);
    // doctorId של מישהו אחר — מתעלמים: נכתב לעצמי
    await call(D1, 'saveConstraints', next, { [nd(8)]: 'no' }, 'd5');
    assert.ok(mem.m.constraints.every(c => c.doctor_id === 'd1'));
    // יום עם אילוץ קבוע (יונתן — שלישי) מדולג
    const tue = R.daysOf(next).find(d => R.weekday(d) === 2);
    assert.equal((await call(D2, 'saveConstraints', next, { [tue]: 'prefer' })).saved, 0);
    // חודש שפורסם / שלא נפתח / תאריך מחוץ לחודש
    await rejects(call(D1, 'saveConstraints', cur, { [curShift]: 'no' }), /לא פתוח לאילוצים/);
    // מראש: חודש עתידי שעוד לא נפתח — נשמר, אבל אי אפשר לשלוח; לא חודש שכבר התחיל, ולא מעבר ל-AHEAD
    assert.equal((await call(D1, 'saveConstraints', later, { [later + '-02']: 'no' })).saved, 1);
    assert.ok(mem.m.constraints.some(c => c.id === keyOf('d1', later + '-02')));
    await rejects(call(D1, 'submit', later, {}), /עוד לא נפתח/);
    assert.ok(!mem.m.submissions.some(s => s.month === later));
    const far = R.addMonths(cur, R.AHEAD + 1), prevM = R.addMonths(cur, -1);
    await rejects(call(D1, 'saveConstraints', far, { [far + '-02']: 'no' }), /עד 6 חודשים קדימה/);
    await rejects(call(D1, 'saveConstraints', prevM, { [prevM + '-02']: 'no' }), /לא פתוח לאילוצים/);
    await call(D1, 'saveConstraints', later, { [later + '-02']: 'ok' });
    await rejects(call(D1, 'saveConstraints', next, { [curShift]: 'no' }), /מחוץ לחודש/);
    await rejects(call(D1, 'saveConstraints', next, { [nd(2)]: 'maybe' }), /מצב לא מוכר/);
    // שליחה
    await call(D1, 'submit', next, { [nd(9)]: 'no' });
    assert.ok(mem.m.submissions.some(s => s.id === keyOf('d1', next)));
    assert.ok(mem.m.constraints.some(c => c.date === nd(9)));
    const s = await call(D1, 'snapshot');
    assert.equal(s.counts[next], 1);
    // המועד עבר — רופא/ה לא יכול/ה, הצ׳יף כן (בשם רופא/ה)
    mem.m.months.find(x => x.id === next).deadline = R.addDays(today, -1);
    await rejects(call(D1, 'saveConstraints', next, { [nd(11)]: 'no' }), /המועד האחרון/);
    await call(CHIEF, 'saveConstraints', next, { [nd(11)]: 'no' }, 'd1');
    assert.ok(mem.m.constraints.some(c => c.id === keyOf('d1', nd(11))));
    const v = mem.version();
    assert.ok(v > 1, 'כתיבה מקדמת גרסה');
  }

  /* ---- אילוצים קבועים: רופא/ה עורך/ת את שלו/ה, הצ׳יף מקבל/ת התראה ---- */
  {
    const tues = [1, 2, 3, 4, 5, 6, 7].map(n => R.addDays(today, n)).filter(d => R.weekday(d) === 2);
    const mem = setup({ shifts: [{ id: keyOf(tues[0], 'icu'), date: tues[0], station_id: 'icu', doctor_id: 'd1', locked: false, note: '' }] });
    assert.deepEqual(await call(D1, 'saveFixed', {}, null), { changed: false });
    await call(D1, 'saveFixed', { 2: 'no', 5: 'prefer' }, 'מרפאה', 'd5');         // doctorId של מישהו אחר — נכתב לעצמי
    assert.deepEqual(mem.m.fixed_constraints.filter(f => f.doctor_id === 'd1').map(f => [f.weekday, f.status, f.note]).sort(), [[2, 'no', 'מרפאה'], [5, 'prefer', 'מרפאה']]);
    assert.ok(!mem.m.fixed_constraints.some(f => f.doctor_id === 'd5'));
    const n = mem.m.notifications.filter(x => x.to === 'chief' && /^אילוצים קבועים: נועה ברק/.test(x.text));
    assert.equal(n.length, 1);
    assert.match(n[0].text, /יום שלישי לא יכול\/ה · יום שישי מעדיף\/ה שלא \("מרפאה"\)/);
    assert.match(n[0].text, new RegExp('תורנות שכבר שובצה נופלת על יום חסום — ' + R.fmtShort(tues[0])));
    // היום עכשיו נעול גם לאילוצים החודשיים, ומחייב בשיבוץ
    const tueNext = R.daysOf(next).find(d => R.weekday(d) === 2);
    assert.equal((await call(D1, 'saveConstraints', next, { [tueNext]: 'prefer' })).saved, 0);
    await rejects(call(CHIEF, 'assign', tueNext, 'icu', 'd1'), /אילוץ קבוע: מרפאה/);
    // רופא/ה רואה רק את הקבועים של עצמו/ה
    assert.deepEqual(unpack((await call(D1, 'snapshot')).tables.fixed_constraints).map(f => f.doctor_id).filter((x, i, a) => a.indexOf(x) === i), ['d1']);
    // מחיקה — התראה "בלי אילוצים קבועים"
    await call(D1, 'saveFixed', { 2: '', 5: '' });
    assert.ok(!mem.m.fixed_constraints.some(f => f.doctor_id === 'd1'));
    assert.ok(mem.m.notifications.some(x => x.to === 'chief' && x.text === 'אילוצים קבועים: נועה ברק · בלי אילוצים קבועים'));
    await rejects(call(D1, 'saveFixed', { 7: 'no' }), /יום בשבוע לא תקין/);
    await rejects(call(D1, 'saveFixed', { 1: 'maybe' }), /מצב לא מוכר/);
  }

  /* ---- שיבוץ: כללים קשיחים חוסמים גם צ׳יף; נעילה; אוטומטי; ניקוי ---- */
  {
    const mem = setup({ constraints: [{ id: keyOf('d5', nd(4)), doctor_id: 'd5', date: nd(4), status: 'no' }] });
    await call(CHIEF, 'assign', nd(1), 'icu', 'd1');
    await rejects(call(CHIEF, 'assign', nd(2), 'cardio', 'd1'), /תורנות אתמול/);
    await rejects(call(CHIEF, 'assign', nd(1), 'cardio', 'd1'), /כבר משובץ\/ת היום/);
    await rejects(call(CHIEF, 'assign', nd(4), 'icu', 'd5'), /לא יכול\/ה/);
    await rejects(call(CHIEF, 'assign', nd(5), 'icu', 'd2'), /לא מוסמך/);
    await rejects(call(CHIEF, 'assign', nd(5), 'nope', 'd1'), /העמדה לא קיימת/);
    // החלפה באותה משבצת — הנוכחי/ת לא חוסם/ת את המחליף/ה
    await call(CHIEF, 'assign', nd(1), 'icu', 'd5');
    assert.equal(mem.m.shifts.find(r => r.id === keyOf(nd(1), 'icu')).doctor_id, 'd5');
    await call(CHIEF, 'setLock', nd(1), 'icu', true);
    await call(CHIEF, 'setLock', nd(2), 'icu', true);                   // נעולה וריקה
    const a = await call(CHIEF, 'autoAssign', next);
    const days = R.daysOf(next).length;
    assert.equal(a.filled, days * 3 - 2, 'כל המשבצות חוץ מהנעולות');
    assert.equal(a.unfilled.length, 0);
    assert.equal(mem.m.shifts.find(r => r.id === keyOf(nd(1), 'icu')).doctor_id, 'd5', 'נעולה לא זזה');
    assert.equal(mem.m.shifts.find(r => r.id === keyOf(nd(2), 'icu')).doctor_id, '', 'נעולה וריקה נשארת ריקה');
    const m = R.model(mem.m);
    assert.deepEqual(R.issues(m, next).violations, []);
    const c = await call(CHIEF, 'clearMonth', next);
    assert.equal(c.cleared, days * 3 - 2);
    assert.equal(mem.m.shifts.find(r => r.id === keyOf(nd(1), 'icu')).doctor_id, 'd5');
    assert.ok(mem.m.shifts.filter(r => r.date.startsWith(next) && r.doctor_id).length === 1);
  }

  /* ---- מחזור החודש: פתיחה, סגירה, פרסום, פתיחה מחדש ---- */
  {
    const mem = setup();
    await call(CHIEF, 'openMonth', later, R.addDays(later + '-01', -10));
    assert.equal(mem.m.months.find(x => x.id === later).status, 'open');
    assert.ok(mem.m.notifications.some(n => n.to === 'all' && /נפתח לאילוצים/.test(n.text)));
    await rejects(call(CHIEF, 'openMonth', cur, today), /כבר פורסם/);
    const cl = await call(CHIEF, 'closeMonth', later);
    assert.equal(cl.slots, R.daysOf(later).length * 3, 'שורה ריקה לכל משבצת');
    assert.equal(mem.m.months.find(x => x.id === later).status, 'scheduling');
    await rejects(call(D1, 'saveConstraints', later, { [later + '-03']: 'no' }), /לא פתוח/);
    await call(CHIEF, 'autoAssign', later);
    let s = await call(D1, 'snapshot');
    assert.ok(!unpack(s.tables.shifts).some(x => x.date.startsWith(later)), 'בשיבוץ — הרופאים עוד לא רואים');
    await call(CHIEF, 'publish', later);
    assert.ok(mem.m.notifications.some(n => n.to === 'all' && n.text === 'הלוח של ' + R.monthLabel(later) + ' פורסם'));
    s = await call(D1, 'snapshot');
    assert.equal(unpack(s.tables.shifts).filter(x => x.date.startsWith(later)).length, R.daysOf(later).length * 3);
    await rejects(call(CHIEF, 'assign', later + '-03', 'icu', ''), /פורסם ונעול/);
    await rejects(call(CHIEF, 'autoAssign', later), /פורסם ונעול/);
    await call(CHIEF, 'reopen', later);
    s = await call(D1, 'snapshot');
    assert.ok(unpack(s.tables.shifts).some(x => x.date.startsWith(later)), 'אחרי פתיחה מחדש — הרופאים ממשיכים לראות');
    await call(CHIEF, 'publish', later);
    assert.ok(mem.m.notifications.some(n => n.text === 'הלוח של ' + R.monthLabel(later) + ' עודכן'));
    await call(CHIEF, 'setDeadline', next, R.addDays(today, 6));
    assert.equal(mem.m.months.find(x => x.id === next).deadline, R.addDays(today, 6));
  }

  /* ---- בקשת החלפה ---- */
  {
    const mem = setup();
    await rejects(call(D2, 'requestSwap', curShift, 'icu', ''), /לא התורנות שלך/);
    await rejects(call(D1, 'requestSwap', curShift, 'cardio', ''), /לא התורנות שלך/);
    const r = await call(D1, 'requestSwap', curShift, 'icu', 'רועי מוכן להחליף');
    assert.ok(mem.m.notifications.some(n => n.to === 'chief' && /בקשת החלפה: נועה ברק · יחידת טיפול נמרץ/.test(n.text) && /רועי מוכן/.test(n.text)));
    await call(D1, 'requestSwap', curShift, 'icu', 'עדכון');                // אותה בקשה, הערה חדשה
    assert.equal(mem.m.swap_requests.length, 1); assert.equal(mem.m.swap_requests[0].note, 'עדכון');
    // ההחלפה עצמה — רק בלוח פתוח לעריכה
    await rejects(call(CHIEF, 'assign', curShift, 'icu', 'd10'), /פורסם ונעול/);
    await call(CHIEF, 'reopen', cur);
    await call(CHIEF, 'assign', curShift, 'icu', 'd10');
    assert.equal(mem.m.swap_requests[0].status, 'done', 'שיבוץ מחדש סוגר את הבקשה');
    assert.ok(mem.m.notifications.some(n => n.to === 'd1' && /ההחלפה בוצעה/.test(n.text) && /רועי אדלר/.test(n.text)));
    const r2 = await call(D10(), 'requestSwap', curShift, 'icu', '');
    await call(CHIEF, 'resolveSwap', r2.id, 'rejected');
    assert.ok(mem.m.notifications.some(n => n.to === 'd10' && /נדחתה/.test(n.text)));
    assert.ok(r.id);
  }

  /* ---- הגדרות: עמדות, רופאים, הסמכות, אילוצים קבועים, חגים ---- */
  {
    const mem = setup({ months: [{ id: cur, month: cur, status: 'published', deadline: '', published_at: 'x' }, { id: next, month: next, status: 'scheduling', deadline: '', published_at: '' }] });
    await call(CHIEF, 'assign', nd(3), 'icu', 'd1');
    const st = await call(CHIEF, 'saveStation', { name: 'מיון', short: 'מיון' });
    const row = mem.m.stations.find(s => s.id === st.id);
    assert.equal(row.color, 4, 'הצבע הפנוי הבא'); assert.equal(row.sort, 4);
    await rejects(call(CHIEF, 'saveStation', { name: 'מיון' }), /כבר יש עמדה/);
    const rm = await call(CHIEF, 'removeStation', 'icu');
    assert.equal(rm.removedShifts, 1, 'שיבוץ בחודש שלא פורסם נמחק');
    assert.ok(mem.m.shifts.some(r => r.id === keyOf(curShift, 'icu')), 'לוח שפורסם נשמר');
    assert.equal(mem.m.stations.find(s => s.id === 'icu').active, false);
    const d = await call(CHIEF, 'saveDoctor', { name: 'רופאה חדשה', email: 'New@Example.com' });
    assert.equal(mem.m.doctors.find(x => x.id === d.id).email, 'new@example.com');
    assert.deepEqual(mem.m.qualifications.filter(q => q.doctor_id === d.id).map(q => q.station_id).sort(), ['cardio', 'scopus', st.id].sort(), 'מוסמכת לכל העמדות הפעילות');
    await rejects(call(CHIEF, 'saveDoctor', { name: 'כפול', email: 'new@example.com' }), /כבר רשום/);
    await rejects(call(CHIEF, 'saveDoctor', { id: 'd3', role: 'doctor' }), /את עצמך/);
    await rejects(call(CHIEF, 'saveDoctor', { id: 'd3', active: false }), /את עצמך/);
    await call(CHIEF, 'setQual', 'd2', 'scopus', true);
    assert.ok(mem.m.qualifications.some(q => q.id === keyOf('d2', 'scopus')));
    await call(CHIEF, 'setQual', 'd2', 'scopus', false);
    assert.ok(!mem.m.qualifications.some(q => q.id === keyOf('d2', 'scopus')));
    await call(CHIEF, 'saveFixed', { 3: 'no' }, 'מרפאה', 'd1');
    assert.deepEqual(mem.m.fixed_constraints.filter(f => f.doctor_id === 'd1').map(f => [f.weekday, f.status, f.note]), [[3, 'no', 'מרפאה']]);
    await call(CHIEF, 'saveFixed', { 3: 'prefer' }, null, 'd1');
    assert.equal(mem.m.fixed_constraints.find(f => f.id === keyOf('d1', 3)).note, 'מרפאה', 'ההערה נשמרת כשמחליפים מצב');
    await call(CHIEF, 'saveFixed', { 0: 'no' }, null, 'd1');
    assert.equal(mem.m.fixed_constraints.find(f => f.id === keyOf('d1', 0)).note, 'מרפאה', 'יום חדש מקבל את ההערה הקיימת');
    await call(CHIEF, 'saveFixed', { 3: '', 0: '' }, null, 'd1');
    assert.ok(!mem.m.fixed_constraints.some(f => f.doctor_id === 'd1'));
    assert.ok(!mem.m.notifications.some(n => /אילוצים קבועים/.test(n.text)), 'שינוי של הצ׳יף — בלי התראה');
    await call(CHIEF, 'addHoliday', nd(12), 'יום המחלקה');
    assert.equal(R.model(mem.m).holidays[nd(12)], 'יום המחלקה');
    await call(CHIEF, 'removeHoliday', nd(12));
    assert.equal(mem.m.holidays.length, 0);
    await rejects(call(CHIEF, 'setSetting', 'reminder_days', 30), /בין 0 ל-14/);
    await call(CHIEF, 'setSetting', 'reminder_days', 3);
    assert.equal(mem.m.settings.find(x => x.key === 'reminder_days').value, 3);
  }

  /* ---- זהות: קוד שהוחלף, רופא/ה שהושבת/ה, צ׳יף שהורד/ה ---- */
  {
    const mem = setup();
    const { code } = await call(CHIEF, 'issueCode', 'd1');
    assert.match(code, /^\d{6}$/);
    const who = await auth.loginByCode(code, mem.m.doctors, {});
    assert.deepEqual([who.role, who.did], ['doctor', 'd1']);
    const env = { role: who.role, did: who.did, ck: who.ck };
    assert.equal((await call(env, 'snapshot')).me.did, 'd1');
    await call(CHIEF, 'issueCode', 'd1');                                // קוד חדש — המכשיר הקודם מתנתק
    await rejects(call(env, 'snapshot'), e => e.status === 401 && /הקוד הוחלף/.test(e.message));
    assert.equal(await auth.loginByCode(code, mem.m.doctors, {}), null);
    mem.m.doctors.find(d => d.id === 'd2').active = false;
    await rejects(call(D2, 'snapshot'), e => e.status === 401);
    mem.m.doctors.find(d => d.id === 'd3').role = 'doctor';
    await rejects(call(CHIEF, 'snapshot'), e => e.status === 401 && /הצ׳יף בוטלה/.test(e.message));
    // קוד צ׳יף מהסביבה: נכנס/ת כצ׳יף גם בלי רופא/ה שמסומן/ת chief
    process.env.CHIEF_CODE = '24680';
    const ch = await auth.loginByCode('24680', mem.m.doctors, {});
    assert.equal(ch.role, 'chief'); assert.equal(ch.did, '');
    const snap = await call({ role: 'chief', did: '', ck: ch.ck }, 'snapshot');
    assert.equal(snap.me.name, 'צ׳יף');
    process.env.CHIEF_CODE = '13579';                                    // הקוד הוחלף
    await rejects(call({ role: 'chief', did: '', ck: ch.ck }, 'snapshot'), e => e.status === 401);
    process.env.CHIEF_CODE = '';
  }

  /* ---- rpc: תפקיד מה-cookie, 403 לרופא/ה, 401 בלי cookie, snap אחרי פעולה ---- */
  {
    setup();
    const rpc = require('../api/rpc');
    const run = async (cookie, body) => {
      const req = { method: 'POST', headers: { cookie: cookie ? auth.COOKIE + '=' + cookie : '' }, body };
      const res = { headers: {}, setHeader(k, v){ this.headers[k] = v }, status(c){ this.code = c; return this }, json(o){ this.body = o; return this } };
      await rpc(req, res); return res;
    };
    assert.equal((await run('', { fn: 'snapshot' })).code, 401);
    const doc = auth.issue({ role: 'doctor', did: 'd1' }), chief = auth.issue({ role: 'chief', did: 'd3' });
    assert.equal((await run(doc, { fn: 'assign', args: [nd(1), 'icu', 'd1'] })).code, 403);
    assert.equal((await run(doc, { fn: 'nope' })).code, 404);
    assert.equal((await run(doc, { fn: 'constructor' })).code, 404);
    const ok = await run(chief, { fn: 'assign', args: [nd(1), 'icu', 'd1'], snap: true });
    assert.equal(ok.code, 200); assert.ok(ok.body.snap && ok.body.snap.tables.shifts);
    const bad = await run(chief, { fn: 'assign', args: [nd(2), 'icu', 'd1'] });
    assert.equal(bad.code, 400); assert.match(bad.body.error, /תורנות אתמול/);
    const gone = auth.issue({ role: 'doctor', did: 'nobody' });
    const r401 = await run(gone, { fn: 'snapshot' });
    assert.equal(r401.code, 401); assert.match(String(r401.headers['Set-Cookie']), /Max-Age=0/, 'cookie נמחק');
  }

  /* ---- תזכורת אוטומטית (api/cron.js) ---- */
  {
    const mem = setup({ submissions: F.DOCTORS.filter(d => !['d4', 'd11'].includes(d.id)).map(d => ({ id: keyOf(d.id, next), doctor_id: d.id, month: next, submitted_at: 'x' })) });
    const dl = mem.m.months.find(x => x.id === next).deadline;          // היום + 3
    let r = await tick(Date.parse(R.addDays(dl, -5) + 'T08:00:00Z'));
    assert.deepEqual(r.sent, [], 'מוקדם מדי');
    r = await tick(Date.parse(R.addDays(dl, -2) + 'T08:00:00Z'));
    assert.deepEqual(r.sent, [{ month: next, doctors: 2 }]);
    assert.deepEqual(mem.m.notifications.filter(n => /^תזכורת:/.test(n.text)).map(n => n.to).sort(), ['d11', 'd4']);
    assert.ok(mem.m.notifications.some(n => n.to === 'chief' && /2 רופאים/.test(n.text)));
    r = await tick(Date.parse(R.addDays(dl, -1) + 'T08:00:00Z'));
    assert.deepEqual(r.sent, [], 'פעם אחת למועד');
    r = await tick(Date.parse(R.addDays(dl, 1) + 'T08:00:00Z'));
    assert.deepEqual(r.sent, [], 'אחרי המועד — לא');
    mem.m.settings.find(x => x.key === 'reminder_days').value = 0;
    assert.equal((await tick(Date.parse(R.addDays(dl, -1) + 'T08:00:00Z'))).off, true);
    const rm = await call(CHIEF, 'remind', next);
    assert.equal(rm.sent, 2);
  }

  console.log('✔ api: snapshot לפי תפקיד, אילוצים ומועד, שיבוץ וכללים, מחזור חודש, החלפות, התראות, הגדרות, זהות, rpc ותזכורת');
})().catch(e => { console.error('✖ ' + (e && e.stack || e)); process.exit(1) });

function D10(){ return { role: 'doctor', did: 'd10' } }
