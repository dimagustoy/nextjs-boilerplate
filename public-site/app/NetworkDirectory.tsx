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

const knownPositions: Record<string, { x: number; y: number }> = {
  "Петрозаводск": { x: 28, y: 34 },
  "Ярославль": { x: 32, y: 41 },
  "Кострома": { x: 34, y: 43 },
  "Иваново": { x: 33, y: 47 },
  "Брянск": { x: 27, y: 52 },
  "Казань": { x: 39, y: 52 },
  "Самара": { x: 40, y: 60 },
  "Астрахань": { x: 35, y: 73 },
  "Екатеринбург": { x: 53, y: 53 },
  "Тюмень": { x: 58, y: 55 },
  "Иркутск": { x: 83, y: 62 },
};

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

  const points = useMemo(() => {
    return grouped.map((group, index) => {
      const known = knownPositions[group.name];
      if (known) return { ...group, ...known };
      const column = index % 5;
      const row = Math.floor(index / 5);
      return {
        ...group,
        x: 38 + column * 10,
        y: 34 + row * 16 + (column % 2) * 5,
      };
    });
  }, [grouped]);

  if (!mount) return null;

  return createPortal(
    <>
      <div className="section-head all-places-head">
        <div>
          <p className="eyebrow">Вся сеть</p>
          <h2>15 МЕСТ.<br />11 ГОРОДОВ.</h2>
        </div>
        <p className="section-intro">Выбирай город на карте, смотри пространство и сразу решай, куда сегодня. Никаких таблиц адресов из 2007 года.</p>
      </div>

      <div className="network-map-shell">
        <aside className="network-map-sidebar">
          <div className="network-map-kicker">РОССИЯ</div>
          <h3>Мы уже здесь.</h3>
          <p>И продолжаем появляться в новых городах.</p>

          <div className="network-city-list" aria-label="Выбор города">
            {grouped.map((group) => (
              <button
                key={group.name}
                type="button"
                className={city === group.name ? "active" : ""}
                onClick={() => setCity(group.name)}
              >
                <span>{group.name}</span>
                <b>{String(group.count).padStart(2, "0")}</b>
              </button>
            ))}
          </div>
        </aside>

        <div className="network-map-visual" aria-label="Карта присутствия Не Усложняй">
          <div className="network-map-glow" />
          <div className="network-russia-shape" />
          <div className="network-map-caption">НЕ УСЛОЖНЯЙ · РОССИЯ</div>

          {points.map((point) => (
            <button
              key={point.name}
              type="button"
              className={city === point.name ? "network-map-point selected" : "network-map-point"}
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
              onClick={() => setCity(point.name)}
              aria-label={`${point.name}: ${point.count} ${pluralPlaces(point.count)}`}
            >
              <span className="network-point-dot" />
              <span className="network-point-label">{point.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="selected-city-head">
        <div>
          <p className="eyebrow">Выбранный город</p>
          <h3>{city}</h3>
        </div>
        <span>{visible.length} {pluralPlaces(visible.length)}</span>
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
          <h3>Следующая точка на карте<br />может быть твоей.</h3>
        </div>
        <a href="#franchise">Открыть Не Усложняй →</a>
      </div>
    </>,
    mount,
  );
}
