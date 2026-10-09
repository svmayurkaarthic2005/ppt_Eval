from fastapi import APIRouter

from app.models.schemas import RubricTemplate

router = APIRouter(prefix="/rubric", tags=["rubric"])


@router.get("/", response_model=list[RubricTemplate])
async def list_rubrics() -> list[RubricTemplate]:
    """Not yet implemented: will list rubric templates from Supabase."""
    return []
