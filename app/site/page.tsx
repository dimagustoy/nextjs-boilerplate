import Link from "next/link";
import { supabase } from "../lib/supabase";
import FranchiseForm from "./FranchiseForm";
import styles from "./site.module.css";

export const dynamic = "force-dynamic";

type Location = {
  id: string;
  slug: string;
  city: string;
  name: string;
  address: string | null;
  short_description: string | null;
  two_gis_url: string | null;
  yandex_maps_url: string | null;
};

type Article = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  category: string;
  published_at: string | null;
};

const categoryLabel: Record<string,string> = {
  news: "Новости",
  events: "События",
  people: "Люди",
  food: "Еда и напитки",
  brand: "Не Усложняй",
  openings: "Открытия",
};

export default async function PublicSite() {
  const [{ data: locations }, { data: articles }] = await Promise.all([
    supabase
      .from("site_locations")
      .select("id,slug,city,name,address,short_description,two_gis_url,yandex_maps_url")
      .order("sort_order", { ascending: true }),
    supabase
      .from("site_articles")
      .select("id,slug,title,excerpt,category,published_at")
      .order("published_at", { ascending: false })
      .limit(4),
  ]);

  const visibleLocations = (locations || []) as Location[];
  const visibleArticles = (articles || []) as Article[];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/site" className={styles.brand}>НЕ УСЛОЖНЯЙ</Link>
        <nav className={styles.nav}>
          <a href="#places">Заведения</a>
          <a href="#journal">Журнал</a>
          <a href="#about">О нас</a>
          <a href="#franchise">Франшиза</a>
          <a className={styles.cta} href="#places">Найти NU</a>
        </nav>
      </header>

      <section className={styles.shell}>
        <div className={styles.hero}>
          <div>
            <div className={styles.eyebrow}>Не Усложняй · с 2019 года</div>
            <h1>МЕСТО,<br/>ГДЕ МОЖНО<br/>ПРОСТО БЫТЬ.</h1>
            <p className={styles.heroCopy}>
              Лаунж-пространства, в которые приходят не за формальностями. За своим столом, знакомыми лицами, длинным вечером и ощущением, что никуда не надо торопиться.
            </p>
            <div className={styles.buttons}>
              <a className={styles.primary} href="#places">Найти Не Усложняй</a>
              <a className={styles.secondary} href="#journal">Что у нас происходит</a>
            </div>
          </div>
          <div className={styles.heroVisual} aria-label="Фирменная визуальная композиция Не Усложняй" />
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}><strong>15</strong><span>заведений по стране</span></div>
          <div className={styles.stat}><strong>11</strong><span>городов</span></div>
          <div className={styles.stat}><strong>1</strong><span>характер: не усложнять</span></div>
        </div>
      </section>

      <section className={styles.section} id="places">
        <div className={styles.shell}>
          <div className={styles.sectionTitleRow}>
            <div><div className={styles.eyebrow}>Куда сегодня</div><h2 className={styles.sectionTitle}>ВЫБЕРИ СВОЙ NU</h2></div>
            <p className={styles.sectionLead}>Не каталог филиалов, а характер каждой точки. Скоро здесь будут фотографии, меню, события, маршруты и всё, что помогает выбрать место на вечер.</p>
          </div>
          <div className={styles.placesGrid}>
            {visibleLocations.map((place, index) => (
              <article className={styles.placeCard} key={place.id}>
                <div className={styles.placeIndex}>{String(index + 1).padStart(2,"0")} · {place.city}</div>
                <div>
                  <h3>{place.name}</h3>
                  <div className={styles.placeMeta}>{place.address || "Адрес скоро"}</div>
                  <p className={styles.placeDesc}>{place.short_description}</p>
                  {(place.two_gis_url || place.yandex_maps_url) && (
                    <a className={styles.placeLink} href={place.two_gis_url || place.yandex_maps_url || "#"} target="_blank" rel="noreferrer">Построить маршрут →</a>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.sectionDark}>
        <div className={styles.shell}>
          <div className={styles.sectionTitleRow}>
            <div><div className={styles.eyebrow}>Атмосфера</div><h2 className={styles.sectionTitle}>НЕ ОБЪЯСНЯЕМ.<br/>ПОКАЗЫВАЕМ.</h2></div>
            <p className={styles.sectionLead}>Этот блок рассчитан на реальные фотографии сети: люди, столы, свет, детали интерьера и жизнь внутри заведений. Никаких стоковых улыбок человека, который якобы невероятно счастлив от чашки кофе.</p>
          </div>
          <div className={styles.photoStrip}>
            <div className={styles.photoBlock}><span>вечера</span></div>
            <div className={styles.photoBlock}><span>люди</span></div>
            <div className={styles.photoBlock}><span>детали</span></div>
          </div>
        </div>
      </section>

      <section className={styles.section} id="journal">
        <div className={styles.shell}>
          <div className={styles.sectionTitleRow}>
            <div><div className={styles.eyebrow}>Сейчас в NU</div><h2 className={styles.sectionTitle}>ЖУРНАЛ</h2></div>
            <p className={styles.sectionLead}>Открытия, люди, события, меню и всё, что делает сеть живой. Материалы управляются из CMS и могут автоматически появляться на страницах конкретных заведений.</p>
          </div>
          <div className={styles.journalGrid}>
            {visibleArticles.map((article) => (
              <article className={styles.article} key={article.id}>
                <div className={styles.articleTag}>{categoryLabel[article.category] || article.category}</div>
                <div>
                  <h3>{article.title}</h3>
                  <p>{article.excerpt}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.sectionDark} id="about">
        <div className={styles.shell}>
          <div className={styles.manifesto}>
            <h2 className={styles.manifestoBig}>МЫ НЕ СТРОИЛИ «КОНЦЕПЦИЮ».</h2>
            <div className={styles.manifestoText}>
              <p>Мы хотели сделать место, куда самим хочется возвращаться. Без лишнего пафоса, натянутой гостеприимности и ощущения, что вечером надо соответствовать заведению.</p>
              <p>Не Усложняй вырос из одной идеи в сеть по стране. Характер остался тем же: проще, теплее, ближе к людям.</p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} id="franchise">
        <div className={styles.shell}>
          <div className={styles.franchise}>
            <div>
              <div className={styles.eyebrow}>Франшиза</div>
              <h2 className={styles.sectionTitle}>ОТКРОЙ NU<br/>В СВОЁМ ГОРОДЕ</h2>
              <p className={styles.sectionLead}>Отдельная воронка для будущего партнёра: масштаб бренда, экономика, поддержка сети, реальные кейсы и заявка. Без попытки продать франшизу человеку, который просто искал, где сегодня посидеть.</p>
            </div>
            <FranchiseForm />
          </div>
        </div>
      </section>

      <footer className={styles.shell}>
        <div className={styles.footer}>
          <span>© {new Date().getFullYear()} Не Усложняй</span>
          <span>Екатеринбург · Россия</span>
        </div>
      </footer>
    </main>
  );
}
