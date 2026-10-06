import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const fallbacks: Record<string, any> = {
  "ekb-turgeneva-22": { city: "Екатеринбург", name: "Тургенева", address: "ул. Тургенева, 22", short_description: "Точка в центре города. Для встреч, долгих разговоров и вечеров без лишнего шума.", hero_image_url: "https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=2200&q=88" },
  "ekb-tatishcheva-47a": { city: "Екатеринбург", name: "Татищева", address: "ул. Татищева, 47А", short_description: "Камерный NU на ВИЗе. Место для неспешных вечеров и своих людей.", hero_image_url: "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=2200&q=88" },
  "ekb-chkalova-258": { city: "Екатеринбург", name: "Чкалова", address: "ул. Чкалова, 258", short_description: "Просторная точка на юге города. Когда хочется собраться компанией и никуда не спешить.", hero_image_url: "https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=2200&q=88" },
  "ekb-beloglazova-2g": { city: "Екатеринбург", name: "Гагарин", address: "бул. Владимира Белоглазова, 2Г", short_description: "Новый большой NU с собственным характером, кухней и пространством для событий.", hero_image_url: "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=2200&q=88" },
};

async function getPlace(slug: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url && key) {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await supabase
      .from("site_locations")
      .select("slug,city,name,address,phone,short_description,hero_image_url,gallery_urls,two_gis_url,yandex_maps_url,messenger_url,rating_2gis,rating_yandex,opening_hours")
      .eq("slug", slug)
      .maybeSingle();
    if (data) return data;
  }
  const fallback = fallbacks[slug];
  return fallback ? { slug, ...fallback, gallery_urls: [], opening_hours: [] } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const place = await getPlace(slug);
  if (!place) return { title: "Не Усложняй" };
  return { title: `${place.name} · ${place.city} — Не Усложняй`, description: place.short_description || place.address };
}

export default async function PlacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const place = await getPlace(slug);

  if (!place) {
    return <main className="place-not-found"><p className="eyebrow">Не Усложняй</p><h1>ТАКОЙ ТОЧКИ<br />ПОКА НЕТ.</h1><Link className="button button-orange" href="/#all-places">К заведениям</Link></main>;
  }

  const gallery = Array.isArray(place.gallery_urls) && place.gallery_urls.length
    ? place.gallery_urls
    : [
        "https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=1400&q=85",
        "https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=1400&q=85",
        "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1400&q=85",
      ];
  const hours = Array.isArray(place.opening_hours) ? place.opening_hours : [];

  return (
    <main className="place-page">
      <header className="place-header">
        <Link className="brand" href="/">НЕ<br />УСЛОЖНЯЙ</Link>
        <Link href="/#all-places">← Все заведения</Link>
      </header>

      <section className="place-hero" style={{ backgroundImage: `url(${place.hero_image_url || gallery[0]})` }}>
        <div className="place-hero-shade" />
        <div className="place-hero-copy">
          <p className="eyebrow light">{place.city}</p>
          <h1>{place.name}</h1>
          <p>{place.short_description}</p>
          <div className="place-detail-actions">
            {place.phone && <a className="button button-orange" href={`tel:${String(place.phone).replace(/[^+\d]/g, "")}`}>Позвонить</a>}
            {place.two_gis_url && <a className="button button-light" href={place.two_gis_url} target="_blank" rel="noreferrer">Маршрут в 2ГИС ↗</a>}
            {place.yandex_maps_url && <a className="button button-light" href={place.yandex_maps_url} target="_blank" rel="noreferrer">Яндекс Карты ↗</a>}
          </div>
        </div>
      </section>

      <section className="place-info">
        <div>
          <p className="eyebrow">Адрес</p>
          <h2>{place.address || "Адрес уточняется"}</h2>
          {hours.length > 0 && <div className="place-hours">{hours.map((item: string) => <span key={item}>{item}</span>)}</div>}
        </div>
        <div className="place-ratings">
          {place.rating_2gis != null && <div><strong>{Number(place.rating_2gis).toFixed(1)}</strong><span>2ГИС</span></div>}
          {place.rating_yandex != null && <div><strong>{Number(place.rating_yandex).toFixed(1)}</strong><span>Яндекс</span></div>}
        </div>
      </section>

      <section className="place-story">
        <p className="eyebrow">Про это место</p>
        <h2>СЮДА НЕ НУЖЕН<br /><span>ОСОБЫЙ ПОВОД.</span></h2>
        <p>{place.short_description || "Приходи встретиться с друзьями, выдохнуть после дня или просто провести вечер без лишнего сценария."}</p>
      </section>

      <section className="place-gallery-wrap">
        <div className="place-gallery-heading">
          <p className="eyebrow light">Посмотри вокруг</p>
          <h2>АТМОСФЕРА<br /><span>ЭТОГО NU.</span></h2>
        </div>
        <div className="place-gallery place-gallery-full">
          {gallery.slice(0, 10).map((url: string, index: number) => <img key={url + index} src={url} alt={`${place.name}: атмосфера ${index + 1}`} loading={index > 2 ? "lazy" : undefined} />)}
        </div>
      </section>

      <section className="place-bottom-cta">
        <p className="eyebrow light">{place.city}</p>
        <h2>УВИДИМСЯ<br />В NU.</h2>
        <div className="place-detail-actions">
          {place.phone && <a className="button button-orange" href={`tel:${String(place.phone).replace(/[^+\d]/g, "")}`}>Позвонить</a>}
          {place.messenger_url && <a className="button button-light" href={place.messenger_url} target="_blank" rel="noreferrer">Написать ↗</a>}
          {!place.phone && !place.messenger_url && <Link className="button button-orange" href="/">На главную</Link>}
        </div>
      </section>
    </main>
  );
}
