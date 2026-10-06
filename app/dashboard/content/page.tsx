"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type Article = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  category: string;
  is_published: boolean;
  published_at: string | null;
};

type Location = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  is_published: boolean;
};

export default function ContentDashboard() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    const [articlesResult, locationsResult] = await Promise.all([
      supabase.from("site_articles").select("id,title,slug,excerpt,category,is_published,published_at").order("created_at", { ascending: false }),
      supabase.from("site_locations").select("id,name,city,address,is_published").order("sort_order", { ascending: true }),
    ]);
    setArticles((articlesResult.data || []) as Article[]);
    setLocations((locationsResult.data || []) as Location[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function createArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const slug = String(form.get("slug") || "").trim().toLowerCase().replace(/[^a-z0-9а-яё-]+/gi, "-").replace(/^-|-$/g, "");
    const excerpt = String(form.get("excerpt") || "").trim();
    const category = String(form.get("category") || "news");
    const publishNow = form.get("publish_now") === "on";

    const { error } = await supabase.from("site_articles").insert({
      title,
      slug,
      excerpt,
      category,
      body: excerpt,
      is_published: publishNow,
      published_at: publishNow ? new Date().toISOString() : null,
    });

    if (error) {
      setMessage(`Ошибка: ${error.message}`);
      return;
    }

    event.currentTarget.reset();
    setMessage("Материал создан.");
    await load();
  }

  async function togglePublish(article: Article) {
    const next = !article.is_published;
    const { error } = await supabase.from("site_articles").update({
      is_published: next,
      published_at: next ? (article.published_at || new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    }).eq("id", article.id);
    if (error) { setMessage(`Ошибка: ${error.message}`); return; }
    await load();
  }

  return (
    <main className="min-h-screen bg-[#f6f2eb] p-6 text-stone-950 md:p-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-orange-600">NU OS · CMS</div>
            <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">Сайт и журнал</h1>
            <p className="mt-3 max-w-2xl text-stone-600">Публикации и точки сайта без редактирования кода. Сайт читает только опубликованные записи.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/dashboard" className="rounded-full border border-stone-300 px-4 py-2 text-sm">← NU OS</Link>
            <Link href="/site" className="rounded-full bg-stone-950 px-4 py-2 text-sm text-white">Открыть сайт ↗</Link>
          </div>
        </div>

        <section className="mb-8 rounded-3xl bg-white p-6 shadow-sm md:p-8">
          <h2 className="mb-5 text-2xl font-semibold">Новый материал</h2>
          <form onSubmit={createArticle} className="grid gap-4 md:grid-cols-2">
            <input name="title" required placeholder="Заголовок" className="rounded-xl border border-stone-200 px-4 py-3 outline-none focus:border-orange-500" />
            <input name="slug" required placeholder="slug-на-латинице" className="rounded-xl border border-stone-200 px-4 py-3 outline-none focus:border-orange-500" />
            <textarea name="excerpt" required placeholder="Короткое описание" className="min-h-28 rounded-xl border border-stone-200 px-4 py-3 outline-none focus:border-orange-500 md:col-span-2" />
            <select name="category" defaultValue="news" className="rounded-xl border border-stone-200 px-4 py-3">
              <option value="news">Новости</option><option value="events">События</option><option value="people">Люди</option><option value="food">Еда и напитки</option><option value="brand">Бренд</option><option value="openings">Открытия</option>
            </select>
            <label className="flex items-center gap-3 rounded-xl border border-stone-200 px-4 py-3"><input type="checkbox" name="publish_now" /> Опубликовать сразу</label>
            <button className="rounded-xl bg-[#f36b21] px-5 py-3 font-semibold text-white md:col-span-2">Создать материал</button>
          </form>
          {message && <p className="mt-4 text-sm text-stone-600">{message}</p>}
        </section>

        <div className="grid gap-8 lg:grid-cols-[1.25fr_.75fr]">
          <section className="rounded-3xl bg-white p-6 shadow-sm md:p-8">
            <h2 className="mb-5 text-2xl font-semibold">Журнал</h2>
            {loading ? <p>Загрузка…</p> : <div className="space-y-3">{articles.map(article => (
              <div key={article.id} className="flex items-center justify-between gap-4 rounded-2xl border border-stone-100 p-4">
                <div><div className="text-xs uppercase tracking-wider text-stone-400">{article.category}</div><div className="font-medium">{article.title}</div><div className="mt-1 text-sm text-stone-500">/{article.slug}</div></div>
                <button onClick={() => togglePublish(article)} className={`rounded-full px-3 py-2 text-xs font-semibold ${article.is_published ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>{article.is_published ? "Опубликовано" : "Черновик"}</button>
              </div>
            ))}</div>}
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-sm md:p-8">
            <h2 className="mb-5 text-2xl font-semibold">Заведения</h2>
            <div className="space-y-3">{locations.map(location => (
              <div key={location.id} className="rounded-2xl border border-stone-100 p-4">
                <div className="text-xs uppercase tracking-wider text-orange-600">{location.city}</div>
                <div className="mt-1 font-medium">{location.name}</div>
                <div className="mt-1 text-sm text-stone-500">{location.address}</div>
                <div className="mt-3 text-xs text-stone-400">{location.is_published ? "На сайте" : "Скрыто"}</div>
              </div>
            ))}</div>
          </section>
        </div>
      </div>
    </main>
  );
}
