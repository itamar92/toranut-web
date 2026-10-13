/**
 * scripts/icons.js — אייקוני ה-PWA בלי ספריות: בניין בית חולים לבן עם צלב אדום (כמו 🏥) על ריבוע מעוגל בצבע המותג.
 *   node scripts/icons.js   → public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png, icon.svg
 * הציור מוגדר פעם אחת (SHAPES, ביחידות 0–100) — ממנו נוצרים גם ה-SVG וגם ה-PNG, כך שהם תמיד זהים.
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const BG = '#0b6e75', WHITE = '#ffffff', RED = '#e0383e';

/** מלבנים {x, y, w, h, r (עיגול פינות), fill}, לפי סדר הציור. הבניין: גוף מרכזי גבוה, שני אגפים, חלונות, דלת וצלב */
const SHAPES = [
  { x: 14, y: 46, w: 72, h: 36, r: 3, fill: WHITE },          // אגפים
  { x: 30, y: 18, w: 40, h: 64, r: 4, fill: WHITE },          // גוף מרכזי
  { x: 19, y: 53, w: 7, h: 7, r: 1.5, fill: BG }, { x: 19, y: 66, w: 7, h: 7, r: 1.5, fill: BG },   // חלונות — אגף ימין
  { x: 74, y: 53, w: 7, h: 7, r: 1.5, fill: BG }, { x: 74, y: 66, w: 7, h: 7, r: 1.5, fill: BG },   // חלונות — אגף שמאל
  { x: 43, y: 64, w: 14, h: 18, r: 2, fill: BG },             // דלת
  { x: 45.5, y: 25, w: 9, h: 31, r: 1.5, fill: RED },         // צלב
  { x: 34.5, y: 36, w: 31, h: 9, r: 1.5, fill: RED }
];

function svg(){
  const n = v => +v.toFixed(2);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="' + BG + '"/>' +
    SHAPES.map(s => '<rect x="' + n(s.x) + '" y="' + n(s.y) + '" width="' + n(s.w) + '" height="' + n(s.h) + '"' + (s.r ? ' rx="' + n(s.r) + '"' : '') + ' fill="' + s.fill + '"/>').join('') + '</svg>\n';
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 });
function crc32(buf){ let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pix){
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++){ raw[y * (size * 4 + 1)] = 0; pix.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4) }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
/** האם הנקודה בתוך מלבן מעוגל */
function inside(px, py, x, y, w, h, r){
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const dx = Math.max(x + r - px, px - (x + w - r), 0), dy = Math.max(y + r - py, py - (y + h - r), 0);
  return dx * dx + dy * dy <= r * r;
}
/**
 * opts.radius — עיגול פינות הרקע (חלק מהגודל; 0 = מלא, למסכה ול-iOS שמעגל בעצמו);
 * opts.scale — הקטנת הציור סביב המרכז (מסכה: התוכן חייב להיכנס לעיגול הבטוח של 80%)
 */
function draw(size, opts){
  const SS = 4, pix = Buffer.alloc(size * size * 4), u = size / 100, R = opts.radius * size, k = opts.scale || 1;
  const shapes = SHAPES.map(s => ({ x: 50 + (s.x - 50) * k, y: 50 + (s.y - 50) * k, w: s.w * k, h: s.h * k, r: s.r * k, c: rgb(s.fill) }));
  const bg = rgb(BG);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++){
    let cover = 0; const acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++){
      const px = x + (sx + .5) / SS, py = y + (sy + .5) / SS;
      if (!inside(px, py, 0, 0, size, size, R)) continue;
      cover++;
      let c = bg;
      for (const s of shapes) if (inside(px / u, py / u, s.x, s.y, s.w, s.h, s.r)) c = s.c;
      for (let i = 0; i < 3; i++) acc[i] += c[i];
    }
    const i = (y * size + x) * 4;
    for (let j = 0; j < 3; j++) pix[i + j] = cover ? Math.round(acc[j] / cover) : 0;
    pix[i + 3] = Math.round(cover / (SS * SS) * 255);
  }
  return png(size, pix);
}

if (require.main === module){
  const out = path.join(__dirname, '..', 'public');
  fs.writeFileSync(path.join(out, 'icon-192.png'), draw(192, { radius: .22 }));
  fs.writeFileSync(path.join(out, 'icon-512.png'), draw(512, { radius: .22 }));
  fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), draw(512, { radius: 0, scale: .76 }));
  fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), draw(180, { radius: 0, scale: .92 }));
  fs.writeFileSync(path.join(out, 'icon.svg'), svg());
  console.log('✔ אייקונים ב-public/');
}
module.exports = { draw, svg, SHAPES };
