/**
 * scripts/icons.js — אייקוני ה-PWA בלי ספריות: ריבוע מעוגל בצבע המותג עם צלב לבן (כמו הלוגו באב-טיפוס).
 *   node scripts/icons.js   → public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png, icon.svg
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const BG = [0x0b, 0x6e, 0x75], FG = [0xff, 0xff, 0xff];

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
/** opts.radius — עיגול הפינות (חלק מהגודל; 0 = מלא, למסכה); opts.cross — גודל הצלב */
function draw(size, opts){
  const SS = 4, pix = Buffer.alloc(size * size * 4), r = opts.radius * size, c = size / 2;
  const arm = opts.cross * size / 2, thick = opts.cross * size * 0.17;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++){
    let bg = 0, fg = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++){
      const px = x + (sx + .5) / SS, py = y + (sy + .5) / SS;
      const dx = Math.max(r - px, px - (size - r), 0), dy = Math.max(r - py, py - (size - r), 0);
      if (dx * dx + dy * dy > r * r) continue;
      bg++;
      const ax = Math.abs(px - c), ay = Math.abs(py - c);
      if ((ax <= thick && ay <= arm) || (ay <= thick && ax <= arm)) fg++;
    }
    const n = SS * SS, a = bg / n, f = bg ? fg / bg : 0, i = (y * size + x) * 4;
    for (let k = 0; k < 3; k++) pix[i + k] = Math.round(BG[k] * (1 - f) + FG[k] * f);
    pix[i + 3] = Math.round(a * 255);
  }
  return png(size, pix);
}
const out = path.join(__dirname, '..', 'public');
fs.writeFileSync(path.join(out, 'icon-192.png'), draw(192, { radius: .22, cross: .52 }));
fs.writeFileSync(path.join(out, 'icon-512.png'), draw(512, { radius: .22, cross: .52 }));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), draw(512, { radius: 0, cross: .4 }));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), draw(180, { radius: 0, cross: .5 }));
fs.writeFileSync(path.join(out, 'icon.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0b6e75"/>' +
  '<path d="M41.2 24h17.6v17.2H76v17.6H58.8V76H41.2V58.8H24V41.2h17.2z" fill="#fff"/></svg>\n');
console.log('✔ אייקונים ב-public/');
