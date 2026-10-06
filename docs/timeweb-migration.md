# NU OS → Timeweb Cloud App Platform

## Target
Move NU OS hosting from Vercel to Timeweb Cloud App Platform without changing Supabase, Telegram data, users, or the GitHub source of truth.

Repository: `dimagustoy/nextjs-boilerplate`
Production branch: `main`
Framework: Next.js with SSR

## Timeweb App Platform setup
1. Create an App Platform application.
2. Connect GitHub and select `dimagustoy/nextjs-boilerplate`.
3. Select branch `main` and build from the latest commit.
4. Framework: Next.js.
5. Enable SSR.
6. Keep the automatically detected build/start commands unless Timeweb asks explicitly:
   - Build: `npm run build`
   - Start: `npm start`
7. After the first deploy, verify `/api/health` returns `{ ok: true }`.

## Environment variables
Do not commit real values to GitHub. Configure these in Timeweb App Platform.

Required public configuration:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Required server secrets:
- `SUPABASE_SECRET_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_DISPATCH_SECRET`

Deployment configuration:
- `NU_ENV=production`
- `APP_URL=https://<timeweb-production-domain>`

Optional AI configuration will be added separately when the Jarvis AI provider is finalized.

## Cutover checklist
1. Timeweb deploy is healthy.
2. Login to NU TEAM works against the existing Supabase project.
3. Dashboard/tasks/projects load correctly.
4. `APP_URL` points to the final Timeweb production URL.
5. Re-register Telegram webhook through the owner Telegram setup action so Telegram points to the Timeweb domain and subscribes to both `message` and `callback_query`.
6. Create a fresh Jarvis test task and confirm it with the inline button.
7. Verify the task appears in NU TEAM.
8. Verify Telegram dispatch/reminder delivery.
9. Keep Vercel untouched for rollback until Timeweb has passed the production checks.
10. Only after stable operation should the old Vercel deployment be considered removable.

## Host portability
Runtime checks use `NU_ENV` first and fall back to `VERCEL_ENV`, so migration can happen gradually without breaking the current Vercel rollback deployment.

## Health check
`GET /api/health`

The endpoint intentionally exposes no credentials or database details.
