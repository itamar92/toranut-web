# toranut-web — תורנויות רופאים

אפליקציית web לקביעת תורנויות רופאים במחלקה: לוח חודשי, יומן אילוצים לכל רופא/ה, שיבוץ ידני עם המלצות וחסימות, שיבוץ אוטומטי, פרסום והתראות. **Google Sheets כבסיס נתונים, Vercel כשרת, קובץ HTML אחד כממשק** — אותה תשתית כמו `itamar92/Platoon-web`.

- **`HANDOFF.md`** — כל מה שסוכם בתכנון, ובסופו (סעיף 11) מה נבנה ואילו החלטות מימוש התקבלו. **להתחיל מכאן.**
- **`docs/prototype.html`** — האב-טיפוס המאושר (נתוני דוגמה, בלי שרת).

## הרצה מקומית (בלי Google)

```bash
npm run dev
```

פותחים http://localhost:8787. שרת הפיתוח (`test/devserver.js`) מריץ את ה-API האמיתי על DB בזיכרון עם מחלקה לדוגמה: החודש הקודם והנוכחי פורסמו, הבא פתוח לאילוצים.
קודים: **צ׳יף `0000`** · **רופא/ה `1001`…`1018`** (d1 = נועה ברק). `/dev/cron?now=2026-10-19` מריץ את התזכורת האוטומטית בתאריך שבוחרים.

```bash
npm test
```

בלי framework: `node test/<name>.test.js`. מנוע הכללים (`test/rules.test.js`) ממלא חודשים שלמים ובודק שאין הפרה ושהאיזון בטווח.

## הקמה מול Google Sheets

1. `cp .env.example .env` וממלאים: Service Account (אותו אחד מ-Platoon-web), `SHEET_ID` של גיליון ריק ששותף עם ה-Service Account כעורך, `SESSION_SECRET` (לפחות 16 תווים), `CHIEF_CODE`.
2. `npm run setup` — יוצר את הטבלאות ומזין עמדות ברירת מחדל.
3. `npm run smoke` — בודק שהשרת קורא את הגיליון. `npm run dev:sheet` — האתר מקומית (http://localhost:8787) מול הגיליון האמיתי, לפני Vercel.
4. נכנסים לאתר בקוד הצ׳יף ← **הגדרות** ← מוסיפים רופאים (שם + מייל Google), מסמנים הסמכות ואת הצ׳יף, ומנפיקים קודים למי שצריך. אפשר גם ישירות בגיליון בטאב `doctors`, ואז `npm run code -- "<שם>"`.
5. **כניסה עם Google:** ב-Google Cloud (אותו פרויקט) ← Credentials ← OAuth client ID מסוג Web application. Authorized JavaScript origins: כתובת ה-Vercel ו-`http://localhost:8787`. מעתיקים את ה-Client ID ל-`GOOGLE_CLIENT_ID`.
6. **התראות לטלפון:** `npm run push keys` מדפיס `VAPID_PUBLIC_KEY` ו-`VAPID_PRIVATE_KEY` — ל-`.env` ול-Vercel, **פעם אחת** (החלפה מנתקת את כל המכשירים). `npm run push check` בודק אותם. כל רופא/ה מוסיף/ה את האפליקציה למסך הבית, פותח/ת מהאייקון ומפעיל/ה התראות (באנר למעלה, או "איך זה עובד"). באייפון נדרש iOS 16.4 ומעלה. בשרת הפיתוח אין התראות (אין https ו-Service Worker).

## פריסה ל-Vercel

מייבאים את הריפו ב-Vercel (Framework: Other, בלי build), ומעתיקים את משתני `.env` ל-Environment Variables. הממשק מוגש מ-`public/`, הפונקציות מ-`api/`.
לתזכורת האוטומטית: ב-cron-job.org (או כל מתזמן) קריאה יומית `POST https://<האתר>/api/cron` עם `Authorization: Bearer <CRON_SECRET>`.

## מבנה

```
lib/gsheets.js  lib/db.js      Sheets ב-fetch גולמי + שכבת טבלאות (מ-Platoon-web)
lib/schema.js   lib/bootstrap.js   הטבלאות (HANDOFF 5) ויצירתן בגיליון
public/rules.js (lib/rules.js)  מנוע הכללים והשיבוץ — אותו קובץ בדפדפן ובשרת
lib/auth.js     api/login.js    cookie חתום, קוד אישי / קוד צ׳יף / Google
lib/api.js      api/rpc.js      פונקציות השרת וההרשאות
lib/webpush.js  lib/push.js     Web Push בלי ספרייה (מ-Platoon-web) + למי כל התראה מגיעה
api/cron.js                     תזכורת לפני המועד האחרון
public/index.html               הממשק (מתוך האב-טיפוס), PWA עם sw.js
test/                           בדיקות, שרת פיתוח, נתוני דוגמה
scripts/                        setup · smoke · code · icons · push
```
