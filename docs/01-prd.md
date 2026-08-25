# Lumen — Product Requirements Document (PRD)

| Field | Value |
|---|---|
| Product Name | **Lumen** |
| Version | 1.0 |
| Status | Draft → In Design |
| Owner | Product Team |
| Last Updated | 2026-08-25 |

---

## 1. Vision Statement

> **Lumen** makes digital content accessible to everyone by combining AI automation with human judgment. It ingests books, documents, and images; extracts and describes visual content with AI-generated alt text; and converts content into fully accessible, standards-compliant formats (EPUB, Excel, JSON, MOBI) — every output validated by humans before delivery.

**One-liner:** *AI does 95% of the work, humans provide 100% of the trust.*

---

## 2. Problem Statement

### 2.1 The Accessibility Gap
- **285M+ people** worldwide are blind or visually impaired (WHO).
- **~70% of images on the web** have missing or poor alt text.
- **EPUB check failures**: most self-published EPUBs fail accessibility validation.
- Manual alt-text writing costs **$0.50–$3 per image** and doesn't scale for publishers with thousands of images.
- Existing tools are either:
  - Fully automated (fast but unreliable — hallucinated descriptions),
  - Or fully manual (accurate but slow and expensive).

### 2.2 Why Now
- AI vision models (GPT-4V, Claude, LLaVA) can now describe images at near-human quality.
- Legal pressure increasing: ADA lawsuits hit **4,000+/year** in the US alone.
- European Accessibility Act enforcement began **June 2025** — publishers must comply.

### 2.3 The Lumen Solution
A **human-in-the-loop pipeline**: AI generates → humans validate/fix → platform exports to any accessible format, guaranteed compliant.

---

## 3. Goals & Success Metrics

### 3.1 Business Goals
| Goal | Metric | Target (12 mo) |
|---|---|---|
| Reduce alt-text cost | Cost per image | < $0.05 |
| Scale throughput | Images processed/day | 100,000+ |
| Ensure compliance | Audit pass rate | 100% on WCAG 2.1 AA / EPUB A11y 1.1 |
| Grow adoption | Active organizations | 50+ |

### 3.2 User Goals
| User | Goal | Success Signal |
|---|---|---|
| Publisher / Content Ops | Bulk-process a 400-page book with 300 images in hours, not weeks | Book processed < 24h |
| Accessibility Reviewer | Review AI suggestions quickly with context | Review ≤ 30s/image average |
| Educator | Get accessible course materials in required format | One-click export |
| End Reader | Content usable with screen readers | Zero a11y errors in output |

### 3.3 Non-Goals (v1)
- ❌ Real-time/live video captioning
- ❌ Full website scanning/crawling (future: separate product "Lumen Scan")
- ❌ Braille embosser hardware integration
- ❌ Non-Latin script OCR beyond Latin/Cyrillic/CJK baseline

---

## 4. Target Users & Personas

### Persona 1: Priya — Publishing House Content Manager
- Manages backlist digitization (10k+ legacy books).
- Needs: bulk upload, queue visibility, cost tracking, EPUB + MOBI outputs.
- Pain: vendors quote $5k/book and 6-week timelines.

### Persona 2: Marcus — Accessibility Specialist / Validator
- Certified CPACC reviewer at an agency.
- Needs: side-by-side image ↔ description review, edit history, keyboard-only workflow, screen-reader-compatible UI.
- Pain: reviewing in spreadsheets loses image context.

### Persona 3: Dr. Chen — University Educator
- Needs accessible PDFs converted to Excel datasets and EPUB textbooks.
- Pain: no tool handles tables-in-images extraction reliably.

### Persona 4: Sam — Indie Author
- Self-publishes on Kindle/Apple Books; needs compliance without hiring experts.
- Pain: doesn't know what "EPUB Accessibility 1.1" means, just needs "pass."

---

## 5. Functional Requirements

### 5.1 Ingestion (P0)
| ID | Requirement | Priority |
|---|---|---|
| F-1 | Upload files: PDF, DOCX, EPUB, MOBI, ZIP of images, single images (PNG/JPG/WebP/TIFF) | P0 |
| F-2 | URL ingestion: fetch a web page/article and extract images | P1 |
| F-3 | Auto-detect document structure: chapters, headings, paragraphs, tables, figures | P0 |
| F-4 | Image extraction from source docs with position/page metadata | P0 |
| F-5 | Deduplicate identical/near-identical images (perceptual hash) | P1 |

### 5.2 AI Alt-Text Generation (P0)
| ID | Requirement | Priority |
|---|---|---|
| F-6 | Generate alt text (≤125 chars), long description, and caption suggestions per image | P0 |
| F-7 | Context-aware: use surrounding document text to disambiguate ("Figure 3" references) | P0 |
| F-8 | Image classification: photograph / chart / diagram / table-scan / decorative / infographic | P0 |
| F-9 | Decorative images flagged as `alt=""` automatically | P0 |
| F-10 | Chart/table-scan → structured data extraction (rows/columns → CSV/Excel) | P0 |
| F-11 | Confidence score per suggestion (0–100); low confidence routed to mandatory human review | P0 |
| F-12 | Language support: generate alt text in source-document language (EN first, then ES/FR/DE/HI) | P1 |

