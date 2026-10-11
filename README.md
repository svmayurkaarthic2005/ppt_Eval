# HackEval

**An AI jury for hackathons.** Upload a team's pitch deck, pick the problem
statement it's tackling, and get a rubric-grounded, literature-aware,
evidence-cited score — automatically, consistently, and fast enough to judge
hundreds of submissions without hundreds of human-hours.

---

## The problem this solves

Judging a hackathon by hand doesn't scale and doesn't stay consistent.
Ten human judges skim fifty decks each in twenty minutes and you get ten
different rubrics applied ten different ways, fatigue bias in the last few
decks of the day, and no paper trail for *why* a team scored what they
scored. HackEval replaces that with a pipeline that:

- reads the actual deck (text, layout, charts, and the slide images
  themselves — not just a text dump),
- scores it against an explicit, versioned rubric instead of vibes,
- cites the exact slide and quote behind every score,
- checks the deck's own claims against each other for contradictions,
- grounds "is this actually novel" against real IEEE/arXiv literature,
- and flags — honestly, out loud — when it isn't confident enough to be
  trusted without a human look.

## What makes it worth presenting

- **Multimodal, not just an LLM text-summarizer.** Slides are rendered to
  real images (LibreOffice headless) and sent to a vision model alongside
  the extracted text, so a chart or architecture diagram actually gets
  evaluated, not just whatever alt-text-equivalent a text-only model would
  guess at.
- **Grounded in real academic literature.** Every submission's "how novel is
  this really" judgment is backed by live IEEE (CrossRef) and arXiv queries,
  not the model's training-data guess at what's state-of-the-art.
- **Every score is traceable.** Click into any criterion and see the exact
  slide, the exact quoted text, and the exact rationale the model gave —
  never a bare number with no paper trail.
- **It catches its own mistakes.** A dedicated cross-modal consistency pass
  compares claims the deck makes against each other (e.g. a stated timeline
  vs. a workflow diagram) and flags contradictions instead of silently
  scoring through them. Numeric claims (revenue, percentages) are checked
  with real decimal arithmetic, never trusted from the model's own math.
- **It knows what it doesn't know.** A `reliability_label` (`HIGH` /
  `MEDIUM` / `REVIEW`) on every submission is derived from empirical
  calibration data (how far AI scores have historically drifted from human
  judges at that score range) and from any flags raised during scoring —
  never from the model's own self-reported confidence, which research shows
  is uncalibrated. A `REVIEW` label is a loud, honest "a human should look
  at this one."
- **Two-tier scoring keeps it affordable at scale.** Every submission gets a
  cheap Stage 1 triage pass automatically; only the submissions an organizer
  actually wants ranked precisely get the expensive, fully-cited Stage 2
  pass. You're not paying full LLM cost to evaluate 500 submissions in
  detail when only the top 50 matter for the final round.
- **Deploys for free.** Render (API + LibreOffice in Docker) + a static
  host (Vercel/Netlify/Cloudflare Pages) for the frontend + Supabase free
  tier for Postgres/Storage/Auth — `render.yaml` in this repo is a ready-to-go
  deploy config.

---

## Architecture

```
┌─────────────┐      ┌──────────────────────────────────────────┐      ┌─────────────┐
│  apps/web    │◄────►│                apps/api                   │◄────►│  Supabase   │
│  React+Vite  │ REST │              FastAPI (Python)              │      │  Postgres   │
│  Tailwind    │      │                                            │      │  Storage    │
└─────────────┘      │  job queue (Postgres SKIP LOCKED) ─┐        │      │  Auth       │
                      │                                    ▼        │      └─────────────┘
                      │   extract → render → build-rubric →         │
                      │   stage1-triage → stage2-deep-analysis       │
                      └──────────────────┬─────────────────────────┘
                                          │
                              ┌───────────┴───────────┐
                              ▼                        ▼
                      ┌───────────────┐       ┌─────────────────┐
                      │  Groq (LLM)   │       │  IEEE / arXiv    │
                      │  vision+text  │       │  literature API  │
                      │  scoring      │       │  (academic       │
                      └───────────────┘       │   benchmark)     │
                                               └─────────────────┘
```

