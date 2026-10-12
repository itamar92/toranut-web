/**
 * test/fixtures.js — נתוני הדוגמה של האב-טיפוס (שמות לדוגמה): 3 עמדות, 18 רופאים, הסמכות ואילוצים קבועים.
 * משותף לבדיקות ולשרת הפיתוח. שורות בצורת הטבלאות של lib/schema.js.
 */
const { keyOf } = require('../lib/schema');
const R = require('../lib/rules');

const STATIONS = [
  { id: 'scopus', name: 'הר הצופים', short: 'הר״צ', color: 1, active: true, sort: 1 },
  { id: 'cardio', name: 'מחלקת קרדיולוגיה', short: 'קרדיו׳', color: 2, active: true, sort: 2 },
  { id: 'icu', name: 'יחידת טיפול נמרץ', short: 'טנ״מ', color: 3, active: true, sort: 3 }
];
const LETTER = { s: 'scopus', c: 'cardio', i: 'icu' };
// [id, שם, הסמכות (s=הר״צ c=קרדיו i=טנ״מ), צ׳יף]
const PEOPLE = [
  ['d1', 'נועה ברק', 'sci'], ['d2', 'יונתן לוי', 'c'], ['d3', 'מאיה כהן', 'sci', true], ['d4', 'עומר שפירא', 'sc'],
  ['d5', 'תמר אברהמי', 'sci'], ['d6', 'דניאל רוזן', 'ci'], ['d7', 'שירה מזרחי', 'c'], ['d8', 'איתי פרידמן', 'sci'],
  ['d9', 'הילה גולן', 'sc'], ['d10', 'רועי אדלר', 'sci'], ['d11', 'ליאור חדד', 'ci'], ['d12', 'יעל נחמיאס', 'sci'],
  ['d13', 'אסף בן־דוד', 'c'], ['d14', 'מיכל שטרן', 'sci'], ['d15', 'גיא פלד', 'sci'], ['d16', 'רונית אלון', 'ci'],
  ['d17', 'עידו ברנע', 'sc'], ['d18', 'דנה קציר', 'sci']
];
const DOCTORS = PEOPLE.map(([id, name, , chief], i) => ({ id, name, email: 'doctor' + (i + 1) + '@example.com', login_code_hash: '', active: true, role: chief ? 'chief' : 'doctor', phone: '' }));
const QUALIFICATIONS = [];
PEOPLE.forEach(([id, , q]) => q.split('').forEach(l => QUALIFICATIONS.push({ id: keyOf(id, LETTER[l]), doctor_id: id, station_id: LETTER[l] })));
// ימים קבועים: 0=ראשון … 6=שבת
const FIXED = [['d2', 2, 'no', 'מרפאה'], ['d7', 4, 'no', 'לימודים'], ['d9', 0, 'prefer', ''], ['d12', 6, 'no', 'שומרת שבת'], ['d16', 1, 'no', 'מרפאה']]
  .map(([d, wd, s, note]) => ({ id: keyOf(d, wd), doctor_id: d, weekday: wd, status: s, note }));

/** אילוצים חודשיים אקראיים (2–4 "לא יכול/ה" ו-1–2 "מעדיף/ה שלא" לרופא/ה), כמו באב-טיפוס */
function randomConstraints(month, rnd, docIds){
  const days = R.daysOf(month), out = {};
  (docIds || DOCTORS.map(d => d.id)).forEach(id => {
    const n = 2 + Math.floor(rnd() * 3), p = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) out[keyOf(id, days[Math.floor(rnd() * days.length)])] = 'no';
    for (let i = 0; i < p; i++){ const k = keyOf(id, days[Math.floor(rnd() * days.length)]); if (!out[k]) out[k] = 'prefer' }
  });
  return Object.keys(out).map(k => { const [doctor_id, date] = k.split('|'); return { id: k, doctor_id, date, status: out[k], updated_at: '' } });
}

module.exports = { STATIONS, DOCTORS, QUALIFICATIONS, FIXED, randomConstraints };
