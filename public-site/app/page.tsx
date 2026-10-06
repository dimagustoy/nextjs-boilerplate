"use client";

import { FormEvent, useEffect, useState } from "react";

type Article = {
  id?: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  category: string;
  cover_image_url?: string | null;
  published_at?: string | null;
};

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
  const [articles, setArticles] = useState<Article[]>(fallbackArticles);
  const [menuOpen, setMenuOpen] = useState(false);
  const [leadState, setLeadState] = useState<"idle" | "loading" | "success" | "error">("idle");

  useEffect(() => {
    async function loadCms() {
      try {
        const res = await fetch("/api/content", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.articles) && data.articles.length) {
          const liveArticles = data.articles as Article[];
          const liveSlugs = new Set(liveArticles.map((article) => article.slug));
          const fillers = fallbackArticles.filter((article) => !liveSlugs.has(article.slug));
          setArticles([...liveArticles, ...fillers].slice(0, 3));
        }
      } catch {
        // Fallback stories keep the journal alive before CMS content is filled.
      }
    }
    loadCms();
  }, []);

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
        <a className="header-cta" href="#all-places">Найти NU</a>
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
            <a className="button button-orange" href="#all-places">Найти Не Усложняй</a>
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

      <section className="section places places-intro" id="places">
        <div className="section-head">
          <div>
            <p className="eyebrow">Выбери своё</p>
            <h2>НАЙДИ<br />СВОЙ NU.</h2>
          </div>
          <div className="places-intro-copy">
            <p className="section-intro">Не каталог адресов, а разные характеры одного бренда. Выбирай город на карте, смотри пространство и строй маршрут.</p>
            <a className="text-link" href="#all-places">Открыть карту сети ↓</a>
          </div>
        </div>
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
              <div className="article-image">
                <img src={article.cover_image_url || fallbackArticles[index % fallbackArticles.length].cover_image_url!} alt={article.title} />
              </div>
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
        <div className="strip-photo strip-one" />
        <div className="strip-photo strip-two" />
        <div className="strip-copy">НЕ<br />УСЛОЖНЯЙ<br /><span>ВЕЧЕР.</span></div>
        <div className="strip-photo strip-three" />
      </section>

      <section className="franchise" id="franchise">
        <div className="franchise-copy">
          <p className="eyebrow">Франшиза</p>
          <h2>СЛЕДУЮЩАЯ<br />ТОЧКА НА КАРТЕ<br /><span>МОЖЕТ БЫТЬ ТВОЕЙ.</span></h2>
          <p>Мы уже работаем в 11 городах. Даём бренд, продуктовую и маркетинговую систему, партнёрские условия и поддержку сети.</p>
          <div className="mini-stats">
            <div><strong>15</strong><span>точек</span></div>
            <div><strong>11</strong><span>городов</span></div>
            <div><strong>2019</strong><span>год основания</span></div>
          </div>
        </div>

        <form className="lead-form" onSubmit={submitLead}>
          <h3>Поговорим о городе</h3>
          <input name="full_name" placeholder="Имя" required minLength={2} />
          <input name="phone" placeholder="Телефон" required minLength={5} />
          <input name="city" placeholder="Город" required minLength={2} />
          <select name="budget" defaultValue="">
            <option value="" disabled>Бюджет на запуск</option>
            <option>до 5 млн ₽</option>
            <option>5–10 млн ₽</option>
            <option>10–15 млн ₽</option>
            <option>15+ млн ₽</option>
          </select>
          <input className="hp" type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <button className="button button-orange" disabled={leadState === "loading"}>
            {leadState === "loading" ? "Отправляем…" : "Получить информацию"}
          </button>
          {leadState === "success" && <p className="form-success">Заявка отправлена. Свяжемся с тобой.</p>}
          {leadState === "error" && <p className="form-error">Не получилось отправить. Попробуй ещё раз.</p>}
          <small>Нажимая кнопку, вы соглашаетесь на обработку персональных данных.</small>
        </form>
      </section>

      <footer>
        <a className="brand footer-brand" href="#top">НЕ<br />УСЛОЖНЯЙ</a>
        <div><p>Заведения</p><a href="#all-places">Найти NU</a><a href="#journal">Журнал</a></div>
        <div><p>Бренд</p><a href="#about">О нас</a><a href="#franchise">Франшиза</a></div>
        <div className="footer-note">© 2019–2026<br />Не Усложняй</div>
      </footer>
    </main>
  );
}
