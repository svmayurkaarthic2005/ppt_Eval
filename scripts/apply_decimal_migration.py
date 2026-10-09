import asyncio
import os
import asyncpg
from dotenv import load_dotenv

load_dotenv("c:/pptEvaluator/.env")

async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    print("Connected to DB. Applying decimal scoring & academic benchmark migration...")

    # 1. Alter score columns to numeric(6,2)
    await conn.execute("""
        alter table criterion_scores alter column llm_score type numeric(6,2);
        alter table criterion_scores alter column max_score type numeric(6,2);
        alter table section_totals alter column computed_total type numeric(6,2);
        alter table final_scores alter column computed_total type numeric(6,2);
        alter table submissions alter column preliminary_score type numeric(6,2);
        alter table submissions add column if not exists academic_benchmark jsonb;
    """)
    print("Columns altered to numeric(6,2) and academic_benchmark column added.")

    # 2. Update trigger functions to preserve decimal precision with round
    await conn.execute("""
        create or replace function enforce_section_total() returns trigger as $$
        begin
          new.computed_total := coalesce((
            select round(sum(llm_score), 2) from criterion_scores
            where submission_id = new.submission_id and section_key = new.section_key
          ), 0);
          new.updated_at := now();
          return new;
        end;
        $$ language plpgsql;

        create or replace function enforce_final_total() returns trigger as $$
        begin
          new.computed_total := coalesce((
            select round(sum(computed_total), 2) from section_totals
            where submission_id = new.submission_id
          ), 0);
          new.updated_at := now();
          return new;
        end;
        $$ language plpgsql;
    """)
    print("Triggers updated.")

    # Also save as a migration file in supabase/migrations
    await conn.close()
    print("Migration complete!")

if __name__ == "__main__":
    asyncio.run(main())
