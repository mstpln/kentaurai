# One-time setup

## 1. GitHub
The public repository is `mstpln/kentaurai`.
Keep `main` as the reviewed deployment branch: after the initial bootstrap, changes should normally be made on feature branches, reviewed in PR, and merged only after explicit approval.

The repository is public, but the deployed data layer is private. Never commit real provider payloads, manual editorial imports, reference-round exports, database dumps, source credentials or tokens.

## 2. Cloudflare resources
This project follows the same GitHub -> Cloudflare deployment principle as the user's other projects, but no frontend is required.

From a local clone after `npm install`:

```bash
./scripts/bootstrap-cloudflare.sh
```

The script creates:
- D1 database: `kentaurai`
- R2 bucket: `kentaurai-raw`

Then copy the returned D1 database ID into `wrangler.jsonc`, apply all pending migrations, and add `ADMIN_TOKEN` as a Cloudflare secret:

```bash
npx wrangler d1 migrations apply kentaurai --remote
npx wrangler secret put ADMIN_TOKEN
```

Review the migration output before deployment. Do not put the token in GitHub or any tracked file.

## 3. Git Builds
Recommended Cloudflare Git Build settings:
- production branch: `main`
- root directory: `/`
- deploy command: `npx wrangler@4.114.0 deploy`
- build variable: `NODE_VERSION=22`
- do not enable deployment from feature branches

## 4. First live-provider milestone
Do not start the 2-3 year backfill immediately.
First capture one real V85/V86 source payload, keep it outside the public repository, implement the adapter against that exact payload, import one reference round end-to-end, and verify 10-20 fields manually. Only then expand the backfill.
