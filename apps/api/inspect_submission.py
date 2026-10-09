import asyncio
import asyncpg
from uuid import UUID
from app.config import get_settings

async def main():
    s = get_settings()
    conn = await asyncpg.connect(s.database_url)
    sub_id = UUID("2f4f1476-e2b1-46b6-9851-ee2f416d6bf4")
    slides = await conn.fetch("select slide_number, title, needs_visual_rendering, image_storage_paths from slides where submission_id = $1 order by slide_number", sub_id)
    print("SLIDES:")
    for sl in slides:
        print(dict(sl))
    cache = await conn.fetch("select * from rendered_slide_cache")
    print("CACHE:", [dict(c) for c in cache])
    jobs = await conn.fetch("select job_type, status, error_message from jobs where submission_id = $1", sub_id)
    print("JOBS:", [dict(j) for j in jobs])
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
