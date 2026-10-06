# Rollout

The database migration is forward-compatible with the existing web UI and has already been prepared for deployment. The Telegram webhook can be rolled out independently. `OPENAI_API_KEY` is optional for the first rollout; adding it upgrades free-form interpretation without changing the task storage model.
