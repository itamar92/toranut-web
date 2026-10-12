/**
 * test/demo.js — מחלקה לדוגמה סביב היום הנוכחי, לשרת הפיתוח: החודש הקודם והנוכחי פורסמו (שובצו אוטומטית),
 * החודש הבא פתוח לאילוצים (14 מתוך 18 שלחו), והחודש שאחריו טרם נפתח. שמות לדוגמה מהאב-טיפוס.
 * קודים: צ׳יף 0000 (CHIEF_CODE) · רופא/ה dN → 10NN (d1 = 1001 … d18 = 1018).
 */
const R = require('../lib/rules');
const auth = require('../lib/auth');
const { keyOf } = require('../lib/schema');
const F = require('./fixtures');

const NOT_SUBMITTED = ['d4', 'd11', 'd14', 'd17'];

function demoData(today){
  const rnd = R.seeded(20261012);
  const cur = R.monthOf(today), prev = R.addMonths(cur, -1), next = R.addMonths(cur, 1);
  const doctors = F.DOCTORS.map((d, i) => Object.assign({}, d, { login_code_hash: auth.hashCode(String(1001 + i)) }));
  const base = { stations: F.STATIONS, doctors, qualifications: F.QUALIFICATIONS, fixed_constraints: F.FIXED };
  const constraints = [], shifts = [];
  for (const month of [prev, cur]){
    const cons = F.randomConstraints(month, rnd);
    const m = R.model(Object.assign({ constraints: cons, shifts }, base));
    R.autoAssign(m, month, { rnd });
    R.daysOf(month).forEach(d => F.STATIONS.forEach(s => shifts.push({ id: keyOf(d, s.id), date: d, station_id: s.id, doctor_id: R.slotOf(m, d)[s.id] || '', locked: true, note: '' })));
    constraints.push(...cons);
  }
  const subs = doctors.map(d => d.id).filter(id => !NOT_SUBMITTED.includes(id));
  constraints.push(...F.randomConstraints(next, rnd, subs));
  const submissions = [];
  [prev, cur].forEach(month => doctors.forEach(d => submissions.push({ id: keyOf(d.id, month), doctor_id: d.id, month, submitted_at: month + '-01T08:00:00.000Z' })));
  subs.forEach(id => submissions.push({ id: keyOf(id, next), doctor_id: id, month: next, submitted_at: new Date().toISOString() }));
  let deadline = cur + '-20';
  if (deadline < today) deadline = R.addDays(today, 5);
  const ago = d => new Date(Date.now() - d * 86400000).toISOString();
  return Object.assign({}, base, {
    constraints, shifts, submissions,
    months: [
      { id: prev, month: prev, status: 'published', deadline: R.addMonths(prev, -1) + '-20', published_at: R.addMonths(prev, -1) + '-27T10:00:00.000Z' },
      { id: cur, month: cur, status: 'published', deadline: prev + '-20', published_at: prev + '-27T10:00:00.000Z' },
      { id: next, month: next, status: 'open', deadline, published_at: '' }
    ],
    notifications: [
      { id: 'n_1', to: 'all', text: 'הלוח של ' + R.monthLabel(cur) + ' פורסם', at: ago(15), read_by: doctors.map(d => d.id).join(',') + ',chief' },
      { id: 'n_2', to: 'all', text: R.monthLabel(next) + ' נפתח לאילוצים. אפשר למלא עד ' + 'יום ' + R.WDFULL[R.weekday(deadline)] + ' ' + R.fmtShort(deadline), at: ago(10), read_by: '' },
      { id: 'n_3', to: 'chief', text: NOT_SUBMITTED.length + ' רופאים עוד לא מילאו אילוצים ל' + R.monthLabel(next), at: ago(0.1), read_by: '' }
    ]
  });
}

module.exports = { demoData, NOT_SUBMITTED };
