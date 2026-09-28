import { createClient } from "@supabase/supabase-js";

// Build-time prerender does not need a live connection. Real values are required
// in Vercel and the browser; the existing Auth session is still persisted there.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "build-placeholder";

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey
);
