# Lumen — System Architecture

| Field | Value |
|---|---|
| Version | 1.0 |
| Status | Approved for Design |
| Last Updated | 2026-08-25 |

---

## 1. Architectural Principles

1. **Human-in-the-loop is a first-class state machine** — content moves through explicit states (`extracted → ai_draft → in_review → approved → exported`); nothing ships without human approval.
2. **Async everything heavy** — parsing, AI calls, and export generation run on a durable job queue, never in request handlers.
3. **Provider-agnostic AI layer** — vision models behind an internal interface; swap/add providers (OpenAI, Anthropic, self-hosted LLaVA) without touching business logic.
4. **Validate before export, always** — automated validators (epubcheck, Ace, veraPDF) form a hard gate; failed artifacts never reach users.
5. **Auditability by default** — every AI suggestion and human decision is append-only logged.
6. **Accessibility of the platform itself** — the web app meets the same standards we enforce on outputs.

---

## 2. High-Level Architecture (C4 Level 1–2)

```
                                ┌──────────────────────────────────────────────┐
                                │                    USERS                     │
                                │  Publishers · Validators · Educators · API   │
                                └──────────────┬───────────────────────────────┘
                                               │ HTTPS
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            EDGE / GATEWAY                                       │
│   CDN · WAF · Rate limiting · TLS termination                                   │
└──────────────┬──────────────────────────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     WEB APPLICATION (Next.js)                                    │
│  ┌────────────┐ ┌────────────┐ ┌─────────────┐ ┌────────────────────────────┐  │
│  │ Upload &   │ │ Review     │ │ Job Queue   │ │ Export & Compliance        │  │
│  │ Projects UI│ │ Workbench  │ │ Dashboard   │ │ Reports UI                 │  │
│  └────────────┘ └────────────┘ └─────────────┘ └────────────────────────────┘  │
│                        REST/GraphQL API (Node.js)                               │
└───────┬──────────────┬───────────────────┬──────────────────┬──────────────────┘
        │              │                   │                  │
        ▼              ▼                   ▼                  ▼
┌────────────┐ ┌──────────────┐ ┌──────────────────┐ ┌───────────────────┐
│ PostgreSQL │ │ Object Store │ │   Redis          │ │  Auth Service     │
│ (projects, │ │ S3-compat    │ │ (queue backend,  │ │  (SSO/OIDC,       │
│  images,   │ │ (files,      │ │  cache, pub/sub) │ │   sessions, RBAC) │
│  decisions)│ │  exports)    │ └────────┬─────────┘ └───────────────────┘
└────────────┘ └──────────────┘          │
                                         │ enqueue/dequeue
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          WORKER FLEET (durable jobs)                             │
│                                                                                  │
│  ┌──────────────┐   ┌──────────────────┐   ┌───────────────────────────────┐   │
│  │ INGEST       │   │ AI PIPELINE      │   │ EXPORT PIPELINE               │   │
│  │ workers      │──▶│ workers          │──▶│ workers                       │   │
│  │ · parse PDF/ │   │ · classify image │   │ · build EPUB/XLSX/JSON/MOBI/  │   │
│  │   DOCX/EPUB  │   │ · gen alt text   │   │   HTML/PDF                    │  │
│  │ · extract    │   │ · extract tables │   │ · run validators (gate)       │   │
│  │   images     │   │ · confidence &   │   │ · sign compliance report      │   │
│  │ · dedupe     │   │   routing        │   │ · package + upload            │   │
│  └──────────────┘   └──────────────────┘   └───────────────────────────────┘   │
│         │                     │                            │                    │
│         └─────────────────────┴────────────┬───────────────┘                    │
│                                            ▼                                    │
│                              ┌────────────────────────┐                         │
│                              │  AI PROVIDER ABSTRACT  │                         │
│                              │  adapter: OpenAI /     │                         │
│                              │  Anthropic / local     │                         │
│                              │  fallback + retries    │                         │
│                              └────────────────────────┘                         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Services

### 3.1 API Service (BFF)
- **Responsibility:** auth, projects CRUD, uploads (pre-signed URLs), review actions, export requests, metering.
- Stateless; horizontally scaled behind load balancer.
- Emits domain events (`image.extracted`, `review.approved`, `export.requested`) to Redis Streams.

### 3.2 Ingest Workers
- Parse source documents into a **canonical intermediate representation (IR)**:

```jsonc
// Canonical IR (stored per project)
{
  "project_id": "uuid",
  "structure": [
    { "type": "chapter", "title": "Ch 1", "children": [ /* blocks */ ] },
    { "type": "paragraph", "text": "..." },
    { "type": "figure", "id": "fig_042",
      "asset_ref": "s3://…/fig_042.png",
      "page": 57, "bbox": [120, 340, 480, 620],
      "context_before": "As shown in Figure 3…",
      "context_after": "…" }
  ]
}
```

- Extracts embedded images with page/bbox metadata.
- Perceptual-hash dedupe (pHash); near-duplicates grouped, single alt text propagated.

### 3.3 AI Pipeline Workers

```
image asset ─▶ classifier ─▶ route by class
                                ├─ decorative ──▶ auto alt="" (still human-spot-checked)
                                ├─ photograph ──▶ VLM alt-text generator
                                ├─ chart/diagram ▶ VLM long-description + data extractor
                                └─ table-scan ──▶ OCR/table-structure model → CSV rows

