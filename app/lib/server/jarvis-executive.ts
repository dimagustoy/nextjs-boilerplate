type Profile = { id: string; full_name: string };
type Task = {
  id: string;
  title: string;
  assignee_id: string;
  priority: "low" | "normal" | "high" | "critical";
  status: "new" | "accepted" | "in_progress" | "waiting" | "at_risk" | "review" | "completed";
  deadline: string;
};

type Context = {
  staff: Profile[];
  visibleTasks: Task[];
};

const RU_STATUS: Record<Task["status"], string> = {
  new: "Новая",
  accepted: "Принята",
  in_progress: "В работе",
  waiting: "Ожидание",
  at_risk: "Под угрозой",
  review: "На проверке",
  completed: "Завершена",
};

const TZ = "Asia/Yekaterinburg";

function norm(text: string) {
  return text.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/gi, " ").trim();
}

function staffName(ctx: Context, id: string) {
  return ctx.staff.find(p => p.id === id)?.full_name || "Сотрудник";
}

function fmtDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function overdueDays(task: Task, now: number) {
  return Math.max(0, Math.ceil((now - new Date(task.deadline).getTime()) / 86_400_000));
}

function taskLine(ctx: Context, task: Task, now: number) {
  const overdue = new Date(task.deadline).getTime() < now;
  const days = overdueDays(task, now);
  const marker = overdue ? "🔴" : task.status === "at_risk" ? "🟠" : "🟡";
  const late = overdue ? ` · просрочено ${days} дн.` : "";
  return `${marker} ${task.title}\n${staffName(ctx, task.assignee_id)} · ${RU_STATUS[task.status]} · ${fmtDate(task.deadline)}${late}`;
}

function groupRepeats(ctx: Context, tasks: Task[], now: number) {
  const map = new Map<string, { title: string; assignee: string; count: number; oldest: Task }>();
  for (const task of tasks) {
    const key = `${task.assignee_id}::${task.title.toLocaleLowerCase("ru").trim()}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { title: task.title, assignee: staffName(ctx, task.assignee_id), count: 1, oldest: task });
      continue;
    }
    existing.count += 1;
    if (new Date(task.deadline).getTime() < new Date(existing.oldest.deadline).getTime()) existing.oldest = task;
  }
  return [...map.values()]
    .sort((a, b) => new Date(a.oldest.deadline).getTime() - new Date(b.oldest.deadline).getTime())
    .map(item => `${item.title}${item.count > 1 ? ` ×${item.count}` : ""} · ${item.assignee} · старейшая просрочка ${overdueDays(item.oldest, now)} дн.`);
}

function byPeople(ctx: Context, tasks: Task[], now: number) {
  const map = new Map<string, { name: string; count: number; oldest: number }>();
  for (const task of tasks) {
    const current = map.get(task.assignee_id) || { name: staffName(ctx, task.assignee_id), count: 0, oldest: 0 };
    current.count += 1;
    current.oldest = Math.max(current.oldest, overdueDays(task, now));
    map.set(task.assignee_id, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.oldest - a.oldest);
}

export function renderExecutiveAttention(ctx: Context, rawText: string): string | null {
  const text = norm(rawText);
  const asksAttention = text.includes("что горит") || text.includes("горящие") || text.includes("критичные") || text.includes("по сотрудникам") || text.includes("просроч");
  if (!asksAttention) return null;

  const now = Date.now();
  const active = ctx.visibleTasks.filter(t => t.status !== "completed");
  const overdue = active.filter(t => new Date(t.deadline).getTime() < now);
  const atRisk = active.filter(t => new Date(t.deadline).getTime() >= now && t.status === "at_risk");
  const review = active.filter(t => new Date(t.deadline).getTime() >= now && t.status === "review");

  if (!overdue.length && !atRisk.length && !review.length) return "Сейчас ничего не горит. Подозрительно, но приятно.";

  if (text.includes("по сотрудникам")) {
    const people = byPeople(ctx, overdue, now);
    if (!people.length) return "Просроченных задач нет.";
    return [
      "Просрочка по сотрудникам:",
      "",
      ...people.slice(0, 10).map((p, i) => `${i + 1}. ${p.name}: ${p.count} · старейшая ${p.oldest} дн.`),
    ].join("\n");
  }

  if (text.includes("покажи все") || text.includes("все горящие")) {
    const all = [...overdue, ...atRisk, ...review]
      .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
      .slice(0, 30);
    return ["Все задачи, требующие внимания:", "", ...all.map((task, i) => `${i + 1}. ${taskLine(ctx, task, now)}`)].join("\n");
  }

  if (text.includes("критич")) {
    const critical = active
      .filter(t => t.priority === "critical" || t.priority === "high" || overdueDays(t, now) >= 3 || t.status === "at_risk")
      .sort((a, b) => {
        const pa = a.priority === "critical" ? 3 : a.priority === "high" ? 2 : 1;
        const pb = b.priority === "critical" ? 3 : b.priority === "high" ? 2 : 1;
        return pb - pa || new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      })
      .slice(0, 15);
    if (!critical.length) return "Критичных задач сейчас нет.";
    return ["Критичные задачи:", "", ...critical.map((task, i) => `${i + 1}. ${taskLine(ctx, task, now)}`)].join("\n");
  }

  const veryLate = overdue.filter(t => overdueDays(t, now) >= 3).length;
  const grouped = groupRepeats(ctx, overdue, now).slice(0, 5);
  const people = byPeople(ctx, overdue, now);
  const dominant = people[0];
  const dominantShare = dominant && overdue.length ? Math.round((dominant.count / overdue.length) * 100) : 0;

  const lines = [
    "🔥 Что горит сейчас",
    "",
    `🔴 Просрочено: ${overdue.length}${veryLate ? ` · из них ${veryLate} старше 3 дней` : ""}`,
    `🟠 Под риском: ${atRisk.length}`,
    `🟡 На проверке: ${review.length}`,
  ];

  if (grouped.length) {
    lines.push("", "Главные хвосты:", ...grouped.map((item, i) => `${i + 1}. ${item}`));
  }

  if (dominant && dominant.count >= 2 && dominantShare >= 50) {
    lines.push("", `Вывод Jarvis: ${dominant.name} держит ${dominantShare}% всей просрочки (${dominant.count} задач). Начать разбор стоит с него.`);
  }

  lines.push("", "Команды: «покажи все горящие», «критичные», «по сотрудникам». ");
  return lines.join("\n");
}
