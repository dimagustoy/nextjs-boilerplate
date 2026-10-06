import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const supabase = client();
  if (!supabase) return NextResponse.json({ locations: [], articles: [] });

  const [locationsResult, articlesResult] = await Promise.all([
    supabase
      .from("site_locations")
      .select("id,slug,city,name,address,phone,short_description,hero_image_url,two_gis_url,yandex_maps_url,rating_2gis,rating_yandex,opening_hours,sort_order")
      .order("sort_order", { ascending: true }),
    supabase
      .from("site_articles")
      .select("id,slug,title,excerpt,category,cover_image_url,published_at,is_featured,source_type,source_url,home_order")
      .eq("show_on_home", true)
      .eq("is_published", true)
      .order("home_order", { ascending: true })
      .order("published_at", { ascending: false })
      .limit(3),
  ]);

  return NextResponse.json(
    {
      locations: locationsResult.data ?? [],
      articles: articlesResult.data ?? [],
    },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
  );
}
