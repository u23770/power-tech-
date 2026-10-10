# Power Tech admin access-code setup

The admin page is designed to open after a single access code. It no longer asks staff for an email address or password. The access code is checked by the server, which issues a six-hour HttpOnly cookie. The admin page then creates a temporary, memory-only anonymous Supabase session and the server grants that specific session an owner role.

## Required configuration

1. In Supabase Dashboard, enable **Anonymous Sign-Ins** in the Authentication settings/providers.
2. In Vercel → Project → Settings → Environment Variables, set these server-side values for the same deployment environments:
   - `ADMIN_ACCESS_CODE`: a long, unique access code. Rotate it if it is shared outside the intended admins.
   - `ADMIN_SESSION_SECRET`: a separate random secret used to sign access cookies.
   - The server reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `shared/config.js` by default; optional server-side overrides are supported.
   - `SUPABASE_SERVICE_ROLE_KEY`: the service-role key. This key must remain server-side and must never be added to `shared/config.js`, frontend code, or a public repository.
3. Keep `shared/config.js` configured with the same Supabase URL and anon key for the browser client.
4. Redeploy on Vercel after changing environment variables.

## Security notes

- Anyone who knows the access code gets owner-level access to the admin dashboard. Use a long random code and share it only with trusted people.
- The code cookie is HttpOnly, Secure, SameSite=Strict, and expires after six hours.
- The admin Supabase session is kept in memory rather than local storage. The page checks the code cookie periodically and returns to the code screen after it expires.
- Anonymous sign-ins must be enabled for this flow. If they are disabled, the admin session will not start.
- Before using this in production, test product create/edit, image uploads, stock changes, order status changes, and the dashboard on the deployed site.
