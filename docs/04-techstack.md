# Lumen — Technology Stack

| Field | Value |
|---|---|
| Version | 1.0 |
| Status | Recommended (v1) |
| Last Updated | 2026-08-25 |

---

## 1. Stack at a Glance

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 15 + TypeScript + Tailwind + shadcn/ui** | SSR dashboard, first-class a11y tooling, fast iteration |
| Backend API | **Node.js (Fastify) + TypeScript** | Same language across stack; high-throughput IO; Fastify for perf & schema-first validation |
| Job Queue | **BullMQ on Redis** | Durable, retryable, prioritized jobs; battle-tested with Node workers |
| Database | **PostgreSQL 16 (+ JSONB)** | Relational core + flexible IR storage; RLS for multi-tenancy |
| Object Storage | **S3-compatible** (AWS S3 / Cloudflare R2) | Cheap binary storage; pre-signed URLs; lifecycle rules |
| Cache/PubSub | **Redis** | Queue backend, progress pub/sub (SSE), rate limits |
| AI Vision | **Provider-abstracted: OpenAI GPT-4o-class + Anthropic Claude-class; local fallback LLaVA/Qwen-VL** | Quality leader + failover + cost tiers |
| OCR/Table Extraction | **Azure Document Intelligence or Textract; open-source: Surya/Tabula as fallback** | Table-scan → structured data accuracy |
| Auth | **Auth.js (NextAuth) + OIDC providers; org RBAC in DB** | Email/password + Google/Microsoft SSO quickly |
| Validation Tooling | **epubcheck · DAISY Ace · axe-core · veraPDF · kindlevalid** | The compliance gate — non-negotiable, all CLI-scriptable |
| Docs Generation | EPUB: **epub-gen / custom packer**, PDF tags: **pdf-lib + custom tagger**, XLSX: **ExcelJS**, JSON: **Zod schemas**, HTML: server-rendered templates | Deterministic builders from approved IR |
| Infra | **Docker + Kubernetes (or Fly.io/Railway at MVP)** · Terraform · GitHub Actions CI/CD | Reproducible; scale path defined |
| Observability | **OpenTelemetry + Grafana stack (or Datadog)** + Sentry | Traces across API→workers→providers |

---

## 2. Frontend

```
Next.js 15 (App Router)
├─ UI:        shadcn/ui + Radix primitives (accessible by default)
├─ Styling:   Tailwind CSS v4
├─ State:     TanStack Query (server state) + Zustand (workbench local state)
├─ Forms:     react-hook-form + Zod resolver
├─ Tables:    TanStack Table (batch lists)
├─ Charts:    Recharts (dashboards only)
├─ Realtime:  SSE via native EventSource (progress streams)
└─ A11y:      eslint-plugin-jsx-a11y, @axe-core/react (dev overlay), NVDA/JAWS manual test matrix
```

Key screens: Projects list · Upload wizard · Job dashboard · Review Workbench · Export center · Compliance reports · Org settings/billing.

---

## 3. Backend

```
Node.js 22 LTS + Fastify
├─ API layer:    REST /v1, OpenAPI 3.1 generated from Zod schemas
├─ Validation:   Zod (single source of truth shared with frontend)
├─ ORM:          Drizzle (typed SQL, migrations)  [alternative: Prisma if team prefers DX]
├─ AuthN/Z:      Auth.js sessions (web) + API keys (machine), Casl-style policy checks
├─ Events:       Redis Streams domain events; SSE fan-out per project channel
└─ Workers:      Separate deployable (same repo monorepo) consuming BullMQ queues:
                 ingest.q · ai.q · review-events.q · export.q · validate.q
```

Monorepo: **pnpm workspaces + Turborepo**
`apps/web · apps/api · apps/workers · packages/schemas · packages/ir · packages/providers`

---

## 4. AI Layer

### Provider Abstraction
```ts
interface VisionProvider {
  classify(img): Promise<ImageClass>;
  describe(req: { img, context, lang, styleGuide }): Promise<AltTextDraft>;
  extractTable(img): Promise<{ rows: string[][]; confidence: number }>;
}
// Adapters: OpenAIAdapter, AnthropicAdapter, LocalVlmAdapter (vLLM-served LLaVA/Qwen2-VL)
// Features: retry w/ backoff, circuit breaker, cost metering, zero-retention endpoints,
//           ensemble option (2 providers agree → confidence boost)
```

