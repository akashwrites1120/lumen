# Lumen — Project Status

| Field | Value |
|---|---|
| Version | 1.0 |
| Current Phase | **Phase 0 — Foundation (Planning → Build)** |
| Last Updated | 2026-08-25 |
| Overall Health | 🟢 On track (documentation & design phase complete) |

---

## 1. Executive Summary

Lumen is an AI-powered, human-validated accessibility platform. All five core planning documents are complete:

| Document | Location | Status |
|---|---|---|
| PRD | [docs/01-prd.md](01-prd.md) | ✅ Complete |
| Architecture | [docs/02-architecture.md](02-architecture.md) | ✅ Complete |
| Flows | [docs/03-flow.md](03-flow.md) | ✅ Complete |
| Tech Stack | [docs/04-techstack.md](04-techstack.md) | ✅ Complete |
| Status | [docs/05-status.md](05-status.md) | ✅ This doc |

**Next milestone:** Phase 0 exit — running skeleton with upload + queue + DB by end of Week 4.

---

## 2. Roadmap Overview

```
Phase 0        Phase 1           Phase 2            Phase 3
Foundation     MVP               Formats & Teams    Scale & Compliance
Weeks 1–4      Weeks 5–10        Weeks 11–16        Weeks 17–24
   ●━━━━━━━━━━━━○━━━━━━━━━━━━━━━━━○━━━━━━━━━━━━━━━━━━━○
   ▲ YOU ARE HERE
```

---

## 3. Detailed Status by Workstream

### 3.1 Product & Design
| Item | Status | Notes |
|---|---|---|
| Personas & problem definition | ✅ Done | PRD §2–4 |
| Functional requirements (P0/P1/P2) | ✅ Done | PRD §5 — 32 requirements cataloged |
| Compliance mapping (WCAG/ADA/EPUB-A11y/PDF-UA) | ✅ Done | PRD §7 |
| Release plan phasing | ✅ Done | PRD §8 |
| Review Workbench wireframes | ⬜ Not started | Week 1–2 target; keyboard-first spec in Flow doc §Journey B |
| Design-partner pipeline | ⬜ Not started | Target: 5 partners signed before Phase 1 exit |

### 3.2 Engineering
| Component | Status | Notes |
|---|---|---|
| Monorepo scaffold (pnpm + Turborepo) | ⬜ Not started | First build task, Week 1 |
| Auth + orgs + RBAC | ⬜ Not started | Auth.js + Drizzle schema, Week 2–3 |
| Upload service (pre-signed, resumable) | ⬜ Not started | Week 2 |
| Ingest workers (PDF/DOCX/EPUB parse, IR builder) | ⬜ Not started | Week 3–4; EPUB import baseline first (easiest) |
| AI provider abstraction + adapters | ⬜ Not started | Interface defined in Tech Stack §4; build Week 5 |
| Review state machine + audit log | ⬜ Not started | Schema ready for Week 5–6 |
| Review Workbench UI | ⬜ Not started | Highest-risk UX item; prototype early (Week 6+) |
| Export builders: JSON → HTML → XLSX → EPUB → MOBI → PDF | ⬜ Not started | Ordered by dependency risk (JSON/HTML trivial, EPUB critical path, MOBI behind flag) |
| Validator gate (epubcheck/Ace/axe/veraPDF sidecars) | ⬜ Not started | Golden-corpus tests required before MVP exit |
| Observability (OTel traces, dashboards) | ⬜ Not started | Basic tracing from Week 3 |

### 3.3 Open Decisions Blocking Build
| # | Decision | Owner | Due | Recommendation |
|---|---|---|---|---|
| D-1 | MOBI vs AZW3/"Kindle-ready" positioning | PM | Week 1 | AZW3/KPF; label as Kindle-ready |
| D-2 | ORM final call: Drizzle vs Prisma | Eng lead | Week 1 | Drizzle (typed SQL, lighter) |
| D-3 | Pricing model (per-image credits vs subscription) | PM + Founders | Before Phase 2 | Interview design partners first |
| D-4 | Primary cloud (AWS vs GCP vs Fly/Railway for MVP) | Eng lead | Week 1 | Fly.io/Railway MVP → AWS at growth |

