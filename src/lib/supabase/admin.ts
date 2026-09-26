import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/**
 * Secret-key client: bypasses RLS. Only for the public booking flow, verification codes, sms_log,
 * patient links, sendPush, the daily job, the PayMongo webhook, and /admin after requireOperator.
 * Staff pages use serverClient() so RLS applies.
 */
export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY is not set");
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
