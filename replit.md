# Running KentaurAI on Replit

This is the original Cloudflare Workers application, running locally through
Wrangler on Node.js 22. Its source structure and production configuration are
unchanged.

## Local preview

1. Dependencies are installed from `package-lock.json` with `npm ci`.
2. Add a separate development `APP_PASSWORD` in Replit Secrets to enable browser
   login. Add `ADMIN_TOKEN` only if local administrative APIs are needed.
   Never use production credentials for this local preview.
3. Run `npm run db:migrate:replit` to apply migrations to local D1.
4. The **Start application** workflow runs `npm run dev:replit` on port 5000.
5. Open `/app/login` in the preview and sign in with the development password.

The preview uses `wrangler.local.jsonc`, local D1 and local R2. Data persists in
the ignored `.wrangler/` directory. It starts with no racing history; missing
data must remain unknown, not be filled with invented data. No scheduled jobs
are configured, and no Cloudflare account is required for this local setup.
Wrangler reads only the named `APP_PASSWORD` and `ADMIN_TOKEN` secrets from the
runtime environment. If `ADMIN_TOKEN` is absent, Wrangler warns and local admin
APIs remain unavailable; browser login still works with `APP_PASSWORD`.
Do not print secret values or add secrets to tracked files.

`npm run test:schema` checks schema compatibility; `npm run qa` runs the full
existing test suite and syntax checks.

## Production safety

The original `wrangler.jsonc` and production release workflow remain separate.
Do not deploy, run remote migrations, create or alter Cloudflare resources,
trigger production backfills, or mutate production data without explicit
approval. Do not replace D1/R2 or migrate the repository structure for setup.
