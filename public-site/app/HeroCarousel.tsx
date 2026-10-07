"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fallbackPlaces } from "./fallback-locations";
import heroImages from "./hero-images.json";

type HeroSlide = {
  slug: string;
  city: string;
  name: string;
  hero_image_url: string;
};

const preferredOrder = [
  "ekb-beloglazova-2g",
  "kazan-karbysheva-40a",
  "samara-karla-marksa-196",
  "tyumen-volodarskogo-14",
  "petrozavodsk-pervomayskiy-4b",
  "ekb-turgeneva-22",
  "ivanovo-gromoboya-15a",
  "astrakhan-fioletova-8",
  "ekb-chkalova-258",
  "kostroma-gornaya-27a",
  "irkutsk-uritskogo-7a",
  "ekb-tatishcheva-47a",
  "bryansk-ulyanova-123a",
  "samara-fadeeva-42v",
  "yaroslavl-deputatskiy-2",
];

function normalizeSlides(input: any[]): HeroSlide[] {
  const slides = input
    .filter((place) => place?.slug && place?.city && place?.name && place?.hero_image_url)
    .map((place) => ({
      slug: String(place.slug),
      city: String(place.city),
      name: String(place.name),
      hero_image_url: (heroImages as Record<string, string>)[String(place.hero_image_url)] || String(place.hero_image_url),
    }));

  return slides.sort((a, b) => {
    const ai = preferredOrder.indexOf(a.slug);
    const bi = preferredOrder.indexOf(b.slug);
    const aRank = ai === -1 ? 999 : ai;
    const bRank = bi === -1 ? 999 : bi;
    if (aRank !== bRank) return aRank - bRank;
    return `${a.city}${a.name}`.localeCompare(`${b.city}${b.name}`, "ru");
  });
}

const fallbackSlides = normalizeSlides(fallbackPlaces);

export default function HeroCarousel() {
  const [slides, setSlides] = useState<HeroSlide[]>(fallbackSlides);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/content", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        const liveSlides = normalizeSlides(Array.isArray(data.locations) ? data.locations : []);
        if (liveSlides.length) {
          setSlides(liveSlides);
          setActiveIndex(0);
          setPreviousIndex(null);
        }
      })
      .catch(() => undefined);
  }, []);

  const [paused, setPaused] = useState(true);
  const requestId = useRef(0);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPaused(preference.matches);
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  const showSlide = useCallback((index: number) => {
    if (slides.length < 2) return;
    const nextIndex = (index + slides.length) % slides.length;
    const request = ++requestId.current;
    const image = new Image();
    image.onload = () => {
      if (request !== requestId.current) return;
      setPreviousIndex(activeIndex);
      setActiveIndex(nextIndex);
    };
    image.src = slides[nextIndex].hero_image_url;
  }, [activeIndex, slides]);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const timer = window.setInterval(() => showSlide(activeIndex + 1), 4800);
    return () => window.clearInterval(timer);
  }, [activeIndex, paused, showSlide, slides.length]);

  useEffect(() => () => { requestId.current += 1; }, [slides]);

  useEffect(() => {
    if (previousIndex == null) return;
    const timeout = window.setTimeout(() => setPreviousIndex(null), 1400);
    return () => window.clearTimeout(timeout);
  }, [activeIndex, previousIndex]);

  useEffect(() => {
    if (!slides.length || typeof window === "undefined") return;
    const next = slides[(activeIndex + 1) % slides.length];
    const preload = new Image();
    preload.src = next.hero_image_url;
  }, [activeIndex, slides]);

  const active = slides[activeIndex] || fallbackSlides[0];
  const previous = previousIndex == null ? null : slides[previousIndex];
  const count = slides.length;
  const indexLabel = String(activeIndex + 1).padStart(2, "0");
  const countLabel = String(count).padStart(2, "0");

  const alt = active ? `${active.city}, ${active.name} · Не Усложняй` : "";

  if (!active) return <div className="hero-media" />;

  return (
    <div className="hero-media hero-carousel" aria-label="Заведения Не Усложняй">
      {previous && (
        <img
          className="hero-carousel-image hero-carousel-previous"
          src={previous.hero_image_url}
          alt=""
          aria-hidden="true"
          width={1920}
          height={1080}
        />
      )}
      <img
        key={active.slug}
        className="hero-carousel-image hero-carousel-current"
        src={active.hero_image_url}
        alt={alt}
        width={1920}
        height={1080}
        fetchPriority={activeIndex === 0 ? "high" : "auto"}
      />
      <div className="hero-carousel-meta" aria-live={paused ? "polite" : "off"}>
        <span>{active.city}</span>
        <strong>{active.name}</strong>
        <small>{indexLabel} / {countLabel}</small>
      </div>
      {count > 1 && <div className="hero-carousel-controls" aria-label="Управление фотографиями">
        <button type="button" aria-label="Предыдущее фото" onClick={() => { setPaused(true); showSlide(activeIndex - 1); }}>←</button>
        <button type="button" aria-label={paused ? "Запустить смену фото" : "Приостановить смену фото"} onClick={() => setPaused(!paused)}>{paused ? "▶" : "Ⅱ"}</button>
        <button type="button" aria-label="Следующее фото" onClick={() => { setPaused(true); showSlide(activeIndex + 1); }}>→</button>
      </div>}
    </div>
  );
}
