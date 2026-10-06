"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Location = {
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
};

type Article = {
  id?: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  category: string;
  cover_image_url?: string | null;
  published_at?: string | null;
};

const fallbackLocations: Location[] = [
  {
    slug: "turgeneva-22",
    city: "Екатеринбург",
    name: "Тургенева, 22",
    address: "ул. Тургенева, 22",
    short_description: "Точка в центре города. Для встреч, долгих разговоров и вечеров без лишнего шума.",
    hero_image_url: "https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=1400&q=85",
  },
  {
    slug: "tatischeva-47a",
    city: "Екатеринбург",
    name: "Татищева, 47А",
    address: "ул. Татищева, 47А",
    short_description: "Камерный NU на ВИЗе. Место для неспешных вечеров и своих людей.",
    hero_image_url: "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1400&q=85",
  },
  {
    slug: "chkalova-258",
    city: "Екатеринбург",
    name: "Чкалова, 258",
    address: "ул. Чкалова, 258",
    short_description: "Просторная точка на юге города. Когда хочется собраться компанией и никуда не спешить.",
    hero_image_url: "https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=1400&q=85",
  },
  {
    slug: "gagarin",
    city: "Екатеринбург",
    name: "Гагарин",
    address: "Белоглазова, 2Г",
    short_description: "Новый большой NU с собственным характером, кухней и пространством для событий.",
    hero_image_url: "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1400&q=85",
  },
];

const fallbackArticles: Article[] = [
  {
    slug: "brand-story",
    title: "Не усложнять — это не про делать меньше",
    excerpt: "Как из одной идеи выросла сеть, которая остаётся местом для своих.",
    category: "brand",
    cover_image_url: "https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=1400&q=85",
  },
  {
    slug: "gagarin-opening",
    title: "Гагарин: новый формат внутри знакомого NU",
    excerpt: "Больше пространства, новая кухня и ещё один повод не ехать домой слишком рано.",
    category: "openings",
    cover_image_url: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1400&q=85",
  },
  {
    slug: "people-of-nu",
    title: "Люди, из-за которых место становится своим",
    excerpt: "Истории команды и гостей, которые делают «Не Усложняй» живым брендом, а не вывеской.",
    category: "people",
    cover_image_url: "https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=1400&q=85",
  },
];

const categoryLabel: Record<string, string> = {
  news: "Новости",
  events: "События",
  people: "Люди",
  food: "Еда и напитки",
  brand: "Не усложняй",
  openings: "Новые места",
};

