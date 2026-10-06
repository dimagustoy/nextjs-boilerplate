"use client";

import { useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

type SourceArticle = {
  title: string;
  source_url: string | null;
  source_type: string | null;
};

export default function JournalSourceLinks() {
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return;

    const supabase = createClient(url, key, { auth: { persistSession: false } });
    let observer: MutationObserver | null = null;
    let disposed = false;

    async function run() {
      const { data } = await supabase
        .from("site_articles")
        .select("title,source_url,source_type")
        .not("source_url", "is", null)
        .order("published_at", { ascending: false })
        .limit(20);

      if (disposed || !data?.length) return;
      const sources = new Map((data as SourceArticle[]).map((item) => [item.title.trim(), item]));

      const apply = () => {
        document.querySelectorAll<HTMLElement>(".journal .article-card").forEach((card) => {
          const title = card.querySelector("h3")?.textContent?.trim();
          const link = card.querySelector<HTMLAnchorElement>(".article-copy a");
          if (!title || !link) return;
          const source = sources.get(title);
          if (!source?.source_url) return;
          link.href = source.source_url;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = source.source_type === "telegram" ? "Читать в Telegram ↗" : "Читать историю ↗";
        });
      };

      apply();
      observer = new MutationObserver(apply);
      const journal = document.querySelector("#journal");
      if (journal) observer.observe(journal, { subtree: true, childList: true });
    }

    run();
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, []);

  return null;
}
