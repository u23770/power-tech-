// shared/supabase.js — single Supabase client for customer and admin apps.
// Loaded from a pinned CDN ES module only when a real project is configured.
// This lets unconfigured previews render their setup message without depending on the CDN.
import { CONFIG } from '/shared/config.js';

export const isConfigured =
  CONFIG.SUPABASE_URL.startsWith('https://') &&
  !CONFIG.SUPABASE_URL.includes('YOUR_PROJECT_REF') &&
  !CONFIG.SUPABASE_ANON_KEY.includes('YOUR_');

// The client persists the session in localStorage (Supabase default). Keep the admin on
// a short session by configuring JWT expiry in Supabase Auth settings (see docs/SECURITY.md).
let supabaseClientFactory = null;
if (isConfigured) {
  ({ createClient: supabaseClientFactory } = await import('https://esm.sh/@supabase/supabase-js@2.45.4'));
}

export const supabase = supabaseClientFactory
  ? supabaseClientFactory(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// Admin sessions are deliberately memory-only: the server-side access-code cookie
// is the gate, so an admin JWT must not survive a reload or be refreshed indefinitely.
export const adminSupabase = supabaseClientFactory
  ? supabaseClientFactory(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

/** Throws a stable error code when the project is not configured yet. */
export function requireClient() {
  if (!supabase) {
    const err = new Error('not_configured');
    err.code = 'not_configured';
    throw err;
  }
  return supabase;
}

/** Admin-only client; its short-lived anonymous session is never persisted. */
export function requireAdminClient() {
  if (!adminSupabase) {
    const err = new Error('not_configured');
    err.code = 'not_configured';
    throw err;
  }
  return adminSupabase;
}