context enricher: injects ±500 chars of surrounding doc text + figure caption refs
confidence scorer: ensemble agreement + token logprobs → 0–100 score
router: score ≥ threshold(85) → optional fast review lane
        score < threshold      → mandatory deep review lane
```

- **Provider abstraction:** `VisionProvider` interface with `describe(image, context, lang)` and `extractTable(image)`; adapters per vendor; automatic failover; zero-retention endpoints only.

### 3.4 Human Review Service (state machine owner)

```
                 ┌────────────┐
   ai_draft ───▶ │ IN_REVIEW  │ ───▶ APPROVED ───▶ (eligible for export)
                 └─────┬──────┘
                       │ reject
                       ▼
                 REWRITE (back to AI with reviewer feedback as few-shot)
```

- All transitions validated server-side; every decision writes to the **audit log** (append-only): `{ai_text, final_text, reviewer_id, decision, duration_ms}`.
- Feedback loop: rejected items' corrections become few-shot examples for regeneration.

### 3.5 Export Pipeline Workers

```
approved IR ─▶ format builders (parallel where independent)
                │ EPUB builder  ─▶ epubcheck + DAISY Ace ─┐
                │ XLSX builder  ─▶ header/sheet checks   ─┤
                │ JSON builder  ─▶ JSON Schema validation ─┼─▶ all pass? ─▶ package+publish
                │ MOBI/AZW3     ─▶ kindlevalid            ─┤            │ no
                │ HTML builder  ─▶ axe-core scan          ─┘            ▼
                │ PDF-UA (P1)   ─▶ veraPDF                        fail job w/ report
```

- Builders are pure functions of `(IR + approved assets)` → deterministic, re-runnable.
- Validation gate is **non-bypassable**; failures create engineering-actionable error reports.

### 3.6 Compliance Report Generator
- Aggregates validator outputs + audit trail into signed PDF/JSON report per artifact ("who approved what, when, which checks passed").

---

## 4. Data Model (simplified)

```
organizations ─┬─< projects ─┬─< documents
users ─────────┤             ├─< assets (images) ─< suggestions (AI drafts, versioned)
roles/members ─┘             ├─< reviews (decisions, audit-linked)
                             ├─< exports ─< validations (per-check pass/fail)
                             └─< audit_events (append-only)
