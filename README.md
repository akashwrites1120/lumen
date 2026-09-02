# Lumen

> AI-powered accessibility platform — automated alt-text generation, image extraction,
> and multi-format conversion (EPUB, Excel, HTML, JSON, Kindle/AZW3). Every output is human-validated
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

### Optional sidecars

```bash
# EPUB validators (epubcheck) — point EPUBCHECK_URL at it
docker compose --profile validators up -d --build

# Kindle (AZW3) conversion (Calibre) — set AZW3_ENABLED=true + AZW3_CONVERT_URL
docker compose --profile converters up -d --build

# S3-compatible storage for local dev — set STORAGE_DRIVER=s3 + S3_BUCKET
docker compose --profile s3 up -d
```

Email notifications are in-app only until `SMTP_HOST` is configured; for local
testing, [Mailpit](https://github.com/axllent/mailpit) works out of the box.




