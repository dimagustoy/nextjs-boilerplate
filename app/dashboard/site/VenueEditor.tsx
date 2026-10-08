"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";

const linkFields = [
  ["telegram_channel_url", "Telegram-канал", "https://t.me/channel"],
  ["vk_group_url", "Группа ВКонтакте", "https://vk.com/group"],
  ["instagram_url", "Instagram", "https://www.instagram.com/profile/"],
  ["booking_telegram_url", "Бронирование · Telegram", "https://t.me/contact"],
  ["booking_website_url", "Бронирование · сайт", "https://venue.example/"],
  ["booking_max_url", "Бронирование · MAX", "https://max.ru/…"],
  ["booking_whatsapp_url", "Бронирование · WhatsApp", "https://wa.me/…"],
  ["yandex_maps_url", "Карточка в Яндекс Картах", "https://yandex.ru/maps/org/…"],
  ["two_gis_url", "Карточка в 2ГИС", "https://2gis.ru/…"],
] as const;
const amenityFields = [
  ["has_kitchen", "Кухня"], ["has_spirits", "Крепкий алкоголь"],
  ["has_beer", "Пиво"], ["has_console", "Приставка"],
] as const;
type LinkField = typeof linkFields[number][0];
type AmenityField = typeof amenityFields[number][0];
type Venue = { id: string; city: string; name: string; rating_yandex: number | null; rating_2gis: number | null }
  & Record<LinkField, string | null> & Record<AmenityField, boolean | null>;
const selectFields = ["id", "city", "name", "rating_yandex", "rating_2gis", ...linkFields.map(([field]) => field), ...amenityFields.map(([field]) => field)].join(",");
const inputClass = "mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900";

export default function VenueEditor() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [draft, setDraft] = useState<Venue | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase.from("site_locations").select(selectFields).eq("is_published", true).order("city").order("sort_order")
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setNotice("Не удалось загрузить заведения: " + error.message); return; }
        const rows = (data || []) as unknown as Venue[];
        setVenues(rows); setDraft(rows[0] || null);
      });
    return () => { alive = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    setSaving(true); setNotice("");
    try {
      const links: Partial<Record<LinkField, string | null>> = {};
      for (const [field, label] of linkFields) {
        const value = draft[field]?.trim();
        if (!value) { links[field] = null; continue; }
        let parsed: URL;
        try { parsed = new URL(value); } catch { throw new Error(`${label}: укажи полную ссылку https://…`); }
        if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(`${label}: нужна ссылка https://… без логина и пароля.`);
        links[field] = parsed.href;
      }
      const amenities = Object.fromEntries(amenityFields.map(([field]) => [field, draft[field]]));
      const patch = { ...links, ...amenities, rating_yandex: draft.rating_yandex, rating_2gis: draft.rating_2gis, updated_at: new Date().toISOString() };
      const { data, error } = await supabase.from("site_locations").update(patch).eq("id", draft.id).select(selectFields).single();
      if (error) throw error;
      const saved = data as unknown as Venue;
      setVenues((rows) => rows.map((row) => row.id === saved.id ? saved : row));
      setDraft(saved); setNotice("Сохранено. Кнопки и оценки появятся на сайте в течение нескольких минут.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось сохранить. Попробуй ещё раз."); }
    finally { setSaving(false); }
  }

  return <section className="rounded-3xl border border-stone-200 bg-white p-5 md:p-7">
    <h2 className="text-2xl font-black">Заведения · контакты и оценки</h2>
    <p className="mt-2 text-sm text-stone-600">Пустая ссылка скрывает кнопку. Для канала и бронирования можно указать разные адреса. Оценки заполняй по карточкам Яндекса и 2ГИС.</p>
    <p role="status" className="my-3 text-sm text-orange-800">{notice}</p>
    {draft && <form onSubmit={save} className="space-y-5">
      <label className="block text-sm font-semibold">Заведение<select className={inputClass} value={draft.id} disabled={saving} onChange={(event) => {
        setDraft(venues.find((venue) => venue.id === event.target.value) || null); setNotice("");
      }}>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.city} · {venue.name}</option>)}</select></label>
      <fieldset disabled={saving} className="grid gap-4 md:grid-cols-2">
        <legend className="sr-only">Ссылки заведения</legend>
        {linkFields.map(([field, label, placeholder]) => <label key={field} className="text-sm font-semibold">{label}<input type="url" placeholder={placeholder} className={inputClass} value={draft[field] || ""} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} /></label>)}
      </fieldset>
      <fieldset disabled={saving} className="grid gap-4 md:grid-cols-2">
        <legend className="sr-only">Оценки</legend>
        {([['rating_yandex', 'Яндекс'], ['rating_2gis', '2ГИС']] as const).map(([field, label]) => <label key={field} className="text-sm font-semibold">{label}<input type="number" min="1" max="5" step="0.1" placeholder="Не проверено" className={inputClass} value={draft[field] ?? ""} onChange={(event) => setDraft({ ...draft, [field]: event.target.value === "" ? null : Number(event.target.value) })} /></label>)}
      </fieldset>
      <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-sm font-bold">Что есть в заведении</legend>
        {amenityFields.map(([field, label]) => <label key={field} className="text-sm font-semibold">{label}<select className={inputClass} value={draft[field] == null ? "unknown" : String(draft[field])} onChange={(event) => setDraft({ ...draft, [field]: event.target.value === "unknown" ? null : event.target.value === "true" })}><option value="unknown">Уточняется</option><option value="true">Есть</option><option value="false">Нет</option></select></label>)}
      </fieldset>
      <button disabled={saving} className="rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-black disabled:opacity-50">{saving ? "Сохраняю…" : "Сохранить заведение"}</button>
    </form>}
  </section>;
}
