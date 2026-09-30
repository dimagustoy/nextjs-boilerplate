"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Connection = { connected: boolean; username?: string; configured: boolean };
const button = "rounded-xl border border-white/15 px-4 py-2.5 text-sm hover:bg-white/10 disabled:opacity-40";
export default function TelegramPanel({ owner }: { owner: boolean }) {
  const [connection,setConnection] = useState<Connection | null>(null);
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(false);
  const [link,setLink] = useState("");
  const api = useCallback(async (path: string, method = "GET") => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Войдите в платформу заново");
    const response = await fetch(`/api/telegram/${path}`, { method, headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось выполнить действие");
    return data;
  }, []);
  const refresh = useCallback(async () => {
    try { setConnection(await api("connect")); } catch(e) { setNotice(e instanceof Error ? e.message : "Ошибка загрузки"); }
  },[api]);
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus",onFocus);
    return () => window.removeEventListener("focus",onFocus);
  },[refresh]);
  async function action(path: string,method: string) {
    setBusy(true);setNotice("");
    try {
      const result = await api(path,method);
      if (result.url) { setLink(result.url);setNotice("Откройте ссылку ниже и нажмите «Запустить» в Telegram. Ссылка действует 10 минут."); }
      else { setLink("");setNotice(path === "setup" ? `Бот @${result.username} подключён к платформе.` : path === "test" ? "Тестовое сообщение отправлено." : "Telegram отключён."); }
      await refresh();
    } catch(e) { setNotice(e instanceof Error ? e.message : "Ошибка"); }
    finally { setBusy(false); }
  }
  return <section className="max-w-2xl space-y-5 rounded-2xl border border-white/10 bg-white/[.03] p-5 md:p-6">
    <h2 className="text-2xl font-semibold">Telegram</h2>
    <p className="text-sm text-white/60">Новые задачи, изменения статусов и сроков, комментарии и запросы переноса. Напоминания о дедлайнах начинаются с 08:00 по Екатеринбургу; о просрочках — ежедневно.</p>
    <p className="text-sm">{connection?.connected ? `Подключён${connection.username ? `: @${connection.username}` : ""}` : "Ваш Telegram пока не подключён"}</p>
    {notice && <p role="status" className="rounded-xl border border-white/15 bg-white/5 p-3 text-sm">{notice}</p>}
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || !connection?.configured} className={button} onClick={() => action("connect","POST")}>{connection?.connected ? "Переподключить" : "Подключить Telegram"}</button>
      <button disabled={busy} className={button} onClick={refresh}>Проверить подключение</button>
      {connection?.connected && <><button disabled={busy} className={button} onClick={() => action("test","POST")}>Тестовое сообщение</button><button disabled={busy} className={button} onClick={() => action("connect","DELETE")}>Отключить</button></>}
    </div>
    {link && <a className="inline-block rounded-xl bg-white px-5 py-3 text-sm font-medium text-black" href={link} target="_blank" rel="noopener noreferrer">Запустить бота в Telegram</a>}
    {owner && <div className="border-t border-white/10 pt-5"><p className="mb-3 text-sm text-white/50">Первое подключение: после настройки бота нажмите кнопку ниже, затем подключите свой Telegram.</p><button disabled={busy || !connection?.configured} className={button} onClick={() => action("setup","POST")}>Подключить бота к платформе</button></div>}
  </section>;
}
