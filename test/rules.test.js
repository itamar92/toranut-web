/**
 * test/rules.test.js — מנוע הכללים (public/rules.js דרך lib/rules.js): חגים, חסימות, ציון, שיבוץ אוטומטי.
 *   node test/rules.test.js
 */
const assert = require('assert');
const R = require('../lib/rules');
const F = require('./fixtures');

const base = extra => R.model(Object.assign({ stations: F.STATIONS, doctors: F.DOCTORS, qualifications: F.QUALIFICATIONS, fixed_constraints: F.FIXED }, extra || {}));

/* ---- תאריכים ולוח עברי ---- */
assert.deepEqual(R.daysOf('2026-02').length, 28);
assert.equal(R.daysOf('2026-11').length, 30);
assert.equal(R.addDays('2026-10-31', 1), '2026-11-01');
assert.equal(R.addDays('2026-03-01', -1), '2026-02-28');
assert.equal(R.weekday('2026-10-12'), 1);                       // יום שני
assert.equal(R.addMonths('2026-12', 1), '2027-01');
assert.ok(R.isIso('2026-02-28') && !R.isIso('2026-02-30') && !R.isIso('2026-2-3'));
assert.ok(R.isMonth('2026-11') && !R.isMonth('2026-13'));
{
  const rh = R.dayInfo('2026-09-12'), eve = R.dayInfo('2026-09-11'), yk = R.dayInfo('2026-09-21'), st = R.dayInfo('2026-10-03');
  assert.equal(rh.hol, 'ראש השנה'); assert.ok(rh.heavy);
  assert.equal(eve.eve, 'ערב ראש השנה'); assert.ok(eve.heavy);
  assert.equal(yk.hol, 'יום כיפור');
  assert.equal(st.hol, 'שמחת תורה');
  assert.equal(R.dayInfo('2027-04-22').hol, 'פסח');
  assert.equal(R.dayInfo('2027-06-11').hol, 'שבועות');
  assert.equal(R.dayInfo('2027-06-10').eve, 'ערב שבועות');
  const tue = R.dayInfo('2026-10-13');                           // יום שלישי רגיל
  assert.ok(!tue.heavy && !tue.hol && !tue.eve);
  assert.ok(R.dayInfo('2026-10-16').heavy && R.dayInfo('2026-10-17').heavy);   // שישי, שבת
  // יום ידני מטבלת holidays — חג, נספר כסופ״ש
  const man = R.dayInfo('2026-10-13', { '2026-10-13': 'יום הזיכרון למחלקה' });
  assert.equal(man.hol, 'יום הזיכרון למחלקה'); assert.ok(man.heavy && man.manual);
  assert.ok(rh.heb.length > 0, 'תאריך עברי');
}

/* ---- חסימות ---- */
{
  const m = base({ shifts: [{ date: '2026-11-10', station_id: 'cardio', doctor_id: 'd1' }] });
  // יום אחרי יום — חסום בשני הכיוונים, בכל עמדה
  assert.deepEqual(R.evaluate(m, 'd1', '2026-11-11', 'icu').codes, ['yesterday']);
  assert.deepEqual(R.evaluate(m, 'd1', '2026-11-09', 'scopus').codes, ['tomorrow']);
  // כבר משובץ/ת באותו יום בעמדה אחרת
  assert.deepEqual(R.evaluate(m, 'd1', '2026-11-10', 'icu').codes, ['same_day']);
  // אותה משבצת שבה הוא כבר משובץ — לא חוסמת את עצמה
  assert.ok(R.evaluate(m, 'd1', '2026-11-10', 'cardio').ok);
  // יומיים אחרי — מותר, אבל "רק יום מנוחה אחד"
  const two = R.evaluate(m, 'd1', '2026-11-12', 'icu');
  assert.ok(two.ok); assert.ok(two.soft.includes('רק יום מנוחה אחד'));
  // לא מוסמך/ת: יונתן (d2) רק קרדיו
  const uq = R.evaluate(m, 'd2', '2026-11-04', 'icu');
  assert.ok(!uq.ok); assert.deepEqual(uq.codes, ['unqualified']); assert.equal(uq.hard[0], 'לא מוסמך/ת ליחידת טיפול נמרץ');
  // אילוץ קבוע: יונתן לא יכול בימי שלישי (מרפאה)
  const fx = R.evaluate(m, 'd2', '2026-11-03', 'cardio');
  assert.deepEqual(fx.codes, ['fixed_no']); assert.equal(fx.hard[0], 'אילוץ קבוע: מרפאה');
  assert.ok(R.evaluate(m, 'd2', '2026-11-04', 'cardio').ok);
}
{
  // "לא יכול/ה" חודשי
  const m = base({ constraints: [{ doctor_id: 'd5', date: '2026-11-05', status: 'no' }, { doctor_id: 'd5', date: '2026-11-06', status: 'prefer' }] });
  assert.deepEqual(R.evaluate(m, 'd5', '2026-11-05', 'icu').codes, ['no']);
  const p = R.evaluate(m, 'd5', '2026-11-06', 'icu');
  assert.ok(p.ok); assert.ok(p.soft.includes('מעדיף/ה שלא'));
  // הקבוע קודם לחודשי
  const m2 = base({ constraints: [{ doctor_id: 'd2', date: '2026-11-03', status: 'prefer' }] });
  assert.equal(R.constraintOf(m2, 'd2', '2026-11-03').fixed, true);
}

