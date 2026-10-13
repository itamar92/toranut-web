/**
 * scripts/push.js — הקמת התראות האפליקציה (Web Push).
 * ---------------------------------------------------
 *   npm run push keys
 *        מדפיס זוג מפתחות VAPID חדש. שתי השורות → משתני הסביבה (.env מקומית, ו-Environment
 *        Variables ב-Vercel), ופריסה מחדש. **פעם אחת**: החלפת מפתחות מבטלת את כל המכשירים
 *        שכבר הופעלו, וכל אחד יצטרך להפעיל מחדש ("איך זה עובד" ← התראות).
 *   npm run push check
 *        האם המפתחות שבסביבה תקינים ושייכים זה לזה, ומה ה-subject שיישלח לשירותי ה-push.
 *
 * אופציונלי: VAPID_SUBJECT — mailto: או https: שדרכו שירות ה-push פונה אם משהו משתבש.
 * ברירת המחדל היא כתובת האתר (SITE_URL, או זו של Vercel).
 */
require('./env');
const webpush = require('../lib/webpush');

const cmd = process.argv[2];

if (cmd === 'keys'){
  const k = webpush.generateKeys();
  console.log('VAPID_PUBLIC_KEY=' + k.publicKey);
  console.log('VAPID_PRIVATE_KEY=' + k.privateKey);
} else if (cmd === 'check'){
  if (!webpush.enabled()){
    console.error(process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PRIVATE_KEY
      ? 'המפתחות שבסביבה לא תקינים, או שהפרטי לא שייך לציבורי.' : 'אין VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY בסביבה. npm run push keys');
    process.exit(1);
  }
  console.log('תקין. subject: ' + webpush.subject());
} else {
  console.log('שימוש: npm run push keys | npm run push check');
}