`packages/types` holds TypeScript interfaces mirrored by hand from the
API's Pydantic models, so the frontend and backend never silently drift
apart on a shape change.

---

## The evaluation pipeline, end to end

A submission moves through a durable Postgres-backed job queue (plain
`SELECT ... FOR UPDATE SKIP LOCKED` polling — no Redis/Celery needed), so a
worker crash mid-pipeline just means the next poll picks the job back up.

| # | Stage | What happens |
|---|-------|--------------|
| 1 | **Upload** | A team submits a `.pptx` plus a problem statement (pick an existing one, type one, or upload a PDF/DOCX). The problem statement is the grouping key for ranking — it's never fuzzy-matched, only an explicit FK. |
| 2 | **Extract** | `python-pptx` pulls text, layout, speaker notes, table cell values, and hyperlinks out of every slide — structurally, not as an OCR guess. |
| 3 | **Render** | Each slide is rendered to a real PNG via headless LibreOffice (with a PowerPoint COM fallback on Windows), so slides containing charts, diagrams, or screenshots can actually be *seen* by the vision model, not just inferred from whatever text happens to be on them. |
| 4 | **Rubric build** | The event's rubric template (sections → criteria, each with its own max score) is instantiated for this submission, grounded in its stated problem domain and target beneficiary. |
| 5 | **Stage 1 — triage** | Every submission gets one cheap, fast pass across the rubric to produce a provisional score. This is what lets an organizer see *something* for every team immediately, without paying full cost for submissions that won't make the cut. |
| 6 | **Stage 2 — deep analysis** *(selected submissions only)* | For each criterion: slide text + slide images (batched, with the model explicitly told which pictured slides it is *not* seeing this round, to prevent it hallucinating content from slides it was never shown) are sent to Groq's vision model in strict JSON-schema mode. The response must cite which slide(s) support the score — citations that reference a slide number that doesn't exist are dropped rather than trusted. A criterion that fails validation twice gets flagged `needs_human_review` and a safe placeholder score, rather than leaving the submission stuck mid-pipeline forever. |
| 7 | **Validate** | Numeric claims the deck makes (revenue, percentages, growth rates) are re-parsed and checked with `decimal.Decimal` — real arithmetic, never trusted from the model's own math or from a float. |
| 8 | **Cross-modal consistency** | A dedicated pass compares claims already extracted across modalities (written text vs. workflow structure vs. architecture description) for contradictions. A conflict lowers the submission's reliability signal; it doesn't double-penalize a score that already reflects weak evidence. |
| 9 | **Academic benchmark** | The problem domain and deck content are used to query IEEE (via CrossRef) and arXiv for real, live state-of-the-art literature. An LLM pass then synthesizes: what existing solutions exist, what gaps they have, how this submission compares, and what its honest limitations are — grounded in actual papers, not the model's training-data guess. |
| 10 | **Score** | Per-criterion scores roll up into section totals and a final total, computed from validated, stored rows only — never re-derived by asking the LLM to "explain" a score after the fact. |
| 11 | **Calibrate & label reliability** | The submission's score is compared against the nearest-score-range empirical calibration data (real AI-vs-human score pairs an organizer has recorded) to compute a mean absolute error, combined with any unresolved flags, into a `HIGH` / `MEDIUM` / `REVIEW` reliability label — the most cautious of the two signals wins. |
| 12 | **Rank** | Final totals are ranked overall and grouped by problem statement, with ties and manual pin/override support for organizers. |

### Admin controls

- **Human calibration**: organizers can enter their own score for a sample
  of submissions; the gap between that and the AI score feeds back into
  stage 11's reliability calculation for every future submission in that
  score range.
- **Manual rank pinning**: an organizer can pin a submission to a specific
  rank, overriding the computed order, for edge cases the rubric can't
  capture.
- **Stage 2 selection**: trigger full deep-analysis scoring for the
  submissions that actually need it (top N by Stage 1 score, or hand-picked),
  without re-running the whole pipeline.

---

## Rubric

