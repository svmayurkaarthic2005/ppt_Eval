# HackEval

Multimodal hackathon PPT evaluator.

## Monorepo layout

- `apps/web` — React 18 + Vite + TypeScript + Tailwind. Pages: `/upload`, `/dashboard`, `/team/:id`, `/admin/calibration`.
- `apps/api` — FastAPI. Python extracts PPTX structure and renders slides far more reliably than Node. Routers: `submissions`, `evaluation`, `rubric`, `calibration`.
- `packages/types` — TypeScript types mirroring the API's Pydantic models (`Rubric`, `Criterion`, `SlideEvidence`, `EvaluationResult`, `SubmissionRecord`), so web and api never drift apart. Keep both sides in sync by hand when either changes.

## Pipeline stages

1. **upload** — a team submits a `.pptx` file.
2. **extract** — the API reads the PPTX structure (text, layout, speaker notes) with `python-pptx`.
3. **render** — slides are rendered to images via the headless LibreOffice container, for multimodal analysis.
4. **rubric-build** — the active rubric's criteria are loaded for the event.
5. **LLM-analyze** — slide text + images are sent to Groq for per-criterion evidence extraction.
6. **validate** — model output is checked against the rubric schema and rejected/retried on malformed results.
7. **score** — raw per-criterion scores are computed from validated evidence.
8. **calibrate** — scores are adjusted against a calibration set to correct for judge/model drift.
9. **rank** — calibrated totals are ranked for the dashboard.

## Local dev

```bash
cp .env.example .env   # fill in GROQ_API_KEY and SUPABASE_* keys
pnpm install
pnpm dev                # boots apps/web (5173) and apps/api (8000)
```

Or via Docker Compose (also starts the LibreOffice renderer used in stage 3):

```bash
docker compose up
```

Check `GET http://localhost:8000/health` — it reports `supabase` and `groq` connectivity.