---

## 4. Milestone Checklist

### Phase 0 — Foundation (Weeks 1–4)
- [ ] Repo, CI, environments, IaC bootstrap
- [ ] Auth (email+password), org/project CRUD, RBAC schema
- [ ] Upload with pre-signed URLs + virus scan stub
- [ ] BullMQ queues operational; ingest worker parses EPUB → IR stored
- [ ] Progress events over SSE on dashboard shell
- [ ] Exit criteria: *upload a small EPUB → see structure + extracted images in DB/dashboard*

### Phase 1 — MVP (Weeks 5–10)
- [ ] Vision provider abstraction with 2 adapters + retries/fallback
- [ ] Classification + alt-text generation + confidence routing
- [ ] Review Workbench (keyboard-first, a11y-tested) with approve/edit/reject/decorative
- [ ] Audit trail persisted; export gate for **JSON + EPUB** with epubcheck + Ace passing
- [ ] Golden-book corpus test harness green
- [ ] Exit criteria: *a design partner processes one real book end-to-end to compliant EPUB*

### Phase 2 — Formats & Teamwork (Weeks 11–16)
- [ ] XLSX + HTML builders validated
- [ ] MOBI/AZW3 behind feature flag
- [ ] Reviewer assignment, batch management, throughput metrics
- [ ] Usage metering + billing hooks; notifications (email + in-app)
- [ ] API beta with idempotency keys + webhooks
- [ ] Exit criteria: *multi-user org processes 10 books; API beta customer integrated*

### Phase 3 — Scale & Compliance Pack (Weeks 17–24)
- [ ] Tagged PDF (PDF/UA via veraPDF) 
- [ ] Compliance reports (signed) + VPAT summary download
- [ ] Senior spot-check workflow; multilingual alt text (ES/FR/DE/HI)
- [ ] Autoscaled worker pools; load test at 500k queued images
- [ ] SOC 2 Type I kickoff
- [ ] Exit criteria: *public API GA; compliance pack sold to first enterprise*

---

## 5. Known Risks & Watch Items

| Risk | Sev | Mitigation | Owner |
|---|---|---|---|
| VLM hallucination erodes reviewer trust | High | Confidence lanes + feedback-loop regeneration + spot checks | Eng |
| Review Workbench UX too slow (>30s/img) | High | Prototype Week 6; measure time-per-decision telemetry | Design+Eng |
| Provider rate limits at scale | Med | Multi-provider fan-out, local model fallback, request shaping | Eng |
| EPUB edge cases (math, complex tables) fail validators late | Med | Golden corpus incl. pathological fixtures from Week 8 | QA |
| Design-partner acquisition slips | Med | Start outreach now using PRD one-pager | PM |
| Cost overrun on vision calls | Low-Med | Result caching (pHash+context), per-org spend meters, budget alerts | Eng |

---

## 6. Metrics to Start Tracking (from Phase 1)

| Metric | Definition | Target |
|---|---|---|
| AI acceptance rate | % suggestions approved unedited | ≥ 60% |
| Edit distance | Avg chars changed per edited suggestion | trending ↓ |
| Review throughput | Seconds per image decision | ≤ 30s avg |
| Validator pass rate (first attempt) | Exports passing all gates first try | ≥ 90% |
| Pipeline latency | Upload→drafts-ready p50/p95 | < 30min/< 4h (300-img book) |
| End-to-end delivery | Upload→delivered incl. review | < 24h p80 |

---

## 7. Change Log

| Date | Change |
|---|---|
| 2026-08-25 | Initial status doc; planning docs 01–04 completed; Phase 0 planned |

---

*Related docs: [01-prd.md](01-prd.md) · [02-architecture.md](02-architecture.md) · [03-flow.md](03-flow.md) · [04-techstack.md](04-techstack.md)*
