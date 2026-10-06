"use client";

import { useEffect, useMemo, useState } from "react";
import { fallbackPlaces, type FallbackPlace } from "./fallback-locations";

type Place = FallbackPlace;

function pluralPlaces(value: number) {
  const last = value % 10;
  const lastTwo = value % 100;
  if (last === 1 && lastTwo !== 11) return "место";
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return "места";
  return "мест";
}

function PlaceCard({ place }: { place: Place }) {
  return (
    <article className="network-card">
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
  );
}

export default function NetworkDirectory() {
  const [places, setPlaces] = useState<Place[]>(fallbackPlaces);
  const [cmsReady, setCmsReady] = useState(false);

  useEffect(() => {
    fetch("/api/content", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (Array.isArray(data.locations) && data.locations.length) {
          setPlaces(data.locations as Place[]);
          setCmsReady(true);
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
      .sort((a, b) => {
        if (a.name === "Екатеринбург") return -1;
        if (b.name === "Екатеринбург") return 1;
        return b.count - a.count || a.name.localeCompare(b.name, "ru");
      });
  }, [places]);

  return (
    <section id="all-places" className="section all-places" aria-label="Заведения Не Усложняй">
      <div className="section-head all-places-head">
        <div>
          <p className="eyebrow">Вся сеть</p>
          <h2>{places.length} МЕСТ.<br />{grouped.length} ГОРОДОВ.</h2>
        </div>
        <div className="network-head-copy">
          <p className="section-intro">Выбирай город, смотри пространство и сразу строй маршрут. Никакой карты, только реальные места, фото и контакты.</p>
          <span>{cmsReady ? "Актуальные данные из NU OS" : "Резервный снимок сети · NU OS обновит его автоматически"}</span>
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
            <a key={group.name} href={`#network-city-${index + 1}`}>
              <span className="network-city-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="network-city-name">{group.name}</span>
              <span className="network-city-count">{group.count} {pluralPlaces(group.count)}</span>
              <span className="network-city-arrow">↘</span>
            </a>
          ))}
        </div>
      </div>

      <div className="network-city-sections">
        {grouped.map((group, index) => (
          <section className="network-city-section" id={`network-city-${index + 1}`} key={group.name}>
            <div className="selected-city-head">
              <div>
                <p className="eyebrow">Город {String(index + 1).padStart(2, "0")}</p>
                <h3>{group.name}</h3>
              </div>
              <div className="selected-city-meta">
                <span>{group.count} {pluralPlaces(group.count)}</span>
                <small>Фото · телефон · рейтинг · маршрут</small>
              </div>
            </div>

            <div className="all-places-grid">
              {group.items.map((place) => <PlaceCard place={place} key={place.slug} />)}
            </div>
          </section>
        ))}
      </div>

      <div className="network-franchise-bridge">
        <div>
          <span>СЕТЬ РАСТЁТ</span>
          <h3>Следующий город<br />может быть твоим.</h3>
        </div>
        <a href="#franchise">Открыть Не Усложняй →</a>
      </div>
    </section>
  );
}
