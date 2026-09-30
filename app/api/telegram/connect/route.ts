import { randomBytes } from "node:crypto";
import { activeUser, tokenHash } from "../../../lib/server/telegram";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await activeUser(request);
    if (!user) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const { data, error } = await user.admin.from("telegram_links").select("username,connected_at").eq("user_id", user.id).maybeSingle();
    if (error) return Response.json({ error: "Telegram ещё не настроен" }, { status: 503 });
    return Response.json({ connected: !!data, username: data?.username, configured: !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_BOT_USERNAME }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Telegram ещё не настроен" }, { status: 503 }); }
}
export async function POST(request: Request) {
  try {
    const user = await activeUser(request);
    if (!user) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const name = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
    if (!name || !/^[A-Za-z0-9_]{5,32}$/.test(name) || !process.env.TELEGRAM_BOT_TOKEN) return Response.json({ error: "Telegram ещё не настроен" }, { status: 503 });
    const token = randomBytes(24).toString("base64url");
    const { error } = await user.admin.from("telegram_link_tokens").upsert({ user_id: user.id, token_hash: tokenHash(token), expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
    if (error) return Response.json({ error: "Не удалось создать ссылку" }, { status: 500 });
    return Response.json({ url: `https://t.me/${name}?start=${token}` }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Telegram ещё не настроен" }, { status: 503 }); }
}
export async function DELETE(request: Request) {
  try {
    const user = await activeUser(request);
    if (!user) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const { error } = await user.admin.rpc("nu_telegram_disconnect", { p_user: user.id });
    if (error) return Response.json({ error: "Не удалось отключить Telegram" }, { status: 500 });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "Telegram ещё не настроен" }, { status: 503 }); }
}
