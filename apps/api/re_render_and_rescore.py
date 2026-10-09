import asyncio
import sys
from app.jobs import create_pool
from app.rendering.slide_renderer import render_submission_slides
from app.pipeline.orchestrator import run_stage2_deep_analysis

async def main():
    pool = await create_pool()
    async with pool.acquire() as conn:
        failed_subs = await conn.fetch(
            """
            select distinct s.id from submissions s
            join consistency_flags f on f.submission_id = s.id
            where f.flag_type in ('rendering_failed', 'needs_visual_rendering')
            """
        )
        print(f"Submissions to process ({len(failed_subs)}):", [str(r['id']) for r in failed_subs], flush=True)

        for r in failed_subs:
            sub_id = r["id"]
            print(f"\n==========================================", flush=True)
            print(f"Processing submission {sub_id}", flush=True)
            print(f"==========================================", flush=True)

            print("Rendering slides...", flush=True)
            try:
                await render_submission_slides(conn, sub_id)
                print("Slides rendered successfully!", flush=True)
            except Exception as e:
                print(f"Rendering failed: {e}", flush=True)
                continue

            slides = await conn.fetch(
                "select slide_number, image_storage_paths from slides where submission_id = $1 order by slide_number",
                sub_id,
            )
            print("Slides in DB:", [(s["slide_number"], s["image_storage_paths"]) for s in slides], flush=True)

            flags = await conn.fetch(
                "select flag_type, severity, resolved from consistency_flags where submission_id = $1",
                sub_id,
            )
            print("Flags after rendering:", [dict(f) for f in flags], flush=True)

            # Now re-run Stage 2 deep analysis with the rendered slide images
            print("Running Stage 2 deep analysis...", flush=True)
            await conn.execute("update submissions set status = 'analyzing' where id = $1", sub_id)
            await conn.execute("delete from criterion_scores where submission_id = $1", sub_id)
            await conn.execute("delete from final_scores where submission_id = $1", sub_id)
            await conn.execute("delete from section_totals where submission_id = $1", sub_id)
            # Remove any stale criterion_needs_human_review flags from previous failed attempts
            await conn.execute(
                "delete from consistency_flags where submission_id = $1 and flag_type = 'criterion_needs_human_review'",
                sub_id,
            )

            await run_stage2_deep_analysis(conn, sub_id)

            sub = await conn.fetchrow("select id, status, reliability_label from submissions where id = $1", sub_id)
            final_score = await conn.fetchrow("select computed_total from final_scores where submission_id = $1", sub_id)
            print(f"Submission status: {sub['status']}, reliability: {sub['reliability_label']}", flush=True)
            print(f"Final score: {final_score['computed_total'] if final_score else 'None'}/40", flush=True)

            flags_final = await conn.fetch(
                "select flag_type, severity, resolved from consistency_flags where submission_id = $1 and resolved = false",
                sub_id,
            )
            print("Unresolved flags:", [dict(f) for f in flags_final], flush=True)

    await pool.close()

if __name__ == "__main__":
    asyncio.run(main())
