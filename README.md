# POWER TECH online store

A storefront, an admin dashboard, and a Supabase database for a computer and technology retailer that sells new, used, and refurbished devices.

**Status: not launch-ready.** The database layer has been tested locally. The storefront and admin JavaScript have been syntax-checked only and have not been run in a browser. No production deployment has been made. See [docs/QA-CHECKLIST.md](docs/QA-CHECKLIST.md) before going live.

## Stack

HTML5, CSS3, vanilla ES modules (no framework, no bundler, no TypeScript). Supabase for Postgres, Auth, Storage, and Row Level Security. Vercel for static hosting. The Supabase client is loaded from `esm.sh` at a pinned version.

## Repository layout

```
power-tech/
├── README.md
├── vercel.json                  headers, rewrites
├── robots.txt, sitemap.xml      placeholders: replace the domain
├── .env.example                 reference only; no secrets
├── .gitignore
├── shared/                      used by both storefront and admin
│   ├── config.js                public config (OWNER placeholders)
│   ├── supabase.js              single client; isConfigured
│   ├── i18n.js                  Arabic / English dictionary, RTL/LTR, saved in localStorage
│   ├── boot.js                  sets language before first paint (external for CSP)
│   ├── ui.js  format.js  validators.js  cart.js
│   ├── base.css                 design tokens and components
│   └── assets/                  logo goes here (README inside)
├── customer/                    storefront
│   ├── index.html  catalog.html  product.html  cart.html
│   ├── checkout.html  account.html  track.html
│   ├── customer.css
│   └── js/                      api, layout, cards, page scripts, cart-lines
├── admin/                       staff dashboard (noindex)
│   ├── index.html  admin.css
│   └── js/                      app (auth, routing), api, views/*
├── supabase/
│   ├── migrations/              0001 schema → 0004 seed defaults (apply in order)
│   └── tests/                   local harness: reset script, shim, seed, 2 test runners
├── data/
│   └── products-template.csv    reserved template; example rows only
└── docs/
    ├── DATABASE.md  SECURITY.md  DEPLOYMENT.md  TESTING.md
    ├── STORE-SETUP.md  ADMIN-GUIDE.md  QA-CHECKLIST.md
```

## Quick setup

1. Create a Supabase project. Apply `supabase/migrations/0001` to `0004` in order. → [DEPLOYMENT.md](docs/DEPLOYMENT.md)
2. Create the `product-images` storage bucket and configure Auth. → [DEPLOYMENT.md](docs/DEPLOYMENT.md)
3. Put your Supabase URL, anon key, and domain in `shared/config.js`. Add the logo at `shared/assets/power-tech-logo.png`.
4. Create the owner account, then grant the role in SQL. → [DEPLOYMENT.md](docs/DEPLOYMENT.md)
5. Review [STORE-SETUP.md](docs/STORE-SETUP.md). Checkout stays off until you enable it.
6. Deploy to Vercel as a static project with no build step.
7. Work through [QA-CHECKLIST.md](docs/QA-CHECKLIST.md) on a staging project first.

To run the database tests locally, see [TESTING.md](docs/TESTING.md).

## Owner-supplied values

Store name and contact details, currency confirmation, delivery fee, warranty terms, homepage text, logo file, production domain, Supabase project values, privacy notice and terms, and the list of staff accounts. None of these are invented in this repository. Full list: [STORE-SETUP.md](docs/STORE-SETUP.md).

## Feature status

See the final summary delivered with this build for the implemented, partial, and not-implemented lists.
