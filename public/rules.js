/**
 * public/rules.js — מנוע הכללים והשיבוץ (HANDOFF.md סעיף 4). טהור: בלי רשת, בלי DOM, בלי שעון.
 * ----------------------------------------------------------------------------------------------
 * קובץ אחד לשני הצדדים: הדפדפן טוען אותו כ-<script src="/rules.js"> (window.Rules) — כדי שחלונית
 * המועמדים תדרג מיד, בלי לחכות לשרת — והשרת טוען אותו דרך lib/rules.js, ובודק בו כל שיבוץ לפני
 * שהוא נכתב. כך אין שתי גרסאות של אותם חוקים. הבדיקות: test/rules.test.js.
 *
 * תאריכים הם מחרוזות ISO (YYYY-MM-DD) וכל החשבון ב-UTC, כדי שאזור הזמן של השרת לא יזיז יום.
 *
 *   const m = Rules.model({ stations, doctors, qualifications, fixed_constraints, constraints, shifts, holidays })
 *   Rules.evaluate(m, doctorId, '2026-11-06', 'icu')  → { ok, hard[], codes[], soft[], score }
 *   Rules.autoAssign(m, '2026-11')                    → { assigned[], unfilled[] }   (משנה את m)
 */
(function (root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function (){
'use strict';

const WD = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const WDFULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/* ---------- תאריכים ---------- */
const pad = n => String(n).padStart(2, '0');
const S = v => String(v == null ? '' : v).trim();
function utc(iso){ const p = S(iso).split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] || 1)) }
function isoOf(dt){ return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()) }
function addDays(iso, n){ const t = utc(iso); t.setUTCDate(t.getUTCDate() + n); return isoOf(t) }
function weekday(iso){ return utc(iso).getUTCDay() }
function isIso(v){ return /^\d{4}-\d{2}-\d{2}$/.test(S(v)) && isoOf(utc(v)) === S(v) }
function isMonth(v){ return /^\d{4}-(0[1-9]|1[0-2])$/.test(S(v)) }
function monthOf(iso){ return S(iso).slice(0, 7) }
function addMonths(month, n){ const p = month.split('-').map(Number); const t = new Date(Date.UTC(p[0], p[1] - 1 + n, 1)); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) }
function daysOf(month){
  const p = month.split('-').map(Number), out = [];
  for (let d = 1; d <= 31; d++){ const t = new Date(Date.UTC(p[0], p[1] - 1, d)); if (t.getUTCMonth() !== p[1] - 1) break; out.push(isoOf(t)) }
  return out;
}
function fmtShort(iso){ const t = utc(iso); return t.getUTCDate() + '.' + (t.getUTCMonth() + 1) }
function monthLabel(month){ const p = month.split('-').map(Number); return MONTHS[p[1] - 1] + ' ' + p[0] }
/** TRUE של Sheets, true, 'true', 1. ריק = ברירת המחדל (dflt) — רופא/ה שנוסף/ה ידנית בגיליון בלי active נחשב/ת פעיל/ה */
function truthy(v, dflt){
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = S(v).toUpperCase();
  if (!s) return !!dflt;
  return s === 'TRUE' || s === '1' || s === 'YES' || s === 'כן';
}

