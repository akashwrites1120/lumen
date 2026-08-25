# Lumen — Flows

| Field | Value |
|---|---|
| Version | 1.0 |
| Scope | User journeys, system flows, state machines, edge cases |
| Last Updated | 2026-08-25 |

---

## 1. Primary User Journeys

### Journey A — Publisher: Bulk Book Processing (Priya)
```
1. Login → Dashboard
2. Create Project "Fall Backlist 2026"
3. Upload: 12 PDFs (drag-drop) → pre-signed upload, virus scan
4. Pre-flight check runs → quality report per book
   ⚠ Book 7 flagged: scanned images at 72dpi → "may need manual prep"
5. Confirm processing → jobs queued; live progress per stage:
   [Ingest ✓] → [AI Drafts ●●●○ 62%] → [Review ○] → [Export ○]
6. Email + in-app notification when AI drafts ready for review
7. Assign reviewers → track throughput in dashboard
8. All approved → click "Export" → select EPUB + JSON
9. Validation gate runs → green banner: "All checks passed"
10. Download EPUB + JSON + signed Compliance Report
```

### Journey B — Validator: Reviewing Alt Text (Marcus)
```
1. Open assigned batch "Book 3 — Figures 001–120"
2. Review Workbench (keyboard-only):
   ┌────────────────────────────────────────────────────────┐
   │  [IMAGE large view / zoom]   │ AI SUGGESTION           │
   │                              │ Confidence: 92          │
   │  Context:                    │ Class: chart            │
   │  "…as Figure 4 shows…"       │ Alt:  [editable field]  │
   │                              │ Long desc: [textarea]   │
   │                              │ ☐ Mark decorative       │
   ├──────────────────────────────┴─────────────────────────┤
   │ [A]pprove  [E]dit+Approve  [R]eject  [S]kip  [D]ecorative│
   └────────────────────────────────────────────────────────┘
3. Press A on clear photos (fast lane); E to tweak chart wording
4. Chart image → long description editor with data table preview
5. Progress bar: 87/120 done · session autosaves
6. Submit batch → senior spot-check queue picks 10% randomly
```

### Journey C — Educator: PDF Table → Excel (Dr. Chen)
```
1. Upload lecture PDF with statistical charts/tables
2. Lumen detects table-scans → extracts structured rows/columns
3. Reviewer verifies extracted numbers against source (side-by-side)
4. Export as .xlsx → styled headers, named sheets, alt text on any embedded charts
5. Also exports EPUB of the full lecture for screen-reader students
```

---

## 2. End-to-End System Flow (happy path)

```
 UPLOAD          INGEST            AI PIPELINE         HUMAN REVIEW        EXPORT
┌───────┐     ┌──────────┐      ┌─────────────┐      ┌────────────┐     ┌────────────┐
│ file  │────▶│ parse    │─────▶│ classify    │      │ assign     │     │ build      │
│ scan  │     │ extract  │      │ describe    │─────▶│ approve/   │────▶│ validate   │
│ dedupe│     │ IR build │      │ extract tbl │      │ edit/reject│     │ package    │
└───────┘     └──────────┘      │ confidence  │      └────────────┘     │ report     │
                                └──────┬──────┘            ▲             └──────┬─────┘
                                       │                   │                    │
                                       ▼ low confidence    │ reject w/feedback  ▼
                                 deep-review lane ────────►┘              validators pass?
                                                                                │yes
                                                                                ▼
                                                                        deliver + notify
```

---

## 3. Asset State Machine (source of truth)

```
                        ┌──────────┐
        uploaded ──────▶│ INGESTED │  (IR built, images extracted)
                        └────┬─────┘
                             ▼
                      ┌────────────┐    regenerate (with feedback)
                 ┌───▶│ AI_DRAFTED │◀───────────────────────────┐
                 │    └────┬───────┘                            │
                 │         │ route by confidence                │
                 │    ┌────▼───────┐                            │
                 │    │ IN_REVIEW  │──── skip ──▶ (stays, requeues)
                 │    └────┬───────┘                            │
                 │         ├─ approve ──┐                       │
                 │         ├─ edit+approve ─┐                    │
                 │         └─ reject ───────┼──▶ REGENERATE ─────┘
                 │                          ▼
                 │                   ┌────────────┐
                 └── decorative auto-▶│ APPROVED   │
                     (spot-check)    └────┬───────┘
                                          ▼ all assets approved?
                                   ┌────────────┐
                                   │ EXPORTING  │
                                   └────┬───────┘
                                  validators fail? ──▶ EXPORT_FAILED (eng ticket)
                                        │ pass
                                        ▼
                                  ┌────────────┐
                                  │ DELIVERED  │ (+ compliance report)
                                  └────────────┘
```

**Rules**
- No asset can enter `EXPORTING` unless `APPROVED`.
- `APPROVED` assets are frozen; new edits fork a revision and return to `IN_REVIEW`.
- Every transition emits an audit event.

---

## 4. Detailed Sub-Flows

