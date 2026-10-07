"use client";

import { FormEvent, useEffect, useState } from "react";
import HeroCarousel from "./HeroCarousel";
import NetworkDirectory from "./NetworkDirectory";

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
    cover_image_url: "https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=1600&q=88",
  },
  {
    slug: "gagarin-opening",
    title: "Гагарин: новый формат внутри знакомого NU",
    excerpt: "Больше пространства, новая кухня и ещё один повод не ехать домой слишком рано.",
    category: "openings",
    cover_image_url: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1400&q=88",
  },
  {
    slug: "people-of-nu",
    title: "Люди, из-за которых место становится своим",
    excerpt: "Истории команды и гостей, которые делают «Не Усложняй» живым брендом, а не вывеской.",
    category: "people",
    cover_image_url: "https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=1400&q=88",
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
          <a href="#all-places" onClick={() => setMenuOpen(false)}>Заведения</a>
          <a href="#journal" onClick={() => setMenuOpen(false)}>Журнал</a>
          <a href="#about" onClick={() => setMenuOpen(false)}>О нас</a>
          <a href="#franchise" onClick={() => setMenuOpen(false)}>Франшиза</a>
        </nav>
        <a className="header-cta" href="#all-places">Найти NU</a>
        <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Меню">{menuOpen ? "×" : "☰"}</button>
      </header>

      <section className="hero" id="top">
        <HeroCarousel />
        <div className="hero-shade" />
        <div className="hero-wordmark" aria-hidden="true">NU</div>
        <div className="hero-rail" aria-hidden="true"><span>НЕ УСЛОЖНЯЙ</span><span>EST. 2019</span></div>
        <div className="hero-copy">
          <p className="eyebrow light">Не Усложняй · с 2019 года</p>
          <h1>МЕСТО,<br />ГДЕ МОЖНО<br /><span>ПРОСТО БЫТЬ.</span></h1>
          <p className="hero-sub">Свои люди, знакомое ощущение и вечер, которому не нужен сценарий.</p>
          <div className="hero-actions">
            <a className="button button-orange" href="#all-places">Найти Не Усложняй</a>
            <a className="text-link light" href="#journal">Что у нас происходит ↘</a>
          </div>
        </div>
        <div className="hero-stamp"><b>NU</b><span>СВОЁ МЕСТО<br />БЕЗ ЛИШНЕГО</span></div>
        <div className="scroll-note">ЛИСТАЙ<br />ВНИЗ ↓</div>
      </section>

      <section className="stats-band" aria-label="О бренде">
        <div><strong>2019</strong><span>начали в Екатеринбурге</span></div>
        <div><strong>NU</strong><span>один характер, разные города</span></div>
        <p>Не делаем вид, что всё сложно.<br />Делаем места, куда хочется возвращаться.</p>
      </section>

      <section className="section places places-intro" id="places">
        <div className="section-head">
          <div>
            <p className="eyebrow">Выбери своё</p>
            <h2>НАЙДИ<br />СВОЙ NU.</h2>
          </div>
          <div className="places-intro-copy">
            <p className="section-intro">Не каталог адресов, а разные характеры одного бренда. Выбирай город, смотри пространство и строй маршрут.</p>
            <a className="text-link" href="#all-places">Смотреть города ↓</a>
          </div>
        </div>
      </section>

      <NetworkDirectory />

      <section className="manifesto" id="about">
        <p className="eyebrow light">Зачем мы вообще это сделали</p>
        <p className="manifesto-text">МЫ НЕ СТРОИЛИ<br />«КОНЦЕПЦИЮ».<br /><span>МЫ ДЕЛАЛИ МЕСТО,</span><br />КУДА САМИ ХОТИМ<br />ВОЗВРАЩАТЬСЯ.</p>
        <div className="manifesto-foot"><span>С 2019 года</span><span>Екатеринбург → дальше</span></div>
      </section>

      <section className="section journal" id="journal">
        <div className="section-head journal-head">
          <div><p className="eyebrow">Сейчас в NU</p><h2>ЖУРНАЛ</h2></div>
          <div className="journal-side-copy"><p className="section-intro">События, люди, открытия, еда и истории. Не корпоративные новости, а жизнь бренда.</p><span>NU / STORIES / NOW</span></div>
        </div>
        <div className="article-grid">
          {articles.slice(0, 3).map((article, index) => (
            <article className={index === 0 ? "article-card article-main" : "article-card"} key={article.slug}>
              <div className="article-image">
                <img src={article.cover_image_url || fallbackArticles[index % fallbackArticles.length].cover_image_url!} alt={article.title} />
                <span className="article-number">0{index + 1}</span>
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
        <div className="strip-copy"><small>ВЕЧЕР НЕ НУЖНО</small>НЕ<br />УСЛОЖНЯТЬ<span>ЕГО НУЖНО<br />ПРОЖИТЬ.</span></div>
        <div className="strip-photo strip-two" />
        <div className="strip-photo strip-three" />
      </section>

      <section className="franchise" id="franchise">
        <div className="franchise-copy">
          <p className="eyebrow">Франшиза</p>
          <h2>СЛЕДУЮЩИЙ<br />ГОРОД МОЖЕТ<br /><span>БЫТЬ ТВОИМ.</span></h2>
          <p>Сеть растёт. Даём бренд, продуктовую и маркетинговую систему, партнёрские условия и поддержку команды.</p>
          <div className="mini-stats">
            <div><strong>2019</strong><span>год основания</span></div>
            <div><strong>NU</strong><span>единый бренд</span></div>
            <div><strong>↗</strong><span>сеть растёт</span></div>
          </div>
        </div>

        <form className="lead-form" onSubmit={submitLead}>
          <p className="form-kicker">НЕ УСЛОЖНЯЙ · ФРАНШИЗА</p>
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
