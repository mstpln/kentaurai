# Product and architecture decisions

## Architecture
- GitHub: public code, migrations, tests and version history.
- Cloudflare Worker: private API, import orchestration and scheduled jobs.
- Cloudflare D1: normalized/queryable data.
- Cloudflare R2: raw snapshots and larger source objects.
- No frontend/app is required.
- AI provider is replaceable; OpenAI and Claude are both valid analysis layers.

## Manual editorial flow
1. Editorial content is reviewed outside KentaurAI using an authorized user workflow.
2. That workflow exports only the structured signals needed by KentaurAI.
3. The export is supplied temporarily to the private import flow and is never committed to the public repository.
4. The import endpoint validates it and writes structured signals to private D1 while preserving private provenance.
5. Manual editorial data uses a separate import path from automated provider ingestion.
6. KentaurAI does not browse or collect editorial content itself.
7. Public code, tests and examples never identify a private editorial source.

## Learning registry
A single race must not directly change model weights. Candidate learnings are recorded as hypotheses and accumulate supporting/contradicting observations. Actual model/rule changes are stored in `model_change_log` and tied to `model_versions`.