Four sections, five criteria each, two points per criterion (40 total),
instantiated per-submission against its stated problem domain:

| Section | Criteria |
|---|---|
| **Problem Understanding** | problem clearly defined · target beneficiary identified · root cause explained · scope & scale articulated · evidence for the problem |
| **Existing Solutions** | existing solutions identified · gaps analyzed · comparison is specific, not generic · awareness of alternatives · justification for a new approach |
| **Proposed Solution & Affordability** | solution addresses the problem · technical feasibility · cost/affordability · scalability · innovation & differentiation |
| **Execution Plan & Timeline** | implementation plan clarity · timeline & milestones · resource/team plan · risk mitigation · deployment & rollout plan |

Every criterion's score carries a written rationale and (where the model
cited one) the exact slide and quoted text behind it — visible per-criterion
in the Team detail view, not just a rolled-up number.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS |
| Backend | FastAPI, Python 3.11, asyncpg (direct Postgres) |
| Database / Storage / Auth | Supabase (Postgres + Storage + anonymous Auth) |
| LLM | Groq — `qwen/qwen3.8-27b` (primary, vision + text), `openai/gpt-oss-120b` (text fallback), `openai/gpt-oss-20b` (cheap slide-role classification) |
| Slide rendering | LibreOffice headless (`soffice --convert-to pdf`), PowerPoint COM fallback on Windows |
| Literature grounding | IEEE via CrossRef, arXiv |
| Job queue | Plain Postgres (`SELECT ... FOR UPDATE SKIP LOCKED`) — no separate queue service |

---

## Project structure

```
apps/
  web/                      React + Vite + TS + Tailwind
    src/pages/               Home, Upload, Team, Dashboard, Compare, AdminCalibration
    src/components/          Layout, RankingTable, Dropzone, ConfirmDialog, compare/*
    src/lib/                 api.ts (fetch wrappers), supabaseClient.ts, timing.ts
  api/                      FastAPI backend
    app/routers/              submissions, teams, evaluation, rubric, calibration, rankings, problem_statements
    app/pipeline/             orchestrator.py — stage1/stage2 job handlers
    app/extraction/           pptx structural parsing, slide-role classification
    app/rendering/            LibreOffice/PowerPoint slide-to-image conversion
    app/llm/                  Groq client, rate limiter
    app/validation/           deterministic numeric checks, cross-modal consistency
    app/research/             IEEE/arXiv literature fetch + academic benchmark synthesis
    app/scoring/               final score computation
    app/calibration/           reliability labeling, calibration run statistics
    app/evidence/              per-criterion evidence/audit trail API
    app/rubric/                rubric template instantiation
    tests/                    pytest suite (165+ tests, pure-function coverage for every validation/scoring module)
packages/
  types/                    Shared TS interfaces mirroring the API's Pydantic models
supabase/
  migrations/               20 SQL migrations — schema, triggers enforcing score-completeness invariants, RLS
```

---

## Local development

```bash
cp .env.example .env   # fill in GROQ_API_KEY and SUPABASE_* keys
pnpm install
pnpm dev                # boots apps/web (5173) and apps/api (8000), plus the types watcher
```

Or via Docker Compose (also builds LibreOffice into the API container):

```bash
docker compose up
```

Check `GET http://localhost:8000/health` — it reports `supabase` and `groq`
connectivity.

### Verification

```bash
pnpm typecheck   # tsc --noEmit + mypy
pnpm lint        # eslint + ruff
cd apps/api && .venv/Scripts/python.exe -m pytest tests/ -q
```

---

## Deployment (free tier)

`render.yaml` in this repo defines both services:

- **API** — deployed as a Docker web service on Render (LibreOffice is
  installed in `apps/api/Dockerfile`), free plan.
- **Web** — deployed as a Render static site (or any static host — Vercel,
  Netlify, Cloudflare Pages all work identically for a Vite build).
- **Database/Storage/Auth** — Supabase free tier, already in use.

Render's free web services sleep after 15 minutes of inactivity and take
roughly a minute to wake on the next request — acceptable for a hackathon
judging tool that isn't hit 24/7.
