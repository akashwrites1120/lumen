# Lumen

> AI-powered accessibility platform — automated alt-text generation, image extraction,
> and multi-format conversion (EPUB, Excel, JSON, MOBI). Every output is human-validated
> to meet WCAG, ADA, EPUB Accessibility, and PDF/UA standards.

**AI does 95% of the work. Humans provide 100% of the trust.**

## Documentation

| Doc | Description |
|---|---|
| [PRD](docs/01-prd.md) | Product requirements, personas, compliance mapping |
| [Architecture](docs/02-architecture.md) | System design, services, data model |
| [Flows](docs/03-flow.md) | User journeys and pipeline state machines |
| [Tech Stack](docs/04-techstack.md) | Technology choices and rationale |
| [Status](docs/05-status.md) | Roadmap and current phase |

## Monorepo Layout

```
apps/
  web/        Next.js dashboard (review workbench lives here in Phase 1)
  api/        Fastify REST API + SSE progress streams
  workers/    BullMQ pipeline workers (ingest → AI → export)
packages/
  db/         Drizzle schema & client (PostgreSQL)
  schemas/    Shared Zod contracts: canonical IR, DTOs, events
```

## Prerequisites

- Node.js ≥ 22 · pnpm ≥ 10 · Docker

## Quick Start

```bash
pnpm install

# start postgres + redis
docker compose up -d

# env
cp .env.example .env

# schema
pnpm db:push

# dev servers (api :4000, web :3000)
pnpm dev
```

## Phase 0 Scope

- [x] Repo, CI bootstrap, environments
- [x] Auth (email + password), orgs, projects CRUD, RBAC roles
- [x] Upload service with pluggable storage driver (local disk now, S3 later)
- [x] BullMQ ingest worker: EPUB → canonical IR + extracted image assets
- [x] Live progress via SSE on the dashboard

See [Status](docs/05-status.md) for the full roadmap.