/* ---- ציון ---- */
{
  const m = base();
  // יום רגיל, בלי תורנויות: 0
  assert.equal(R.evaluate(m, 'd1', '2026-11-04', 'icu').score, 0);
  // מעדיף/ה שלא קבוע: הילה (d9) בימי ראשון, +40
  assert.equal(R.evaluate(m, 'd9', '2026-11-01', 'scopus').score, 40);
  assert.deepEqual(R.tierOf(0), ['t1', 'מומלץ']);
  assert.deepEqual(R.tierOf(40), ['t2', 'אפשרי']);
  assert.deepEqual(R.tierOf(45), ['t3', 'פחות מומלץ']);
}
{
  // סופ״ש אחרי סופ״ש: שבת 7.11 משובץ/ת, שישי 13.11 (6 ימים) → +35, ועוד +8 (תורנות) +18 (סופ״ש) החודש
  const m = base({ shifts: [{ date: '2026-11-07', station_id: 'icu', doctor_id: 'd1' }] });
  const ev = R.evaluate(m, 'd1', '2026-11-13', 'icu');
  assert.ok(ev.ok);
  assert.equal(ev.score, 35 + 8 + 18);
  assert.ok(ev.soft.includes('סופ״ש/חג בשבוע הסמוך (7.11)'));
  // יום חול באמצע — רק +8 על התורנות הקיימת
  assert.equal(R.evaluate(m, 'd1', '2026-11-11', 'icu').score, 8);
  // סופ״ש במרחק 10 ימים — לא נחשב סמוך
  assert.equal(R.evaluate(m, 'd1', '2026-11-17', 'icu').score, 8);
}
{
  // חג נספר כסופ״ש: ערב ר״ה (שישי 11.9) ואז ר״ה (שבת 12.9) — חסום (יום אחרי יום); יום כיפור 21.9 — 9 ימים: +35
  const m = base({ shifts: [{ date: '2026-09-12', station_id: 'scopus', doctor_id: 'd1' }] });
  assert.ok(!R.evaluate(m, 'd1', '2026-09-11', 'icu').ok);
  const yk = R.evaluate(m, 'd1', '2026-09-21', 'icu');
  assert.equal(yk.score, 35 + 8 + 18);
}

/* ---- נעילה וניקוי ---- */
{
  const m = base({ shifts: [{ date: '2026-11-02', station_id: 'icu', doctor_id: '', locked: true }, { date: '2026-11-03', station_id: 'icu', doctor_id: 'd8', locked: 'TRUE' }] });
  assert.ok(R.isLocked(m, '2026-11-02', 'icu') && R.isLocked(m, '2026-11-03', 'icu'));
  R.autoAssign(m, '2026-11', { rnd: R.seeded(1) });
  assert.equal(R.slotOf(m, '2026-11-02').icu, undefined, 'משבצת נעולה ריקה נשארת ריקה');
  assert.equal(R.slotOf(m, '2026-11-03').icu, 'd8', 'משבצת נעולה לא מוחלפת');
}

