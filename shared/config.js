// shared/config.js
// PUBLIC, browser-safe configuration. Replace the OWNER placeholders before running.
// The Supabase anon/publishable key is designed to be public; security comes from RLS and trusted
// database functions. NEVER place the service-role key (or any secret) in this file or any browser code.

export const CONFIG = Object.freeze({
  // OWNER MUST SUPPLY: Supabase Project URL (Project Settings > API)
  SUPABASE_URL: 'https://geqhqhmbplyhnktuwwhb.supabase.co',
  // OWNER MUST SUPPLY: anon / publishable key (Project Settings > API). Public by design.
  SUPABASE_ANON_KEY: 'sb_publishable_Hk3gSIEtgF0qzau-W0VXLA_ri-JMe6K',

  // Catalog paging (progressive "load more").
  PAGE_SIZE: 24,

  // Brand logo: place the EXACT supplied logo file at this path. It is never redrawn in code.
  LOGO_PATH: '/shared/assets/power-tech-logo.png',

  // Public site origin used for canonical links and sitemap (set after the domain is confirmed).
  SITE_ORIGIN: 'https://power-tech-u23770.vercel.app',
});
