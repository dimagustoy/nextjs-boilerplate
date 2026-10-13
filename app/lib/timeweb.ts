import "server-only";

const TIMEWEB_API_BASE = "https://api.timeweb.cloud/api/v1";

export async function timewebRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.TIMEWEB_API_TOKEN;

  if (!token) {
    throw new Error("TIMEWEB_API_TOKEN is not configured");
  }

  const response = await fetch(`${TIMEWEB_API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Timeweb API error ${response.status}: ${body.slice(0, 300)}`);
  }

  return response.json() as Promise<T>;
}
