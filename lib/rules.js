/**
 * lib/rules.js — מנוע הכללים לצד השרת. הקוד עצמו ב-public/rules.js, כי גם הדפדפן טוען אותו
 * (חלונית המועמדים מדרגת בלי לחכות לשרת). קובץ אחד = אותם חוקים בשני הצדדים.
 * Vercel אורז את public/rules.js עם הפונקציות כי הוא נטען כאן ב-require.
 */
module.exports = require('../public/rules.js');
