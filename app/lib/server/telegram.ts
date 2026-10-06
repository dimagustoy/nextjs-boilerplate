import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export function sameSecret(actual: string | null, expected: string | undefined) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || /\s/.test(key)) throw new Error("Supabase server configuration missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function activeUser(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return null;
  const admin = adminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile, error: profileError } = await admin.from("profiles").select("role,is_active").eq("id", user.id).single();
  if (profileError || !profile?.is_active) return null;
  return { id: user.id, role: profile.role as string, admin };
}
export function appUrl() {
  const url = new URL(process.env.APP_URL || "https://nextjs-boilerplate-nu-team2.vercel.app");
  if (url.protocol !== "https:") throw new Error("APP_URL must use HTTPS");
  return url.origin;
}
export class TelegramError extends Error {
  constructor(public code: number, public retryAfter: number = 60) { super(`Telegram error ${code}`); }
}
export async function telegram(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || /\s/.test(token)) throw new Error("Telegram configuration missing");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new TelegramError(data.error_code || response.status, data.parameters?.retry_after || 60);
  return data.result;
}

let webhookSubscriptionChecked = false;

export async function ensureTelegramWebhookSubscription() {
  if (webhookSubscriptionChecked) return;
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return;

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
    throw new Error("Telegram webhook secret missing or invalid");
  }

  const expectedUrl = `${appUrl()}/api/telegram/webhook`;
  const info = await telegram("getWebhookInfo", {});
  const allowed = Array.isArray(info?.allowed_updates) ? info.allowed_updates : [];
  const hasRequiredUpdates = allowed.includes("message") && allowed.includes("callback_query");

  if (info?.url !== expectedUrl || !hasRequiredUpdates) {
    await telegram("setWebhook", {
      url: expectedUrl,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      max_connections: 2,
    });
  }

  webhookSubscriptionChecked = true;
}
