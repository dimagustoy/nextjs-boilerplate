import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publicKey || !secret) return NextResponse.json({ error: "Приглашения ещё не настроены в Vercel" }, { status: 503 });
  if (/\s/.test(secret)) return NextResponse.json({ error: "Ключ Supabase в Vercel содержит пробел или перенос строки. Создайте новый ключ и замените значение переменной SUPABASE_SECRET_KEY." }, { status: 503 });
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const auth = createClient(url, publicKey, { auth: { persistSession: false } });
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await auth.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Недействительная сессия" }, { status: 401 });
  const userClient = createClient(url, publicKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: owner, error: profileError } = await userClient.from("profiles").select("role,is_active").eq("id", user.id).single();
  if (profileError) return NextResponse.json({ error: `Не удалось проверить роль: ${profileError.message}` }, { status: 500 });
  if (owner?.role !== "owner" || !owner.is_active) return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  let input: { email?: string; full_name?: string; role?: string };
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Некорректные данные" }, { status: 400 }); }
  const email = input.email?.trim().toLowerCase();
  const fullName = input.full_name?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length > 100 || !["manager", "smm", "senior_master"].includes(input.role || "")) {
    return NextResponse.json({ error: "Проверьте имя, email и роль" }, { status: 400 });
  }
  try {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName } });
    if (error || !data.user) return NextResponse.json({ error: error?.message || "Не удалось пригласить" }, { status: 400 });
    const { error: saveError } = await admin.from("profiles").upsert({ id: data.user.id, full_name: fullName, role: input.role, is_active: true });
    if (saveError) return NextResponse.json({ error: `Приглашение отправлено, но профиль не сохранён: ${saveError.message}` }, { status: 500 });
  } catch {
    return NextResponse.json({ error: "Supabase отклонил серверный ключ. Проверьте SUPABASE_SECRET_KEY в Vercel." }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
