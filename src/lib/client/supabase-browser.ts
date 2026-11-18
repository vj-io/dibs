"use client";
// supabase-js in the browser: seller email sign-in (OTP code or magic link) and product photo uploads only.
// Business data never goes through it. No session is kept: the access token is handed to POST /api/seller/session.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    // implicit: a magic link lands on /seller with #access_token=…, which the sign-in page reads itself
    // (PKCE would need the code verifier kept across the email round trip).
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" },
  });
  return client;
}

export const PHOTO_BUCKET = "product-photos";
