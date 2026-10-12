// טוען .env לתוך process.env בלי ספרייה חיצונית.
// ערך במירכאות יכול להימשך על כמה שורות — כמו GOOGLE_PRIVATE_KEY ב-.env.example, שמודבק מקובץ ה-JSON
// של ה-Service Account עם ירידות שורה אמיתיות. בלי זה נקראה רק השורה הראשונה ("-----BEGIN PRIVATE KEY-----"),
// ו-Node נפל ב-"DECODER routines::unsupported".
const fs = require('fs'), path = require('path');

/** טקסט של .env → {KEY: value}. תומך ב-# להערות, במירכאות כפולות ובודדות, בערך מרובה שורות ובסופי שורה של Windows */
function parse(text){
  const out = {}, lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++){
    const line = lines[i];
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    let v = m[2].trim();
    const q = v.charAt(0);
    if ((q === '"' || q === "'") && !(v.length > 1 && v.endsWith(q))){
      // מירכאות שנפתחו ולא נסגרו בשורה הזו — ממשיכים עד השורה שנגמרת בהן
      const acc = [v.slice(1)];
      let closed = false;
      while (++i < lines.length){
        const l = lines[i].replace(/\s+$/, '');
        if (l.endsWith(q)){ acc.push(l.slice(0, -1)); closed = true; break }
        acc.push(l);
      }
      if (!closed) throw new Error('.env: המירכאות של ' + m[1] + ' לא נסגרו');
      v = acc.join('\n');
    } else if ((q === '"' || q === "'") && v.length > 1 && v.endsWith(q)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const p = path.join(__dirname, '..', '.env');
if (fs.existsSync(p)){
  const vals = parse(fs.readFileSync(p, 'utf8'));
  Object.keys(vals).forEach(k => { if (process.env[k] === undefined) process.env[k] = vals[k] });
}

module.exports = { parse };
