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

export default function NetworkDirectory() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [city, setCity] = useState("Все");

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
    if (window.location.hash === "#all-places") requestAnimationFrame(() => host?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  useEffect(() => {
    fetch("/api/content", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setPlaces(Array.isArray(data.locations) ? data.locations : []))
      .catch(() => setPlaces([]));
  }, []);

  const cities = useMemo(() => ["Все", ...Array.from(new Set(places.map((place) => place.city)))], [places]);
  const visible = useMemo(() => city === "Все" ? places : places.filter((place) => place.city === city), [places, city]);

  if (!mount) return null;

  return createPortal(
    <>
      <div className="section-head all-places-head">
        <div><p className="eyebrow">Вся сеть</p><h2>15 МЕСТ.<br />11 ГОРОДОВ.</h2></div>
        <p className="section-intro">Выбирай город, смотри реальные фотографии и сразу звони или строй маршрут. Бронирование — по телефону выбранного заведения.</p>
      </div>

      <div className="city-filters" aria-label="Фильтр заведений по городу">
        {cities.map((item) => (
          <button key={item} className={city === item ? "city-chip active" : "city-chip"} onClick={() => setCity(item)}>{item}</button>
        ))}
      </div>

      <div className="all-places-grid">
        {visible.map((place) => (
          <article className="network-card" key={place.slug}>
            <a className="network-card-image" href={`/places/${place.slug}`}>
              {place.hero_image_url ? <img src={place.hero_image_url} alt={`${place.city}, ${place.name}`} loading="lazy" /> : <div className="network-image-placeholder">NU</div>}
              <span>{place.city}</span>
            </a>
            <div className="network-card-body">
              <div className="network-card-title">
                <div><p>{place.city}</p><h3>{place.name}</h3></div>
                <div className="network-ratings">
                  {place.rating_2gis != null && <span><b>{Number(place.rating_2gis).toFixed(1)}</b> 2ГИС</span>}
                  {place.rating_yandex != null && <span><b>{Number(place.rating_yandex).toFixed(1)}</b> Яндекс</span>}
                </div>
              </div>
              <p className="network-address">{place.address}</p>
              {Array.isArray(place.opening_hours) && place.opening_hours.length > 0 && <div className="network-hours">{place.opening_hours.map((hours) => <span key={hours}>{hours}</span>)}</div>}
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
    </>,
    mount,
  );
}
