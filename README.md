This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Система задач «Не Усложняй»

Выполните SQL из `supabase/migrations/20260929010000_task_management.sql` в SQL Editor проекта Supabase **один раз** до публикации новой версии. Миграция не меняет существующую авторизацию и не удаляет данные. Она создаёт проекты, задачи, комментарии, историю, запросы переноса срока и политики RLS. Таблица `profiles` должна уже иметь поля `id`, `full_name`, `role`, `is_active` и значения ролей `owner`, `manager`, `smm`, `senior_master`.

В Vercel должны быть установлены `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Это публичный ключ клиента; `service_role` приложению не нужен. Локально сохраните эти две переменные в `.env.local` (файл игнорируется Git). Затем запустите `npm ci` и `npm run build`.

Для приглашения сотрудников задайте в Vercel дополнительную переменную **`SUPABASE_SERVICE_ROLE_KEY`** только для серверной среды. Не используйте префикс `NEXT_PUBLIC_` и не записывайте значение в Git. Серверный маршрут проверяет действующий токен и роль владельца перед вызовом Supabase Auth Admin. Владелец также может менять роль и активность на вкладке «Команда». Если переменная не настроена, приглашения вернут понятную ошибку; остальные возможности приложения продолжат работать.

Публикуйте код после успешного применения миграции. До применения SQL новые экраны покажут ошибку чтения таблиц. Просрочка определяется по `due_at` и текущему времени, завершённые задачи из подсчёта исключены. Даты отображаются по Екатеринбургу.