### 5.3 Human Validation Workflow (P0)
| ID | Requirement | Priority |
|---|---|---|
| F-13 | Review dashboard: image, AI suggestion, confidence, surrounding context, editable fields | P0 |
| F-14 | Actions: Approve / Edit & Approve / Reject & Rewrite / Mark Decorative | P0 |
| F-15 | Keyboard-first UX (fully operable without mouse; WCAG 2.1 AA UI itself) | P0 |
| F-16 | Assignment & roles: Admin assigns batches to reviewers; track per-reviewer throughput | P1 |
| F-17 | Every edit logged (audit trail): original AI text, final text, reviewer, timestamp | P0 |
| F-18 | Spot-check mode: random 10% sample re-review by senior validator before export | P2 |

### 5.4 Multi-Format Export (P0)
| ID | Requirement | Format | Standard | Priority |
|---|---|---|---|---|
| F-19 | Accessible EPUB 3 with full alt text, semantics, nav doc | `.epub` | EPUB Accessibility 1.1 (WCAG 2.1 AA) | P0 |
| F-20 | Accessible tagged PDF (re-tagged, reading order fixed) | `.pdf` | PDF/UA-1 (ISO 14289) | P1 |
| F-21 | Extracted data tables → styled accessible workbook | `.xlsx` | WCAG (sheet names, headers, alt text on charts) | P0 |
| F-22 | Structured content export: metadata, alt texts, extracted tables | `.json` | Schema v1 documented publicly | P0 |
| F-23 | Re-authored MOBI via Kindle Previewer-compatible pipeline | `.mobi/.azw3` | Amazon accessibility guidance | P1 |
| F-24 | HTML output with ARIA landmarks & semantic markup | `.html` | WCAG 2.1 AA | P0 |
| F-25 | Automated pre-export validation gate (ace by DAISY, epubcheck, veraPDF) must pass | All | — | P0 |

### 5.5 Compliance & Reporting (P1)
| ID | Requirement | Priority |
|---|---|---|
| F-26 | Compliance report per export: which standards checked, pass/fail, human sign-off record | P1 |
| F-27 | VPAT-style downloadable summary for enterprise buyers | P2 |

### 5.6 Platform Basics (P0)
| ID | Requirement | Priority |
|---|---|---|
| F-28 | Auth: email/password + SSO (Google/Microsoft) | P0 |
| F-29 | Org accounts, projects, role-based access (Owner/Admin/Reviewer/Viewer) | P0 |
| F-30 | Job queue dashboard: status, progress %, ETA, error states | P0 |
| F-31 | Notifications: email + in-app when job completes / needs review | P1 |
| F-32 | Usage metering: pages, images, API calls per org (billing basis) | P0 |

---

## 6. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Accessibility** | The Lumen app itself must meet WCAG 2.1 AA and be screen-reader tested (NVDA, JAWS, VoiceOver). We practice what we ship. |
| **Performance** | Alt-text generation ≤ 5s/image p95; book (300 imgs) end-to-end ≤ 24h incl. human review; export generation ≤ 60s/book. |
| **Scalability** | Horizontal worker scaling; 500k queued images without degradation. |
| **Availability** | 99.5% monthly uptime for web app; queue processing resilient to provider outages (retry + fallback models). |
| **Security** | Encryption at rest (AES-256) & transit (TLS 1.2+); SOC 2 roadmap; publisher NDA-grade confidentiality of unreleased manuscripts. |
| **Privacy** | No customer content used to train third-party models (enforced via provider zero-retention endpoints); GDPR data-deletion support. |
| **Auditability** | Immutable audit log of every AI suggestion → human decision. |
| **i18n** | UI in English (v1); alt-text generation multilingual. |

---

## 7. Compliance Standards Mapping

| Standard | How Lumen Complies |
|---|---|
| **WCAG 2.1 AA** | Alt text on all informative images; decorative marked correctly; contrast-checked exports; semantic structure preserved. |
| **ADA (Title III)** | Outputs designed for equal access; compliance report evidences remediation effort. |
| **Section 508** | Same artifacts as WCAG AA; tagged PDF path covers federal procurement needs. |
| **EPUB Accessibility 1.1** | `schema:accessMode`, `accessibilityFeature`, `accessibilitySummary` metadata populated; validated with DAISY Ace. |
| **PDF/UA (ISO 14289)** | Tagged structure tree, correct reading order, alt text on figures; validated with veraPDF. |

---

## 8. Release Plan

### Phase 0 — Foundation (Weeks 1–4)
Core infra, auth, upload pipeline, job queue, DB schema.

### Phase 1 — MVP "Single Book, End to End" (Weeks 5–10)
PDF → extract images → AI alt text → review UI → EPUB + JSON export with validation gate. 5 design partners testing.

### Phase 2 — Formats & Teamwork (Weeks 11–16)
XLSX, HTML, MOBI outputs; reviewer assignment; audit trail UI; usage metering; API beta.

### Phase 3 — Scale & Compliance Pack (Weeks 17–24)
Tagged PDF/PDF-UA; compliance reports; spot-check workflows; multilingual alt text; public API GA; SOC 2 Type I start.

---

## 9. Open Questions

1. MOBI: Amazon deprecated MOBI uploads (2022) — do we target AZW3/KPF instead? *(Recommendation: yes, label feature "Kindle-ready".)*
2. Pricing model: per-image credits vs. per-book subscription? *(TBD after design-partner interviews.)*
3. Do validators need offline/batch review capability for secure air-gapped clients?

---

## 10. Appendix: Glossary

| Term | Definition |
|---|---|
| Alt text | Short textual alternative conveying an image's purpose to non-visual users |
| Long description | Extended description for complex images (charts, diagrams) |
| Decorative image | Image conveying no information; exposed to AT as empty alt |
| Ace | DAISY Consortium's EPUB accessibility checker |
| veraPDF | Open-source PDF/A and PDF/UA validator |
| HITL | Human-in-the-loop |
