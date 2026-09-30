export type Schedule = {
  frequency: "daily" | "weekly" | "monthly";
  month_pattern: "all" | "odd" | "even";
  due_kind: "day" | "last_day" | "last_weekday";
  due_weekday: number; due_day: number; due_time: string;
  reminder_mode: "offsets" | "month_day"; reminder_day: number; reminder_days: number[];
  starts_on: string;
};
export const scheduleDefaults: Schedule = { frequency: "monthly", month_pattern: "all", due_kind: "day", due_weekday: 6, due_day: 25, due_time: "23:59", reminder_mode: "offsets", reminder_day: 1, reminder_days: [2], starts_on: "" };
export const weekdays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
export function todayLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function monthAt(offset: number, today = todayLocal()) {
  const [y,m] = today.split("-").map(Number);
  return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,10);
}
const iso = (d: Date) => d.toISOString().slice(0,10);
const shift = (d: string, n: number) => iso(new Date(new Date(`${d}T00:00:00Z`).getTime() + n*86400000));
export function occurrences(rule: Schedule, month: string) {
  const [y,m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y,m,0)).getUTCDate();
  const result: { due: string; notify: string; offsets: number[] }[] = [];
  for (let day=1;day<=last;day++) {
    const d = new Date(Date.UTC(y,m-1,day)); const due = iso(d); const weekday = d.getUTCDay() || 7;
    if (due < rule.starts_on) continue;
    if (rule.frequency === "weekly" && weekday !== rule.due_weekday) continue;
    if (rule.frequency === "monthly") {
      if (rule.month_pattern === "odd" && m%2 === 0 || rule.month_pattern === "even" && m%2 === 1) continue;
      if (rule.due_kind === "day" && day !== Math.min(rule.due_day,last)) continue;
      if (rule.due_kind === "last_day" && day !== last) continue;
      if (rule.due_kind === "last_weekday" && (weekday !== rule.due_weekday || day+7<=last)) continue;
    }
    let offsets = rule.reminder_days;
    if (rule.frequency === "monthly" && rule.reminder_mode === "month_day") {
      let n = new Date(Date.UTC(y,m-1,Math.min(rule.reminder_day,last)));
      if (iso(n)>due) n = new Date(Date.UTC(y,m-2,Math.min(rule.reminder_day,new Date(Date.UTC(y,m-1,0)).getUTCDate())));
      offsets = [(d.getTime()-n.getTime())/86400000];
    }
    result.push({ due, notify: shift(due,-Math.max(...offsets)), offsets });
  }
  return result;
}
export function scheduleLabel(rule: Schedule) {
  if (rule.frequency === "daily") return "Ежедневно";
  if (rule.frequency === "weekly") return `Еженедельно · ${weekdays[rule.due_weekday-1]}`;
  const parity = rule.month_pattern === "odd" ? "Нечётные месяцы" : rule.month_pattern === "even" ? "Чётные месяцы" : "Ежемесячно";
  const day = rule.due_kind === "last_day" ? "последний день" : rule.due_kind === "last_weekday" ? `последний день недели: ${weekdays[rule.due_weekday-1]}` : `${rule.due_day} число`;
  return `${parity} · ${day}`;
}
export type Preset = Schedule & { preset_key: string; title: string; description: string; expected_result: string };
function preset(key: string, title: string, expected_result: string, schedule: Partial<Schedule> = {}, description = ""): Preset {
  return { ...scheduleDefaults, ...schedule, preset_key: `manager-v1:${key}`, title, description, expected_result };
}
export const managerPresets: Preset[] = [
  preset("staff", "Контроль персонала", "Все проверки за день выполнены. Нарушения и принятые меры указаны в комментарии.", {frequency:"daily",reminder_days:[0]}, "Чек-лист:\n• Открытие смены\n• Контроль генералок\n• Проверка правильности заполнения таблиц «Отчёты за смену»\n• Контроль закрытия смены\n• Проверка отчётов за смену в чате «ЦПК»\n• Проверка правильности закрытия смены\n• Проверка чеков, отправленных в чат «ЦПК»"),
  preset("finance", "Финансовая отчётность", "Финансовые таблицы за день заполнены, счета проверены и необходимые оплаты проведены.", {frequency:"daily",reminder_days:[0]}, "Чек-лист:\n• Заполнить финансовые таблицы «Н.У.Б», «Н.У.Б. 3», «Н.У.Б. Гагарин»\n• Проверить финансы и оплатить счета"),
  preset("visits", "Посещение НУ", "Заведения посещены. В комментариях указаны дни посещения, заведения и итоги.", {frequency:"weekly",due_weekday:7}),
  preset("tobacco", "Проверка остатков и закупка табака", "Остатки проверены, необходимый табак закуплен; результат зафиксирован в комментарии.", {frequency:"weekly",due_weekday:3}),
  preset("drinks", "Проверка остатков и закупка напитков", "Остатки проверены, необходимые напитки закуплены; результат зафиксирован в комментарии.", {frequency:"weekly",due_weekday:3}),
  preset("supplies", "Проверка и закупка РМ", "Расходные материалы проверены и закуплены.", {frequency:"weekly",due_weekday:2}),
  preset("meetings", "Проведение собраний", "Собрания проведены, решения и поручения зафиксированы в комментарии.", {due_day:10}),
  ...[1,3,2,4].map(n=>preset(`clean-${n}`, `Генеральная уборка — НУ${n}`, "Генеральная уборка проведена и проверена, отчёт добавлен в комментарий.", {month_pattern:n%2 ? "odd":"even",due_kind:"last_day",reminder_mode:"month_day",reminder_day:1})),
  preset("inventory", "Проведение инвентаризации", "Инвентаризация проведена, остатки сверены, расхождения и результаты зафиксированы.", {due_day:10,reminder_mode:"month_day",reminder_day:1}),
  ...[11,21].map(n=>preset(`kpi-${n}`, `Мониторинг и анализ KPI — ${n} число`, "KPI проверены, отклонения проанализированы, выводы и действия записаны.", {due_day:n,reminder_days:[1]})),
  preset("shifts", "Составление графика смен", "График смен на следующий месяц составлен и доведён до сотрудников.", {due_kind:"last_weekday",due_weekday:6,reminder_days:[4]}),
  preset("nu1-utilities", "КУ — НУ1", "Коммунальные услуги оплачены, подтверждение оплаты добавлено в комментарий.", {due_day:15,reminder_days:[1]}),
  preset("nu1-rent", "Аренда — НУ1", "Аренда оплачена, подтверждение оплаты добавлено в комментарий.", {due_kind:"last_day",reminder_days:[1]}),
  preset("nu2-readings", "Показания — НУ2", "Показания сняты и переданы, значения зафиксированы в комментарии.", {due_day:26,reminder_days:[3]}),
  preset("nu2-rent", "Аренда — НУ2", "Аренда оплачена, подтверждение оплаты добавлено в комментарий.", {due_day:13}),
  ...[10,20,26].map(n=>preset(`nu2-electricity-${n}`, `Электроэнергия — НУ2, ${n} число`, "Электроэнергия оплачена, подтверждение оплаты добавлено в комментарий.", {due_day:n,reminder_days:[1]})),
  preset("nu2-utilities", "КУ — НУ2", "Коммунальные услуги оплачены, подтверждение оплаты добавлено в комментарий.", {due_day:26}),
  preset("nu3-readings", "Показания — НУ3", "Показания сняты и переданы, значения зафиксированы в комментарии.", {due_kind:"last_day",reminder_days:[0]}),
  preset("nu4-readings", "Показания — НУ4", "Показания сняты и переданы, значения зафиксированы в комментарии.", {due_day:20,reminder_days:[0]}),
  preset("nu4-rent", "Аренда — НУ4", "Аренда оплачена, подтверждение оплаты добавлено в комментарий.", {due_day:3,reminder_days:[2]}),
  ...[12,18,25].map(n=>preset(`nu4-utilities-${n}`, `КУ — НУ4, ${n} число`, "Коммунальные услуги оплачены, подтверждение оплаты добавлено в комментарий.", {due_day:n,reminder_days:[1]})),
  preset("reports", "Подготовка отчётов и аналитика", "Отчёты за предыдущий месяц подготовлены, анализ выполнен, ссылки и выводы добавлены в комментарий.", {due_day:1,reminder_days:[3]}),
];
