import asyncio
import os
import asyncpg
from dotenv import load_dotenv

load_dotenv("c:/pptEvaluator/.env")

async def main():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL is not set!")
        return
    conn = await asyncpg.connect(db_url)
    print("Connected to DB. Adding cost_analysis column to submissions...")
    await conn.execute("""
        alter table submissions add column if not exists cost_analysis jsonb;
    """)
    print("Column cost_analysis added successfully!")
    cols = await conn.fetch("select column_name from information_schema.columns where table_name = 'submissions'")
    print("Columns on submissions now:", [c["column_name"] for c in cols])
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
