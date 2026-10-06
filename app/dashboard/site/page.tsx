"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type Role = "owner" | "manager" | "smm" | "senior_master";
type Article = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  category: string;
  cover_image_url: string | null;
  is_published: boolean;
  published_at: string | null;
  source_type: string | null;
  source_url: string | null;
  show_on_home: boolean;
  home_order: number | null;
  manual_override: boolean;
};

type Draft = Pick<Article, "title" | "excerpt" | "category" | "cover_image_url">;

const categories: Record<string, string> = {
  news: "Новости",
  events: "События",
  people: "Люди",
  food: "Еда и напитки",
  brand: "Не Усложняй",
  openings: "Новые места",
};

const fmt = (value: string | null) => value
  ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Yekaterinburg" }).format(new Date(value))
  : "Без даты";

export default function SiteJournalAdmin() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [role, setRole] = useState<Role | null>(null);

  const load = useCallback(async () => {
    const result = await supabase
      .from("site_articles")
      .select("id,slug,title,excerpt,category,cover_image_url,is_published,published_at,source_type,source_url,show_on_home,home_order,manual_override")
      .order("published_at", { ascending: false });
    if (result.error) {
      setNotice(result.error.message);
      return;
    }
    const rows = (result.data || []) as Article[];
    setArticles(rows);
    setSelected(rows.filter((item) => item.show_on_home).sort((a, b) => (a.home_order || 99) - (b.home_order || 99)).slice(0, 3).map((item) => item.id));
  }, []);

  useEffect(() => {
    let alive = true;
    async function start() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/"; return; }
      const { data: profile } = await supabase.from("profiles").select("role,is_active").eq("id", user.id).single();
      if (!alive) return;
      const currentRole = profile?.role as Role | undefined;
      if (!profile?.is_active || !currentRole || !["owner", "manager", "smm"].includes(currentRole)) {
        window.location.href = "/dashboard";
        return;
      }
      setRole(currentRole);
      await load();
      if (alive) setBusy(false);
    }
    start();
    return () => { alive = false; };
  }, [load]);

  const selectedArticles = useMemo(() => selected.map((id) => articles.find((item) => item.id === id)).filter(Boolean) as Article[], [selected, articles]);

  function toggleHome(id: string) {
    setNotice("");
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 3) {
        setNotice("На главной помещается три новости. Сначала убери одну из выбранных.");
        return current;
      }
      return [...current, id];
    });
  }

  function move(id: string, direction: -1 | 1) {
    setSelected((current) => {
      const index = current.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }

  async function saveSelection() {
    setSaving(true);
    setNotice("");
    const selectedSet = new Set(selected);
    const results = await Promise.all(articles.map((article) => supabase
      .from("site_articles")
      .update({
        show_on_home: selectedSet.has(article.id),
        home_order: selectedSet.has(article.id) ? selected.indexOf(article.id) + 1 : null,
        manual_override: article.manual_override || selectedSet.has(article.id),
      })
      .eq("id", article.id)));
    const error = results.find((result) => result.error)?.error;
    if (error) setNotice(error.message);
    else {
      setNotice("Главная обновлена. На сайте изменения появятся почти сразу.");
      await load();
    }
    setSaving(false);
  }

  function startEdit(article: Article) {
    setEditingId(article.id);
    setDraft({ title: article.title, excerpt: article.excerpt, category: article.category, cover_image_url: article.cover_image_url });
    setNotice("");
  }

  async function saveArticle() {
    if (!editingId || !draft || !draft.title.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("site_articles").update({
      title: draft.title.trim(),
      excerpt: draft.excerpt?.trim() || null,
      category: draft.category,
      cover_image_url: draft.cover_image_url?.trim() || null,
      manual_override: true,
      updated_at: new Date().toISOString(),
    }).eq("id", editingId);
    if (error) setNotice(error.message);
    else {
      setNotice("Новость сохранена. Telegram больше не перезапишет эту редактуру.");
      setEditingId(null);
      setDraft(null);
      await load();
    }
    setSaving(false);
  }

  if (busy) return <main className="min-h-screen bg-stone-100 p-8 text-stone-600">Загружаю редактор сайта…</main>;

  return (
    <main className="min-h-screen bg-[#f4f1eb] text-stone-900">
      <header className="border-b border-stone-200 bg-white/90 px-5 py-4 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <a href="/dashboard" className="text-xs font-semibold uppercase tracking-[.18em] text-orange-600">← NU OS</a>
            <h1 className="mt-1 text-2xl font-black tracking-tight">Редактор сайта · Журнал</h1>
          </div>
          <div className="text-right text-xs text-stone-500"><div>Автосбор из Telegram включён</div><div className="font-semibold text-stone-700">Доступ: {role}</div></div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-7 p-5 md:p-8">
        {notice && <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-900">{notice}</div>}

        <section className="rounded-3xl bg-[#181716] p-5 text-white shadow-sm md:p-7">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.2em] text-orange-400">Главная сайта</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">Выбери 3 новости</h2>
              <p className="mt-2 max-w-2xl text-sm text-stone-400">Порядок здесь равен порядку карточек в блоке «Журнал». Новые посты из Telegram сами сюда не залезают, пока ты их не выберешь.</p>
            </div>
            <button onClick={saveSelection} disabled={saving} className="rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-black hover:bg-orange-400 disabled:opacity-50">{saving ? "Сохраняю…" : "Сохранить главную"}</button>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {[0, 1, 2].map((slot) => {
              const article = selectedArticles[slot];
              return <div key={slot} className="min-h-36 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 text-xs font-black text-orange-400">ПОЗИЦИЯ {slot + 1}</div>
                {article ? <>
                  <div className="line-clamp-2 font-bold">{article.title}</div>
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => move(article.id, -1)} disabled={slot === 0} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs disabled:opacity-25">←</button>
                    <button onClick={() => move(article.id, 1)} disabled={slot === selectedArticles.length - 1} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs disabled:opacity-25">→</button>
                    <button onClick={() => toggleHome(article.id)} className="ml-auto rounded-lg border border-red-400/30 px-3 py-1.5 text-xs text-red-300">Убрать</button>
                  </div>
                </> : <div className="text-sm text-stone-500">Пусто. Выбери новость ниже.</div>}
              </div>;
            })}
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-orange-600">Вся лента</p><h2 className="text-2xl font-black">Новости и истории</h2></div><span className="text-sm text-stone-500">{articles.length} материалов</span></div>
          <div className="grid gap-4 lg:grid-cols-2">
            {articles.map((article) => {
              const active = selected.includes(article.id);
              const editing = editingId === article.id && draft;
              return <article key={article.id} className={`overflow-hidden rounded-3xl border bg-white shadow-sm ${active ? "border-orange-400 ring-2 ring-orange-100" : "border-stone-200"}`}>
                <div className="grid min-h-56 grid-cols-[150px_1fr] sm:grid-cols-[210px_1fr]">
                  <div className="bg-stone-200">{article.cover_image_url ? <img src={article.cover_image_url} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-4xl font-black text-stone-400">NU</div>}</div>
                  <div className="p-4 md:p-5">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.12em] text-stone-500"><span>{categories[article.category] || article.category}</span><span>·</span><span>{fmt(article.published_at)}</span>{article.source_type === "telegram" && <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-700">Telegram</span>}</div>
                    <h3 className="mt-3 text-xl font-black leading-tight">{article.title}</h3>
                    <p className="mt-2 line-clamp-3 text-sm leading-5 text-stone-600">{article.excerpt}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => toggleHome(article.id)} className={`rounded-xl px-3 py-2 text-xs font-bold ${active ? "bg-orange-100 text-orange-800" : "bg-stone-900 text-white"}`}>{active ? `На главной · ${selected.indexOf(article.id) + 1}` : "Выбрать на главную"}</button>
                      <button onClick={() => startEdit(article)} className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-bold">Редактировать</button>
                      {article.source_url && <a href={article.source_url} target="_blank" rel="noreferrer" className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-bold">Оригинал ↗</a>}
                    </div>
                  </div>
                </div>

                {editing && <div className="border-t border-stone-200 bg-stone-50 p-5">
                  <div className="grid gap-4">
                    <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Заголовок<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm normal-case tracking-normal text-stone-900 outline-none focus:border-orange-500" /></label>
                    <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Анонс<textarea value={draft.excerpt || ""} onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })} rows={4} className="mt-2 w-full resize-y rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm normal-case tracking-normal text-stone-900 outline-none focus:border-orange-500" /></label>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Категория<select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm normal-case tracking-normal text-stone-900">{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Обложка URL<input value={draft.cover_image_url || ""} onChange={(e) => setDraft({ ...draft, cover_image_url: e.target.value })} className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm normal-case tracking-normal text-stone-900 outline-none focus:border-orange-500" /></label>
                    </div>
                    <div className="flex gap-2"><button onClick={saveArticle} disabled={saving} className="rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50">Сохранить новость</button><button onClick={() => { setEditingId(null); setDraft(null); }} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-bold">Отмена</button></div>
                  </div>
                </div>}
              </article>;
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