jobs (queue mirror): id, type, payload_ref, status, attempts, priority
```

Key choices:
- **PostgreSQL** as system of record (JSONB for IR flexibility).
- **Object storage** for binaries only; DB stores references + metadata.
- **Suggestions are immutable versions**; reviewers edit creates new revision — full history preserved.

---

## 5. Key Sequence: Book Ingestion → Accessible EPUB

```
Publisher      API          Storage      Queue        Ingest     AI        Reviewer      Export
   │            │              │           │            │         │            │            │
   ├──upload───▶│ pre-signed◀──│           │             │         │            │            │
   │──PUT file─▶──────────────▶│           │             │         │            │            │
   │            │──enqueue ingest─────────▶│──pick up──▶ │         │            │            │
   │            │              │           │             │ parse   │            │            │
   │            │              │           │             │ extract │            │            │
   │            │              │           │──enqueue ai─────────▶│            │            │
   │            │              │           │             │      classify       │            │
   │            │              │           │             │      describe       │            │
   │            │◀──progress events (SSE/WebSocket)───────────────────▶│            │            │
   │            │              │           │             │         │──assign──▶ │            │
   │            │              │           │             │         │      approve/edit       │
   │            │──request export─────────▶│────────────────────────────────────all approved──▶│
   │            │              │           │             │         │            │      build  │
   │            │              │           │             │         │            │   validate   │
   │            │◀──────────────────────────download link + compliance report──────────────────│
```

---

## 6. Cross-Cutting Concerns

| Concern | Approach |
|---|---|
| **Retries & resilience** | Durable queue with exponential backoff; idempotent workers keyed on `(job_id, asset_id)`; provider circuit breaker. |
| **Observability** | OpenTelemetry traces spanning API→workers→providers; per-stage metrics (parse ms, AI latency p95, review turnaround, validator pass rate); structured logs. |
| **Cost control** | Per-org AI spend meters; batch-size aware scheduling; caching identical image+context results. |
| **Security** | Pre-signed uploads only; signed export URLs (short TTL); RBAC enforced at API layer; secrets in vault; provider calls proxied through egress gateway. |
| **Data privacy** | Zero-retention AI endpoints contractual; customer media encrypted with per-org KMS keys; deletion API cascades storage + DB + logs redaction. |
| **Multi-tenancy isolation** | Row-level security in Postgres by `org_id`; queue priorities per org tier. |

---

## 7. Scaling Plan

| Stage | Load | Topology |
|---|---|---|
| MVP | ≤ 10 orgs, ~50k imgs/mo | Single app instance + 4 workers + managed Postgres/Redis |
| Growth | ~1M imgs/mo | Autoscaled worker pool (CPU-bound vs GPU-proxy-bound split), read replicas |
| Scale | 5M+ imgs/mo | Regional worker pools near AI providers, queue sharding by org, CDN-fronted exports |

Bottleneck watchlist: VLM rate limits (mitigate via multi-provider fan-out), large-PDF memory (stream parsing), export bundle sizes (>1GB books → chunked packaging).

---

## 8. Deployment & Environments

- **Environments:** dev → staging (synthetic books corpus) → prod.
- **CI/CD:** lint/typecheck/unit → integration (real parsers, mocked providers) → container build → deploy; migrations gated.
- **IaC:** Terraform-style definitions; everything reproducible from repo.
- **Feature flags** for gradual rollout of new format builders (e.g., MOBI behind flag until Kindle validation matures).

---

## 9. Risks & Mitigations (Architecture)

| Risk | Impact | Mitigation |
|---|---|---|
| VLM hallucinated descriptions | Trust erosion | Confidence routing + mandatory HITL + feedback loop; spot-check sampling |
| Provider outage/deprecation | Pipeline stall | Multi-provider adapters, queued replay, local open-model fallback for degraded mode |
| Validator false negatives ship bad EPUB | Legal exposure | Layered validators + human senior spot-check on 10% sample |
| Giant legacy scans (poor OCR) | Data quality | Pre-flight quality scorer flags docs needing manual prep before quoting SLA |

---

*Related docs: [01-prd.md](01-prd.md) · [03-flow.md](03-flow.md) · [04-techstack.md](04-techstack.md) · [05-status.md](05-status.md)*
