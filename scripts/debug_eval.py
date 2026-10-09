import asyncio
import io
import json
from uuid import UUID
from app.jobs import create_pool
from app.pipeline.orchestrator import _download_first_image
from app.supabase_client import get_service_client
from app.models.schemas import SubmissionContext
from app.rubric.builder import build_rubric
from app.llm.client import EvidenceSlide, evaluate_criterion, default_rate_limiter

async def main():
    pool = await create_pool()
    async with pool.acquire() as conn:
        sub_id = UUID('65fb2da0-ede6-42b1-b293-1053a9c50b62')
        sub = await conn.fetchrow("select rubric_template_id, submission_context from submissions where id = $1", sub_id)
        tmpl = await conn.fetchrow("select id, sections from rubric_templates where id = $1", sub["rubric_template_id"])
        ctx = SubmissionContext(**sub["submission_context"])
        rubric = build_rubric(tmpl["id"], tmpl["sections"], ctx)
        
        slides = await conn.fetch(
            "select slide_number, raw_text, image_storage_paths from slides where submission_id = $1 order by slide_number",
            sub_id,
        )
        storage = get_service_client().storage.from_("rendered-slides")
        evidence_slides = [
            EvidenceSlide(
                slide_number=s["slide_number"],
                raw_text=s["raw_text"] or "",
                image_bytes=_download_first_image(storage, s["image_storage_paths"]),
            )
            for s in slides
        ]
        
        print("Evidence slides:", [(s.slide_number, len(s.image_bytes) if s.image_bytes else None) for s in evidence_slides])
        crit = rubric.criteria[0]
        print(f"Evaluating criterion {crit.criterion_key}...")
        try:
            res = await evaluate_criterion(conn, sub_id, crit, evidence_slides, ctx, default_rate_limiter)
            print("Evaluation result:", res.status, res.result)
        except Exception as e:
            print(f"Exception raised: {type(e)} {e}")

    await pool.close()

if __name__ == "__main__":
    asyncio.run(main())
