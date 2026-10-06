"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Place = {
  id?: string;
  slug: string;
  city: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  short_description?: string | null;
  hero_image_url?: string | null;
  two_gis_url?: string | null;
  yandex_maps_url?: string | null;
  rating_2gis?: number | null;
  rating_yandex?: number | null;
  opening_hours?: string[] | null;
};

const fallbackPlaces: Place[] = [
  { slug: "ekb-turgeneva-22", city: "Екатеринбург", name: "На Тургенева", address: "ул. Тургенева, 22" },
  { slug: "ekb-tatishcheva-47a", city: "Екатеринбург", name: "На Татищева", address: "ул. Татищева, 47А" },
  { slug: "ekb-chkalova-258", city: "Екатеринбург", name: "На Чкалова", address: "ул. Чкалова, 258" },
  { slug: "ekb-beloglazova-2g", city: "Екатеринбург", name: "Гагарин", address: "бул. Владимира Белоглазова, 2Г" },
];

function pluralPlaces(value: number) {
  const last = value % 10;
  const lastTwo = value % 100;
  if (last === 1 && lastTwo !== 11) return "место";
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return "места";
  return "мест";
}

export default function NetworkDirectory() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [places, setPlaces] = useState<Place[]>(fallbackPlaces);
  const [city, setCity] = useState("Екатеринбург");

  useEffect(() => {
    const anchor = document.querySelector<HTMLElement>("#places");
    if (!anchor) return;

    let host = document.getElementById("all-places");
    if (!host) {
      host = document.createElement("section");
      host.id = "all-places";
      host.className = "section all-places";
      anchor.insertAdjacentElement("afterend", host);
    }

    setMount(host);
    if (window.location.hash === "#all-places") {
      requestAnimationFrame(() => host?.scrollIntoView({ behavior: "smooth" }));
    }
  }, []);

  useEffect(() => {
    fetch("/api/content", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (Array.isArray(data.locations) && data.locations.length) {
          setPlaces(data.locations);
          const cities = Array.from(new Set<string>(data.locations.map((place: Place) => place.city).filter(Boolean)));
          setCity((current) => (cities.includes(current) ? current : cities[0] || "Екатеринбург"));
        }
      })
      .catch(() => undefined);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Place[]>();
    for (const place of places) {
      const key = place.city || "Другой город";
      map.set(key, [...(map.get(key) || []), place]);
    }
    return Array.from(map.entries())
      .map(([name, items]) => ({ name, count: items.length, items }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"));
  }, [places]);

  const visible = useMemo(() => places.filter((place) => place.city === city), [places, city]);

  if (!mount) return null;

  return createPortal(
    <>
      <div className="section-head all-places-head">
        <div>
          <p className="eyebrow">Вся сеть</p>
          <h2>{places.length} МЕСТ.<br />{grouped.length} ГОРОДОВ.</h2>
        </div>
        <div className="network-head-copy">
          <p className="section-intro">Выбирай город, смотри его места и сразу строй маршрут. Без карты, которая устаревает быстрее, чем мы успеваем открыть новую точку.</p>
          <span>Данные обновляются из NU OS</span>
        </div>
      </div>

      <div className="network-city-browser">
        <div className="network-city-browser-head">
          <div>
            <span>Города сети</span>
            <strong>Выбери свой</strong>
          </div>
          <p>{grouped.length} городов · {places.length} {pluralPlaces(places.length)}</p>
        </div>

        <div className="network-city-grid" aria-label="Выбор города">
          {grouped.map((group, index) => (
            <button
              key={group.name}
              type="button"
              className={city === group.name ? "active" : ""}
              onClick={() => setCity(group.name)}
            >
              <span className="network-city-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="network-city-name">{group.name}</span>
              <span className="network-city-count">{group.count} {pluralPlaces(group.count)}</span>
              <span className="network-city-arrow">↘</span>
            </button>
          ))}
        </div>
      </div>

      <div className="selected-city-head">
        <div>
          <p className="eyebrow">Сейчас смотрим</p>
          <h3>{city}</h3>
        </div>
        <div className="selected-city-meta">
          <span>{visible.length} {pluralPlaces(visible.length)}</span>
          <small>Фото · рейтинг · маршрут</small>
        </div>
      </div>

      <div className="all-places-grid">
        {visible.map((place) => (
          <article className="network-card" key={place.slug}>
            <a className="network-card-image" href={`/places/${place.slug}`}>
              {place.hero_image_url ? (
                <img src={place.hero_image_url} alt={`${place.city}, ${place.name}`} loading="lazy" />
              ) : (
                <div className="network-image-placeholder"><span>NU</span><small>ФОТО СКОРО</small></div>
              )}
              <span className="network-card-badge">НЕ УСЛОЖНЯЙ</span>
            </a>

            <div className="network-card-body">
              <div className="network-card-title">
                <div>
                  <p>{place.city}</p>
                  <h3>{place.name}</h3>
                </div>
                <div className="network-ratings">
                  {place.rating_2gis != null && <span><b>{Number(place.rating_2gis).toFixed(1)}</b> 2ГИС</span>}
                  {place.rating_yandex != null && <span><b>{Number(place.rating_yandex).toFixed(1)}</b> Яндекс</span>}
                </div>
              </div>

              <p className="network-address">{place.address || "Адрес добавляем"}</p>
              {place.short_description && <p className="network-description">{place.short_description}</p>}

              <div className="network-card-actions">
                <a className="network-primary" href={`/places/${place.slug}`}>Смотреть место →</a>
                {place.phone && <a href={`tel:${place.phone.replace(/[^+\d]/g, "")}`}>Позвонить</a>}
                {place.two_gis_url && <a href={place.two_gis_url} target="_blank" rel="noreferrer">2ГИС ↗</a>}
                {place.yandex_maps_url && <a href={place.yandex_maps_url} target="_blank" rel="noreferrer">Яндекс ↗</a>}
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="network-franchise-bridge">
        <div>
          <span>СЕТЬ РАСТЁТ</span>
          <h3>Следующий город<br />может быть твоим.</h3>
        </div>
        <a href="#franchise">Открыть Не Усложняй →</a>
      </div>
    </>,
    mount,
  );
}