export default function Home() {
  const [locations, setLocations] = useState<Location[]>(fallbackLocations);
  const [articles, setArticles] = useState<Article[]>(fallbackArticles);
  const [menuOpen, setMenuOpen] = useState(false);
  const [leadState, setLeadState] = useState<"idle" | "loading" | "success" | "error">("idle");

  useEffect(() => {
    async function loadCms() {
      try {
        const res = await fetch("/api/content", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.locations) && data.locations.length) setLocations(data.locations);
        if (Array.isArray(data.articles) && data.articles.length) setArticles(data.articles);
      } catch {
        // Fallback content keeps the site usable before CMS data is filled.
      }
    }
    loadCms();
  }, []);

  const featured = useMemo(() => locations.slice(0, 4), [locations]);

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLeadState("loading");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/franchise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("failed");
      setLeadState("success");
      event.currentTarget.reset();
    } catch {
      setLeadState("error");
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Не Усложняй">НЕ<br />УСЛОЖНЯЙ</a>
        <nav className={menuOpen ? "nav nav-open" : "nav"}>
          <a href="#places" onClick={() => setMenuOpen(false)}>Заведения</a>
          <a href="#journal" onClick={() => setMenuOpen(false)}>Журнал</a>
          <a href="#about" onClick={() => setMenuOpen(false)}>О нас</a>
          <a href="#franchise" onClick={() => setMenuOpen(false)}>Франшиза</a>
        </nav>
        <a className="header-cta" href="#places">Найти NU</a>
        <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Меню">{menuOpen ? "×" : "☰"}</button>
      </header>

      <section className="hero" id="top">
        <div className="hero-media" />
        <div className="hero-shade" />
        <div className="hero-copy">
          <p className="eyebrow light">15 заведений · 11 городов</p>
          <h1>МЕСТО,<br />ГДЕ МОЖНО<br /><span>ПРОСТО БЫТЬ.</span></h1>
          <p className="hero-sub">Не Усложняй — это свои люди, знакомое ощущение и вечер, которому не нужен сценарий.</p>
          <div className="hero-actions">
            <a className="button button-orange" href="#places">Найти Не Усложняй</a>
            <a className="text-link light" href="#journal">Что у нас происходит ↘</a>
          </div>
        </div>
        <div className="scroll-note">ЛИСТАЙ<br />ВНИЗ ↓</div>
      </section>

      <section className="stats-band">
        <div><strong>15</strong><span>заведений</span></div>
        <div><strong>11</strong><span>городов</span></div>
        <p>Началось в Екатеринбурге.<br />Продолжается по всей стране.</p>
      </section>

      <section className="section places" id="places">
        <div className="section-head">
          <div><p className="eyebrow">Выбери своё</p><h2>НЕ УСЛОЖНЯЙ<br />РЯДОМ</h2></div>
          <p className="section-intro">Не каталог адресов, а разные характеры одного бренда. Смотри атмосферу, выбирай точку и строй маршрут.</p>
        </div>
        <div className="place-grid">
          {featured.map((place, index) => (
            <article className={`place-card place-${index + 1}`} key={place.slug}>
              <img src={place.hero_image_url || fallbackLocations[index % fallbackLocations.length].hero_image_url!} alt={`${place.city}, ${place.name}`} />
              <div className="place-overlay" />
              <div className="place-meta">
                <span>{place.city}</span>
                <h3>{place.name}</h3>
                <p>{place.short_description}</p>
                <div className="place-actions">
                  {place.two_gis_url && <a href={place.two_gis_url} target="_blank">2ГИС ↗</a>}
                  {place.yandex_maps_url && <a href={place.yandex_maps_url} target="_blank">Яндекс Карты ↗</a>}
                  {place.phone && <a href={`tel:${place.phone.replace(/[^+\d]/g, "")}`}>Позвонить ↗</a>}
                  {!place.two_gis_url && !place.yandex_maps_url && !place.phone && <span>{place.address || "Карточка заполняется"}</span>}
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="center-row"><a className="button button-dark" href="#all-places">Все 15 заведений</a></div>
      </section>

      <section className="manifesto" id="about">
        <p className="eyebrow light">Зачем мы вообще это сделали</p>
        <p className="manifesto-text">МЫ НЕ СТРОИЛИ<br />«КОНЦЕПЦИЮ».<br /><span>МЫ ДЕЛАЛИ МЕСТО,</span><br />КУДА САМИ ХОТИМ<br />ВОЗВРАЩАТЬСЯ.</p>
        <div className="manifesto-foot"><span>С 2019 года</span><span>Екатеринбург → Россия</span></div>
      </section>

      <section className="section journal" id="journal">
        <div className="section-head journal-head">
          <div><p className="eyebrow">Сейчас в NU</p><h2>ЖУРНАЛ</h2></div>
          <p className="section-intro">Не «новости компании». События, люди, открытия, еда и истории, из которых складывается жизнь бренда.</p>
        </div>
        <div className="article-grid">
          {articles.slice(0, 3).map((article, index) => (
            <article className={index === 0 ? "article-card article-main" : "article-card"} key={article.slug}>
              <div className="article-image"><img src={article.cover_image_url || fallbackArticles[index % fallbackArticles.length].cover_image_url!} alt={article.title} /></div>
              <div className="article-copy">
                <span>{categoryLabel[article.category] || article.category}</span>
                <h3>{article.title}</h3>
                <p>{article.excerpt}</p>
                <a href={`#story-${article.slug}`}>Читать историю ↗</a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="photo-strip" aria-label="Атмосфера Не Усложняй">
        <div className="strip-photo strip-one" /><div className="strip-photo strip-two" /><div className="strip-copy">НЕ<br />УСЛОЖНЯЙ<br /><span>ВЕЧЕР.</span></div><div className="strip-photo strip-three" />
      </section>

      <section className="franchise" id="franchise">
        <div className="franchise-copy">
          <p className="eyebrow">Франшиза</p>
          <h2>ОТКРОЙ<br />НЕ УСЛОЖНЯЙ<br /><span>В СВОЁМ ГОРОДЕ.</span></h2>
          <p>Мы уже работаем в 11 городах. Даём бренд, продуктовую и маркетинговую систему, партнёрские условия и поддержку сети.</p>
          <div className="mini-stats"><div><strong>15</strong><span>точек</span></div><div><strong>11</strong><span>городов</span></div><div><strong>2019</strong><span>год основания</span></div></div>
        </div>
        <form className="lead-form" onSubmit={submitLead}>
          <h3>Поговорим о городе</h3>
          <input name="full_name" placeholder="Имя" required minLength={2} />
          <input name="phone" placeholder="Телефон" required minLength={5} />
          <input name="city" placeholder="Город" required minLength={2} />
          <select name="budget" defaultValue=""><option value="" disabled>Бюджет на запуск</option><option>до 5 млн ₽</option><option>5–10 млн ₽</option><option>10–15 млн ₽</option><option>15+ млн ₽</option></select>
          <input className="hp" type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <button className="button button-orange" disabled={leadState === "loading"}>{leadState === "loading" ? "Отправляем…" : "Получить информацию"}</button>
          {leadState === "success" && <p className="form-success">Заявка отправлена. Свяжемся с тобой.</p>}
          {leadState === "error" && <p className="form-error">Не получилось отправить. Попробуй ещё раз.</p>}
          <small>Нажимая кнопку, вы соглашаетесь на обработку персональных данных.</small>
        </form>
      </section>

      <footer>
        <a className="brand footer-brand" href="#top">НЕ<br />УСЛОЖНЯЙ</a>
        <div><p>Заведения</p><a href="#places">Найти NU</a><a href="#journal">Журнал</a></div>
        <div><p>Бренд</p><a href="#about">О нас</a><a href="#franchise">Франшиза</a></div>
        <div className="footer-note">© 2019–2026<br />Не Усложняй</div>
      </footer>
    </main>
  );
}
