import asyncio
import sys
from uuid import UUID

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import asyncpg
from app.config import get_settings
from app.rendering.slide_renderer import render_submission_slides

async def main():
    s = get_settings()
    conn = await asyncpg.connect(s.database_url)
    sub_id = UUID("2f4f1476-e2b1-46b6-9851-ee2f416d6bf4")
    
    print(f"Re-rendering slides for submission {sub_id}...")
    await render_submission_slides(conn, sub_id)
    print("Slide rendering complete!")
    
    slides = await conn.fetch(
        "select slide_number, title, image_storage_paths from slides where submission_id = $1 order by slide_number",
        sub_id,
    )
    for sl in slides:
        print(f"Slide {sl['slide_number']}: {sl['title']} -> {sl['image_storage_paths']}")
        
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