/* ---------- לוח עברי וחגים ---------- */
// חג וערב חג נספרים כסופ״ש (HANDOFF סעיף 2). המפתחות הם "חודש יום" בלוח העברי, באנגלית.
const HOLIDAYS = { 'Tishri 1': 'ראש השנה', 'Tishri 2': 'ראש השנה', 'Tishri 10': 'יום כיפור', 'Tishri 15': 'סוכות', 'Tishri 22': 'שמחת תורה', 'Nisan 15': 'פסח', 'Nisan 21': 'שביעי של פסח', 'Sivan 6': 'שבועות' };
const EVES = { 'Elul 29': 'ערב ראש השנה', 'Tishri 9': 'ערב יום כיפור', 'Tishri 14': 'ערב סוכות', 'Tishri 21': 'ערב שמחת תורה', 'Nisan 14': 'ערב פסח', 'Nisan 20': 'ערב שביעי של פסח', 'Sivan 5': 'ערב שבועות' };
let hebParts = null, hebFmt = null;
try { hebParts = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', timeZone: 'UTC' }) } catch (e) {}
try { hebFmt = new Intl.DateTimeFormat('he-u-ca-hebrew-nu-hebr', { day: 'numeric', month: 'long', timeZone: 'UTC' }) } catch (e) {}
const autoCache = {};
function autoInfo(iso){
  if (autoCache[iso]) return autoCache[iso];
  let hk = '', heb = '';
  const t = utc(iso);
  if (hebParts){
    const p = hebParts.formatToParts(t);
    let mo = (p.find(x => x.type === 'month') || {}).value || '';
    if (/^Tishr/.test(mo)) mo = 'Tishri';
    hk = mo + ' ' + ((p.find(x => x.type === 'day') || {}).value || '');
  }
  if (hebFmt){ try { heb = hebFmt.format(t) } catch (e) {} }
  return (autoCache[iso] = { hol: HOLIDAYS[hk] || null, eve: EVES[hk] || null, heb });
}
/**
 * מה יש ביום: hol (שם חג, ידני קודם), eve (ערב חג), heavy (שישי, שבת, חג, ערב חג או יום ידני), heb (התאריך העברי).
 * manual — מפה date → שם, מטבלת holidays.
 */
function dayInfo(iso, manual){
  const a = autoInfo(iso), wd = weekday(iso);
  const man = manual && manual[iso] ? manual[iso] : null;
  const hol = man || a.hol;
  return { hol, eve: hol ? null : a.eve, manual: !!man, heavy: !!hol || !!a.eve || wd === 5 || wd === 6, heb: a.heb, wd };
}

/* ---------- המודל: אינדקסים מעל שורות הטבלאות ---------- */
function model(data){
  data = data || {};
  const stations = (data.stations || []).filter(s => S(s.id) && truthy(s.active, true))
    .map(s => ({ id: S(s.id), name: S(s.name) || S(s.id), short: S(s.short) || S(s.name).slice(0, 5), color: Number(s.color) || 1, sort: Number(s.sort) || 0 }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'he'));
  const doctors = (data.doctors || []).filter(d => S(d.id))
    .map(d => ({ id: S(d.id), name: S(d.name) || S(d.id), active: truthy(d.active, true), chief: S(d.role) === 'chief' }));
  const m = {
    stations, doctors,
    stById: {}, docById: {},
    quals: {},                 // 'doc|st' → true
    fixed: {},                 // doc → { weekday → { s, note } }
    cons: {},                  // 'doc|date' → 'no' | 'prefer'
    sched: {},                 // date → { st → doc }
    locks: {},                 // 'date|st' → true
    holidays: {}               // date → שם
  };
  (data.stations || []).forEach(s => { if (S(s.id)) m.stById[S(s.id)] = { id: S(s.id), name: S(s.name) || S(s.id), short: S(s.short) || S(s.name).slice(0, 5), color: Number(s.color) || 1 } });
  doctors.forEach(d => m.docById[d.id] = d);
  (data.qualifications || []).forEach(q => { if (S(q.doctor_id) && S(q.station_id)) m.quals[S(q.doctor_id) + '|' + S(q.station_id)] = true });
  (data.fixed_constraints || []).forEach(f => {
    const st = S(f.status), wd = Number(f.weekday);
    if ((st !== 'no' && st !== 'prefer') || !(wd >= 0 && wd <= 6) || S(f.weekday) === '') return;
    (m.fixed[S(f.doctor_id)] = m.fixed[S(f.doctor_id)] || {})[wd] = { s: st, note: S(f.note) };
  });
  (data.constraints || []).forEach(c => { const st = S(c.status); if (st === 'no' || st === 'prefer') m.cons[S(c.doctor_id) + '|' + S(c.date)] = st });
  (data.shifts || []).forEach(r => {
    const date = S(r.date), st = S(r.station_id);
    if (!date || !st) return;
    if (S(r.doctor_id)) (m.sched[date] = m.sched[date] || {})[st] = S(r.doctor_id);
    if (truthy(r.locked)) m.locks[date + '|' + st] = true;
  });
  (data.holidays || []).forEach(h => { if (isIso(h.date) && S(h.name)) m.holidays[S(h.date)] = S(h.name) });
  return m;
}
const activeDocs = m => m.doctors.filter(d => d.active);
const stName = (m, id) => (m.stById[id] || { name: id }).name;

/* ---------- שאילתות ---------- */
function info(m, iso){ return dayInfo(iso, m.holidays) }
/** האילוץ של רופא/ה ביום: קבוע (לפי יום בשבוע) קודם לחודשי. null = פנוי/ה */
function constraintOf(m, docId, iso){
  const f = (m.fixed[docId] || {})[weekday(iso)];
  if (f) return { s: f.s, fixed: true, note: f.note };
  const c = m.cons[docId + '|' + iso];
  return c ? { s: c, fixed: false } : null;
}
function slotOf(m, iso){ return m.sched[iso] || {} }
function hasShift(m, docId, iso){ const s = m.sched[iso]; if (!s) return false; for (const k in s) if (s[k] === docId) return true; return false }
function hasHeavy(m, docId, iso){ return hasShift(m, docId, iso) && info(m, iso).heavy }
function isLocked(m, iso, st){ return !!m.locks[iso + '|' + st] }
function setSlot(m, iso, st, docId){
  if (docId){ (m.sched[iso] = m.sched[iso] || {})[st] = docId }
  else if (m.sched[iso]){ delete m.sched[iso][st] }
}
function setLock(m, iso, st, on){ if (on) m.locks[iso + '|' + st] = true; else delete m.locks[iso + '|' + st] }
/** סיכום החודש לרופא/ה: total, heavy (סופ״ש/חג), by (לפי עמדה) */
function stats(m, docId, month){
  const r = { total: 0, heavy: 0, by: {} };
  for (const iso of daysOf(month)){
    const s = m.sched[iso]; if (!s) continue;
    let hv = null;
    for (const st in s) if (s[st] === docId){
      if (hv === null) hv = info(m, iso).heavy;
      r.total++; if (hv) r.heavy++; r.by[st] = (r.by[st] || 0) + 1;
    }
  }
  return r;
}

/* ---------- הכללים ---------- */
/**
 * האם אפשר לשבץ את docId ב-st ביום iso, ובאיזה מחיר.
 * hard — חסימות (ok=false): לא מוסמך/ת · "לא יכול/ה" (חודשי או קבוע) · כבר משובץ/ת היום · תורנות אתמול/מחר.
 * soft — הסברים לציון (נמוך = טוב): מעדיף/ה שלא +40 · סופ״ש/חג במרחק 2–9 ימים +35 · רק יום מנוחה אחד +20 ·
 *        +8 לכל תורנות החודש · ביום כבד: +18 לכל סופ״ש/חג החודש.
 * codes — מזהים קבועים ל-hard, באותו סדר (unqualified, no, fixed_no, same_day, yesterday, tomorrow).
 */
function evaluate(m, docId, iso, st){
  const dinfo = info(m, iso), hard = [], codes = [], soft = [];
  let score = 0;
  if (!m.quals[docId + '|' + st]){ hard.push('לא מוסמך/ת ל' + stName(m, st)); codes.push('unqualified') }
  const c = constraintOf(m, docId, iso);
  if (c && c.s === 'no'){
    hard.push(c.fixed ? 'אילוץ קבוע' + (c.note ? ': ' + c.note : ' ביום ' + WDFULL[dinfo.wd]) : 'סימן/ה "לא יכול/ה"');
    codes.push(c.fixed ? 'fixed_no' : 'no');
  }
  const s = slotOf(m, iso);
  for (const k in s) if (k !== st && s[k] === docId){ hard.push('כבר משובץ/ת היום ב' + stName(m, k)); codes.push('same_day') }
  if (hasShift(m, docId, addDays(iso, -1))){ hard.push('תורנות אתמול'); codes.push('yesterday') }
  if (hasShift(m, docId, addDays(iso, 1))){ hard.push('תורנות מחר'); codes.push('tomorrow') }
  if (dinfo.heavy){
    for (let n = 2; n <= 9; n++){
      const a = hasHeavy(m, docId, addDays(iso, -n)), b = hasHeavy(m, docId, addDays(iso, n));
      if (a || b){ score += 35; soft.push('סופ״ש/חג בשבוע הסמוך (' + fmtShort(a ? addDays(iso, -n) : addDays(iso, n)) + ')'); break }
    }
  }
  if (c && c.s === 'prefer'){ score += 40; soft.push(c.fixed ? 'מעדיף/ה שלא (קבוע)' : 'מעדיף/ה שלא') }
  if (hasShift(m, docId, addDays(iso, -2)) || hasShift(m, docId, addDays(iso, 2))){ score += 20; soft.push('רק יום מנוחה אחד') }
  const sm = stats(m, docId, monthOf(iso));
  score += sm.total * 8; if (dinfo.heavy) score += sm.heavy * 18;
  soft.push(sm.total ? sm.total + ' תורנויות החודש' : 'עדיין בלי תורנות החודש');
  if (dinfo.heavy && sm.heavy) soft.push(sm.heavy + ' סופ״ש/חג החודש');
  return { ok: hard.length === 0, hard, codes, soft, score };
}
const tierOf = score => score < 15 ? ['t1', 'מומלץ'] : score < 45 ? ['t2', 'אפשרי'] : ['t3', 'פחות מומלץ'];
function candCount(m, iso, st){ return activeDocs(m).filter(d => evaluate(m, d.id, iso, st).ok).length }
/** כל הרופאים הפעילים מול משבצת: ok ממוינים לפי ציון, ואחריהם החסומים */
function rank(m, iso, st){
  const rows = activeDocs(m).map(d => ({ doc: d, ev: evaluate(m, d.id, iso, st) }));
  return { ok: rows.filter(r => r.ev.ok).sort((a, b) => a.ev.score - b.ev.score), blocked: rows.filter(r => !r.ev.ok) };
}

/* ---------- שיבוץ אוטומטי ---------- */
/** מחולל אקראי עם seed (mulberry32), לשבירת שוויון צפויה בבדיקות */
function seeded(seed){
  let s = seed | 0;
  return function (){ s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 };
}
/**
 * ממלא את המשבצות הריקות שאינן נעולות בחודש (HANDOFF 4): סופ״ש/חג קודם, אחר כך הקשות (מעט מועמדים),
 * אחר כך לפי תאריך. לכל משבצת — הרופא/ה הכשר/ה עם הציון הנמוך (+ רעש קטן). אין כשר = נשאר ריק ומדווח.
 * הציון מחושב מחדש בכל משבצת, ולכן האיזון מתעדכן תוך כדי. משנה את m.
 */
function autoAssign(m, month, opts){
  opts = opts || {};
  const rnd = opts.rnd || Math.random, docs = activeDocs(m), slots = [];
  for (const iso of daysOf(month)){
    const hv = info(m, iso).heavy;
    for (const s of m.stations){
      if (isLocked(m, iso, s.id) || slotOf(m, iso)[s.id]) continue;
      slots.push({ date: iso, station_id: s.id, heavy: hv });
    }
  }
  slots.forEach(sl => { sl.cands = docs.filter(d => evaluate(m, d.id, sl.date, sl.station_id).ok).length });
  slots.sort((a, b) => (b.heavy - a.heavy) || (a.cands - b.cands) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const assigned = [], unfilled = [];
  for (const sl of slots){
    let best = null, bestJ = Infinity;
    for (const d of docs){
      const ev = evaluate(m, d.id, sl.date, sl.station_id);
      if (!ev.ok) continue;
      const j = ev.score + rnd() * 4;
      if (j < bestJ){ bestJ = j; best = d }
    }
    if (!best){ unfilled.push({ date: sl.date, station_id: sl.station_id }); continue }
    setSlot(m, sl.date, sl.station_id, best.id);
    assigned.push({ date: sl.date, station_id: sl.station_id, doctor_id: best.id });
  }
  return { assigned, unfilled };
}

/**
 * בעיות בלוח של החודש: violations — שיבוץ שמפר כלל קשיח (כל הפרה פעם אחת: יום אחרי יום נרשם ביום הראשון,
 * כפילות באותו יום — פעם אחת לרופא/ה ליום), empty — משבצות ריקות.
 */
function issues(m, month){
  const days = daysOf(month), violations = [], empty = [];
  for (const iso of days){
    const s = slotOf(m, iso), seen = {};
    for (const st of m.stations){
      const doc = s[st.id];
      if (!doc){ empty.push({ date: iso, station_id: st.id }); continue }
      const ev = evaluate(m, doc, iso, st.id);
      const firstDay = monthOf(addDays(iso, -1)) !== month;
      const reasons = ev.hard.filter((h, i) => ev.codes[i] !== 'same_day' && !(ev.codes[i] === 'yesterday' && !firstDay));
      if (seen[doc]) reasons.unshift('משובץ/ת פעמיים באותו יום');
      seen[doc] = 1;
      if (reasons.length) violations.push({ date: iso, station_id: st.id, doctor_id: doc, reasons });
    }
  }
  return { violations, empty };
}

return { WD, WDFULL, MONTHS, HOLIDAYS, EVES, S, pad, utc, isoOf, addDays, weekday, isIso, isMonth, monthOf, addMonths, daysOf, fmtShort, monthLabel, truthy,
         dayInfo, model, activeDocs, info, constraintOf, slotOf, hasShift, isLocked, setSlot, setLock, stats, evaluate, tierOf, candCount, rank, seeded, autoAssign, issues };
});
