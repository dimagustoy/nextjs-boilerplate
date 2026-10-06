# Jarvis Telegram v1 test cases

1. Linked owner sends `Что горит?` and receives only visible non-completed attention tasks.
2. Linked employee sends `Какие у меня задачи сегодня?` and receives only their own due-today tasks.
3. Owner sends `Поставь <имя> до пятницы ... Результат: ...` and receives a confirmation card, not an immediate write.
4. Confirming the card creates exactly one NU TEAM task and records the actor in task history.
5. Canceling the card creates no task.
6. Employee marks their task done and Jarvis proposes `review`, not `completed`.
7. Manager/owner may confirm completion only from `review`, preserving the existing NU TEAM guard.
8. Employee deadline change creates a deadline request; manager/owner deadline change updates directly when authorized.
9. An unlinked Telegram account receives connection instructions and cannot read/write NU TEAM data.
10. Pending confirmation older than 20 minutes is rejected.
11. If OpenAI parsing is unavailable, common Russian read commands and explicit task creation still work through the deterministic fallback.
