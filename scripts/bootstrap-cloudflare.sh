#!/usr/bin/env bash
set -euo pipefail

DB_NAME="kentaurai"
R2_NAME="kentaurai-raw"

printf '%s\n' "Creating D1 database: $DB_NAME"
npx wrangler d1 create "$DB_NAME" --location weur

printf '%s\n' "Creating R2 bucket: $R2_NAME"
npx wrangler r2 bucket create "$R2_NAME"

cat <<'MSG'

Next steps:
1. Copy the D1 database_id printed above into wrangler.jsonc.
2. Run: npx wrangler d1 migrations apply kentaurai --remote
3. Run: npx wrangler secret put ADMIN_TOKEN
4. Do not deploy until the configuration and migration output have been reviewed.
MSG
