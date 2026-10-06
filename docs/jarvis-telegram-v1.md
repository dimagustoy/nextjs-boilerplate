# Jarvis Telegram v1

Telegram becomes a conversational control layer for the existing NU TEAM task system. Supabase remains the source of truth.

## Supported in v1

- `Что горит?` — shows overdue, at-risk, and review tasks visible to the user.
- `Какие у меня задачи сегодня?` — shows the user's active tasks due today.
- Natural-language task creation with assignee, deadline, expected result, project and priority.
- Task status changes, deadline changes/requests, and comments when the intent can be resolved to one visible task.
- Confirmation buttons before every write.
- Existing NU TEAM role model is enforced server-side.

## AI parsing

If `OPENAI_API_KEY` is configured, Jarvis uses the Responses API with Structured Outputs and `gpt-5.6-luna` by default. `OPENAI_MODEL` can override the model.

Without an API key, a deterministic Russian parser still supports the common read queries and explicit task creation/status/deadline phrases. This makes the rollout safe before model billing is configured.

## Security

Telegram users must already be linked via `telegram_links`. Write actions are executed only through service-role-only RPC functions that re-apply the existing NU TEAM permissions using the linked user as the effective actor. Pending actions expire after 20 minutes.
