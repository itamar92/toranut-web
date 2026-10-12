/**
 * lib/schema.js — הטבלאות של תורנויות רופאים. גיליון = טבלה, שורה 1 = כותרות (HANDOFF.md סעיף 5).
 * ------------------------------------------------------------------------------------------------
 * מוסכמות:
 *  • עמודה A היא תמיד id — lib/db.js מאתר שורה לפי עמודה A (update / remove / updateMany).
 *    בטבלאות שהמפתח שלהן טבעי (שיבוץ, אילוץ, הסמכה…) ה-id הוא המפתח עצמו, מחובר ב-"|"
 *    (keyOf למטה), וכך upsert לא צריך חיפוש ושורה כפולה לא יכולה להיווצר בטעות.
 *  • תאריכים — טקסט ISO (2026-11-03). חודש — YYYY-MM. בוליאני — TRUE/FALSE של Sheets.
 *  • weekday — 0=ראשון … 6=שבת. status באילוצים — no (לא יכול/ה) / prefer (מעדיף/ה שלא). "פנוי" = אין שורה.
 */
const TABLES = {
  settings:          ['key', 'value'],
  stations:          ['id', 'name', 'short', 'color', 'active', 'sort'],
  // login_code_hash — הקוד האישי לכניסה בקוד (scrypt, lib/auth.js). role — doctor / chief. email — לכניסת Google
  doctors:           ['id', 'name', 'email', 'login_code_hash', 'active', 'role', 'phone'],
  qualifications:    ['id', 'doctor_id', 'station_id'],                          // id = doctor_id|station_id
  fixed_constraints: ['id', 'doctor_id', 'weekday', 'status', 'note'],           // id = doctor_id|weekday
  constraints:       ['id', 'doctor_id', 'date', 'status', 'updated_at'],        // id = doctor_id|date
  submissions:       ['id', 'doctor_id', 'month', 'submitted_at'],               // id = doctor_id|month
  shifts:            ['id', 'date', 'station_id', 'doctor_id', 'locked', 'note'], // id = date|station_id; שורה לכל משבצת, גם ריקה
  // status — open (פתוח לאילוצים) / scheduling (בשיבוץ) / published (פורסם). חודש בלי שורה = טרם נפתח
  months:            ['id', 'month', 'status', 'deadline', 'published_at'],      // id = month
  holidays:          ['id', 'date', 'name'],                                     // id = date; ידני, מעבר ללוח העברי
  // to — doctor_id, 'chief' או 'all'. read_by — מזהי הרופאים שקראו, מופרדים בפסיק
  notifications:     ['id', 'to', 'text', 'at', 'read_by'],
  // status — open / done / rejected
  swap_requests:     ['id', 'doctor_id', 'date', 'station_id', 'note', 'status', 'created_at'],
  // lib/db.js log כותב בסדר הזה
  log:               ['at', 'who', 'role', 'action', 'entity', 'entity_id', 'before', 'after']
};
const HIDDEN = ['log'];

/** id למפתח טבעי: keyOf('d1', '2026-11-03') → 'd1|2026-11-03' */
const keyOf = (...parts) => parts.map(p => String(p == null ? '' : p).trim()).join('|');

/* צבעי העמדות: 1–6 מתוך הפלטה של הממשק (--c1…--c6). עמדה חדשה מקבלת את הצבע הפנוי הבא */
const COLORS = 6;

const SEED = {
  settings: [
    ['version', 1],
    ['timezone', 'Asia/Jerusalem'],
    ['reminder_days', 2],             // תזכורת אוטומטית (api/cron.js) כמה ימים לפני המועד האחרון. 0 = כבוי
    ['chief_code_hash', '']           // קוד צ׳יף מגובב, אם רוצים אותו בגיליון במקום CHIEF_CODE בסביבה
  ],
  stations: [
    ['scopus', 'הר הצופים', 'הר״צ', 1, true, 1],
    ['cardio', 'מחלקת קרדיולוגיה', 'קרדיו׳', 2, true, 2],
    ['icu', 'יחידת טיפול נמרץ', 'טנ״מ', 3, true, 3]
  ]
};

let idCounter = 0;
function newId(prefix){
  idCounter = (idCounter + 1) % 1296;
  return prefix + '_' + Date.now().toString(36) + idCounter.toString(36).padStart(2, '0');
}

module.exports = { TABLES, HIDDEN, SEED, COLORS, keyOf, newId };