/* ---- שיבוץ אוטומטי: חודש שלם, 18 רופאים, בלי הפרה ---- */
for (const month of ['2026-10', '2026-11', '2026-12', '2027-04']){
  const rnd = R.seeded(20261012);
  const m = base({ constraints: F.randomConstraints(month, rnd) });
  const r = R.autoAssign(m, month, { rnd });
  const days = R.daysOf(month);
  assert.equal(r.assigned.length + r.unfilled.length, days.length * 3);
  assert.equal(r.unfilled.length, 0, month + ': כל המשבצות מלאות');
  const iss = R.issues(m, month);
  assert.deepEqual(iss.violations, [], month + ': אין הפרה של כלל קשיח');
  assert.deepEqual(iss.empty, []);
  const tot = m.doctors.map(d => R.stats(m, d.id, month).total), hv = m.doctors.map(d => R.stats(m, d.id, month).heavy);
  assert.ok(Math.max(...tot) - Math.min(...tot) <= 2, month + ': איזון תורנויות ' + Math.min(...tot) + '–' + Math.max(...tot));
  assert.ok(Math.max(...hv) - Math.min(...hv) <= 2, month + ': איזון סופ״שים ' + Math.min(...hv) + '–' + Math.max(...hv));
  // אף "לא יכול/ה" לא שובץ
  for (const iso of days){ const s = R.slotOf(m, iso); for (const st in s) assert.notEqual((R.constraintOf(m, s[st], iso) || {}).s, 'no') }
}

/* ---- issues: הפרה נרשמת פעם אחת ---- */
{
  const m = base({ shifts: [
    { date: '2026-11-10', station_id: 'cardio', doctor_id: 'd1' }, { date: '2026-11-11', station_id: 'cardio', doctor_id: 'd1' },   // יום אחרי יום
    { date: '2026-11-20', station_id: 'cardio', doctor_id: 'd5' }, { date: '2026-11-20', station_id: 'icu', doctor_id: 'd5' },       // פעמיים באותו יום
    { date: '2026-11-03', station_id: 'cardio', doctor_id: 'd2' }                                                                    // אילוץ קבוע
  ] });
  const v = R.issues(m, '2026-11').violations;
  assert.equal(v.length, 3, JSON.stringify(v));
  assert.deepEqual(v.find(x => x.date === '2026-11-10').reasons, ['תורנות מחר']);
  assert.deepEqual(v.find(x => x.date === '2026-11-20').reasons, ['משובץ/ת פעמיים באותו יום']);
  assert.deepEqual(v.find(x => x.date === '2026-11-03').reasons, ['אילוץ קבוע: מרפאה']);
  // יום אחרי יום מעבר לגבול החודש — נרשם ביום הראשון של החודש
  const m2 = base({ shifts: [{ date: '2026-10-31', station_id: 'icu', doctor_id: 'd1' }, { date: '2026-11-01', station_id: 'icu', doctor_id: 'd1' }] });
  assert.deepEqual(R.issues(m2, '2026-11').violations.map(x => x.reasons), [['תורנות אתמול']]);
}

/* ---- עמדה לא פעילה ורופא/ה לא פעיל/ה לא משתתפים ---- */
{
  const m = R.model({ stations: F.STATIONS.map(s => s.id === 'icu' ? Object.assign({}, s, { active: 'FALSE' }) : s), doctors: F.DOCTORS.map(d => d.id === 'd1' ? Object.assign({}, d, { active: false }) : d),
                      qualifications: F.QUALIFICATIONS, fixed_constraints: F.FIXED });
  const r = R.autoAssign(m, '2026-11', { rnd: R.seeded(3) });
  assert.equal(r.assigned.length, 60);
  assert.ok(r.assigned.every(a => a.station_id !== 'icu' && a.doctor_id !== 'd1'));
}

console.log('✔ rules: לוח עברי, חסימות, ציון, נעילה, שיבוץ אוטומטי מלא בלי הפרות ובאיזון, ודיווח בעיות');
