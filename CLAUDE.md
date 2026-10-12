# toranut-web

אפליקציית תורנויות רופאים. לפני כל עבודה לקרוא את `HANDOFF.md` — הוא מקור האמת להחלטות המוצר, לחוקי השיבוץ ולמודל הנתונים (וסעיף 11 — החלטות המימוש). `docs/prototype.html` הוא האב-טיפוס המאושר של הממשק; הממשק האמיתי (`public/index.html`) נבנה ממנו.

כללים:
- התשתית זהה ל-`itamar92/Platoon-web`: Google Sheets כ-DB דרך `lib/gsheets.js` (fetch גולמי, בלי ספריות), `lib/db.js`, Vercel functions ב-`api/`, ממשק בקובץ אחד ב-`public/index.html`, Node 20+, בלי תלויות npm.
- לוגיקת הכללים (`public/rules.js`, נטען בשרת דרך `lib/rules.js`) טהורה ונבדקת ב-`test/` עם `node test/<name>.test.js`; אין framework בדיקות. אותו קובץ משמש את הדפדפן ואת השרת — לא לשכפל כללים.
- עברית בממשק, RTL. שמות טבלאות ועמודות באנגלית כמו ב-`HANDOFF.md` סעיף 5. עמודה A בכל טבלה היא `id`.
- לא לשנות החלטה מסעיף 2 ב-`HANDOFF.md` בלי לשאול.

פקודות:
- `npm run dev` — שרת פיתוח בזיכרון על http://localhost:8787 (צ׳יף `0000`, רופאים `1001`…`1018`).
- `npm test` — כל הבדיקות.
- `npm run setup` / `npm run smoke` / `npm run code -- "<שם>"` — מול הגיליון האמיתי (`.env`).
