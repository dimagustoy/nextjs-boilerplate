import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function clean(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service_unavailable" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  if (clean(body.company, 200)) return NextResponse.json({ ok: true });

  const full_name = clean(body.full_name, 120);
  const phone = clean(body.phone, 40);
  const city = clean(body.city, 120);
  const budget = clean(body.budget, 80) || null;

  if (full_name.length < 2 || phone.length < 5 || city.length < 2) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await supabase.from("site_franchise_leads").insert({
    full_name,
    phone,
    city,
    budget,
    source: "website",
  });

  if (error) return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
