# النشر على Vercel

يعمل المشروع على Vercel بهذه الطريقة: الواجهة ملفات ثابتة، وخادم Express + tRPC يعمل كدالة Serverless واحدة.
المخرجات تُبنى بصيغة [Build Output API](https://vercel.com/docs/build-output-api/v3) عبر `scripts/build-vercel.mjs`.

## الإعداد (مرة واحدة)
1. في Vercel → Project → **Settings → Build & Deployment**:
   - **Framework Preset:** `Other`
   - اترك Build Command وOutput Directory وInstall Command على الوضع الافتراضي (`vercel.json` يحددها).
   - **Node.js Version:** `22.x` أو أحدث.
2. في **Settings → Environment Variables** أضف (انظر `.env.example`):
   `SUPABASE_URL`، `SUPABASE_SERVICE_ROLE_KEY`، `JWT_SECRET`، `VITE_APP_ID`
3. **قاعدة البيانات:** في Supabase ← SQL Editor شغّل `server/sql/supabase_schema.sql` (مرة واحدة عند الإنشاء)، ثم `server/sql/polarimeter_workflow_migration.sql`. الملف الثاني آمن عند تكراره، ويحدّث ذاكرة مخطط PostgREST تلقائياً.
4. أعد النشر (Redeploy).
5. **تحقق:** افتح `https://<موقعك>/api/health/schema`، ويجب أن يظهر `"ok": true`.

## كيف يعمل
| المسار | يُخدَم من |
|---|---|
| `/assets/*`، `/index.html`، الملفات الثابتة | `.vercel/output/static` (من `dist/public`) |
| `/api/health/schema` | فحص مخطط القاعدة للقراءة فقط (200 سليم / 503 ناقص) |
| `/api/*`، `/manus-storage/*` | الدالة `api/index` (`server/vercel/handler.ts`) |
| أي مسار آخر | `index.html` (تطبيق صفحة واحدة) |

## القيود
- وضع التخزين المحلي (`QC_STORAGE_MODE=local` / SQLite) غير مدعوم على Vercel، والتخزين يكون عبر Supabase فقط.
- ترويسة تقرير PDF الرسمية تحتاج `BUILT_IN_FORGE_API_URL` و`BUILT_IN_FORGE_API_KEY`. بدونهما يرفض البرنامج إنشاء التقرير الرسمي.
- مدة الطلب الواحد 30 ثانية كحد أقصى.

## تجربة محلية
```bash
pnpm run build:vercel     # ينشئ .vercel/output
```
