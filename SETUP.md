# One-time setup

## 1. GitHub
The public repository is `mstpln/kentaurai`.
Keep `main` as the reviewed deployment branch: after the initial bootstrap, changes should normally be made on feature branches, reviewed in PR, and merged only after explicit approval.

The repository is public, but the deployed data layer is private. Never commit real provider payloads, manual editorial imports, reference-round exports, database dumps, source credentials or tokens.

## 2. Cloudflare resources
This project follows the same GitHub -> Cloudflare deployment principle as the user's other projects. The Worker now serves both the private API and the private read-only KentaurAI interface.

From a local clone after `npm install`:

```bash
./scripts/bootstrap-cloudflare.sh
```

The script creates:
- D1 database: `kentaurai`
- R2 bucket: `kentaurai-raw`

Then copy the returned D1 database ID into `wrangler.jsonc`, apply all pending migrations, and add both private runtime secrets:

```bash
npx wrangler d1 migrations apply kentaurai --remote
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put APP_PASSWORD
```

`ADMIN_TOKEN` protects `/v1/*` operational APIs. `APP_PASSWORD` is a separate high-entropy password used only to log into the browser interface at `/app`; it is never exposed to the browser after login and is used to sign a secure HttpOnly session cookie.

Review migration output before deployment. Do not put either secret in GitHub or any tracked file.

## 3. Git Builds
Recommended Cloudflare Git Build settings:
- production branch: `main`
- root directory: `/`
- deploy command: `npm run db:migrate:remote && npm run deploy`
- build variable: `NODE_VERSION=22`
- do not enable deployment from feature branches

## 4. Interface access
After deployment:
- `/` redirects to `/app`
- `/app/login` is the private login screen
- `/app` is the read-only KentaurAI interface
- sessions are stored only in a Secure, HttpOnly, SameSite=Strict cookie and expire after 30 days

The interface never asks for or stores `ADMIN_TOKEN`.

## 5. Live-provider milestone
The first official-provider vertical slice is verified end-to-end in production. Automatic live acquisition remains disabled, scratch/withdrawal semantics remain an explicit known gap, and future historical/X-Labs expansion should keep the same provenance and verification rules.