### 4.1 Ingestion Flow
```
file received
 ├─ type detect (magic bytes, not extension)
 ├─ malware scan ──fail──▶ quarantine + notify
 ├─ route by type:
 │   ├─ PDF  ─▶ pdf parser (text layer? yes → direct; no → OCR first)
 │   ├─ DOCX ─▶ docx parser (native heading/style info preserved)
 │   ├─ EPUB ─▶ unzip → XHTML spine walk (already has some alt text? import as draft baseline)
 │   ├─ MOBI/AZW3 ─▶ convert to EPUB via kindleunpack path → treat as EPUB
 │   ├─ ZIP/images ─▶ register each image; no context available → confidence capped lower
 │   └─ URL ─▶ fetcher (robots-respect) → readability extract → images + context
 ├─ structure builder → canonical IR (chapters/blocks/figures with bbox+page)
 ├─ pHash dedupe → duplicate groups linked to representative asset
 └─ emit project.progress event
```

### 4.2 AI Generation Flow (per image)
```
asset + ±context text
 ├─ classifier → {decorative | photograph | chart | diagram | table_scan | infographic}
 ├─ if decorative → suggestion alt="" (confidence high, fast-lane review)
 ├─ else:
 │   ├─ prompt = [image, class hint, document context, style guide, language]
 │   ├─ provider call (retry ×2, then fallback provider)
 │   ├─ outputs: alt(≤125c) + long_desc + caption_suggestion
 │   ├─ table_scan → also structured CSV extraction
 │   ├─ quality checks: length cap, no "image of…", no hallucinated proper nouns flag
 │   └─ confidence = f(provider score, ensemble agreement, heuristics)
 └─ write suggestion v1 → route review lane
```

### 4.3 Human Review Flow
```
reviewer opens batch
 ├─ keyboard-first navigation; screen-reader compatible (ARIA live regions for saves)
 ├─ decision actions (server-validated):
 │   ├─ APPROVE        → final_text = ai_text
 │   ├─ EDIT+APPROVE   → creates revision v(n+1), final_text = edited
 │   ├─ REJECT         → optional feedback → triggers REGENERATE with feedback as guidance
 │   └─ DECORATIVE     → sets alt="" + accessibilityFeature metadata
 ├─ autosave draft edits every 5s (offline-tolerant queue)
 └─ batch submit → senior spot-check sampler (10%) → disputes return to reviewer with notes
```

### 4.4 Export & Validation Gate Flow
```
export request (format set chosen)
 ├─ snapshot approved IR (immutable export manifest)
 ├─ parallel builders:
 │   ├─ EPUB: content docs + nav + accessibility metadata (schema.org/a11y fields) 
 │   ├─ XLSX: tables → sheets, header rows marked, sheet alt-text summaries
 │   ├─ JSON: full IR + decisions + provenance → validated against public JSON Schema
 │   ├─ HTML: semantic landmarks, figures+figcaption, ARIA
 │   └─ MOBI/AZW3: from EPUB via converter → Kindle validation
 ├─ validator gate (all must PASS):
 │   ├─ epubcheck (structure)
 │   ├─ DAISY Ace (EPUB a11y)
 │   ├─ axe-core (HTML)
 │   ├─ veraPDF (PDF/UA when enabled)
 │   └─ internal rules engine (alt coverage = 100%, no empty informative alts)
 ├─ fail → EXPORT_FAILED with actionable error bundle → fix loop
 └─ pass → sign compliance report → store artifact → pre-signed delivery link + notify
```

### 4.5 Failure & Retry Flows
| Failure point | Behavior |
|---|---|
| Upload interrupted | Resumable multipart; client retries from offset |
| Provider 429/5xx | Exponential backoff ×2, then fallback provider; job stays queued |
| Parse crash on malformed file | Job fails gracefully; project shows "needs attention" with downloadable error log |
| Validator failure | Export blocked; error bundle lists rule IDs (e.g., `ace-acc-004`) mapped to human-readable fixes |
| Reviewer idle > SLA | Batch auto-reassigns after configurable timeout |

---

## 5. API Flow (programmatic users)

```
POST /v1/projects                     → create
POST /v1/projects/:id/files           → pre-signed URLs → PUT chunks
POST /v1/projects/:id/process         → enqueue pipeline
GET  /v1/projects/:id/status          → {stage, pct, eta}  (or webhook events)
GET  /v1/projects/:id/assets?state=ai_drafted
PATCH /v1/assets/:id/suggestion       → approve/edit (same semantics as UI)
POST /v1/projects/:id/export          → {formats:["epub","json"]}
GET  /v1/exports/:id                  → poll → download URL(s) + compliance_report_url
Webhooks: job.completed, review.required, export.ready, export.failed
Auth: API keys (org-scoped) → OAuth2 client-credentials later
Idempotency-Key header required on all POSTs
```

---

## 6. UX Principles Applied in Flows

1. **Progressive disclosure** — simple books sail through defaults; complex ones surface prep warnings early.
2. **Keyboard-first review** — single-key actions with undo; target ≤30s/image.
3. **Trust surfaces** — confidence badges, provenance ("AI v2 → edited by Marcus"), validator receipts visible before download.
4. **Accessible platform** — the review workbench itself is tested with NVDA/JAWS/VoiceOver; dark mode; reduced-motion respected.

---

*Related docs: [01-prd.md](01-prd.md) · [02-architecture.md](02-architecture.md) · [04-techstack.md](04-techstack.md)*