### Model Routing Policy (initial)
| Image class | Primary | Fallback | Notes |
|---|---|---|---|
| Photograph | GPT-4o-class vision | Claude vision | Concise alt ≤125 chars |
| Chart/Diagram | Claude vision (long-form strength) | GPT-4o-class | Long description + data extraction |
| Table scan | Azure Doc Intelligence | Textract / Surya | Structure-first, then describe |
| Decorative detection | Classifier heuristic + VLM confirm | — | Auto `alt=""`, spot-checked |

---

## 5. Format Builders & Validators

| Output | Builder lib | Validator(s) |
|---|---|---|
| **EPUB 3** | Custom packer over JSZip (full control of OPF/XHTML/nav) + epub-gen reference | `epubcheck`, DAISY **Ace** |
| **PDF (tagged)** | pdf-lib + structure-tree writer; source-aware retagger when possible | **veraPDF** (PDF/UA-1) |
| **XLSX** | ExcelJS (named sheets, header rows, cell ranges, chart alt text) | Internal rules + Excel repair check |
| **JSON** | Zod schema → JSON Schema published publicly | ajv compile-time + runtime |
| **HTML** | Server templates with landmarks, figure/figcaption | **axe-core** headless run |
| **MOBI/AZW3** | Calibre `ebook-convert` CLI (containerized) from validated EPUB | Kindle Previewer batch validation |

All validators run in dedicated sidecar containers; results stored per export (`validations` table) and embedded in the compliance report.

---

## 6. Data Stores

```
PostgreSQL 16
 ├─ OLTP core: orgs, users, projects, documents, assets, suggestions, reviews, exports, validations
 ├─ audit_events: append-only partitioned table
 └─ JSONB columns: document IR snapshots, provider payloads (for debugging/replay)

Redis 7
 ├─ BullMQ queues + scheduled jobs
 ├─ Pub/Sub: project progress channels (consumed by SSE)
 └─ Cache: provider result cache keyed by pHash+context-hash

S3/R2 buckets
 ├─ {org}/sources/      originals (versioned, KMS-encrypted)
 ├─ {org}/assets/       extracted images
 └─ {org}/exports/      artifacts + compliance reports (short-TTL signed URLs)
```

---

## 7. DevOps & Environments

| Concern | Choice |
|---|---|
| Containers | Docker (multi-stage, distroless runtime) |
| Orchestration | K8s at scale; MVP on Fly.io/Railway with autoscale workers |
| IaC | Terraform (cloud resources), Helm charts (K8s) |
| CI/CD | GitHub Actions: typecheck → lint → unit → integration (testcontainers Postgres/Redis, mocked providers) → build → deploy staging → smoke (golden-book corpus must pass validators) → promote |
| Secrets | Vault / cloud secret manager; no secrets in env files in repo |
| Test data | "Golden books" corpus: known-good + intentionally-broken fixtures for validator gate tests |

---

## 8. Security & Compliance Tooling

- TLS 1.2+, AES-256 at rest, per-org encryption keys (KMS).
- Zero-retention AI endpoints contractually; no customer content to model training.
- GDPR endpoints: export & delete (cascades DB + storage + log redaction).
- SOC 2 Type I roadmap (Phase 3); dependency scanning (Dependabot + `npm audit` gate), SAST (CodeQL).
- Rate limiting & WAF at edge; per-API-key quotas.

---

## 9. Alternatives Considered (and why not)

| Alternative | Verdict |
|---|---|
| Python-only backend (FastAPI) | Great ML ecosystem, but two-language stack; Node chosen for unified types. Python retained for ML micro-tasks if needed (sidecar). |
| Fully serverless (Lambda) | Long jobs (>15 min parses, big books) fight the model; containers + queue fits better. |
| Self-hosted VLMs only | Cheaper at huge scale, but quality/capability gap today; keep as fallback + future cost lever. |
| MongoDB for IR | JSONB covers flexibility while keeping relational integrity for review/audit flows. |
| Electron desktop reviewer app | Web workbench with keyboard-first UX meets need without distribution overhead. |

---

## 10. Cost Sketch (order-of-magnitude)

| Item | MVP/mo est. |
|---|---|
| App + workers (managed containers) | $150–400 |
| Postgres + Redis managed | $60–120 |
| Storage (R2) | $20–50 |
| Vision AI (dominant, usage-based) | $0.002–0.01/image → scales with volume; caching −30% typical |
| Validators/CI | ~$0 (OSS) + runner minutes |
| Observability free tiers → paid | $0–100 |

*Related docs: [02-architecture.md](02-architecture.md) · [03-flow.md](03-flow.md) · [05-status.md](05-status.md)*
