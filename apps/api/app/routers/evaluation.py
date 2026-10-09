from fastapi import APIRouter

from app.models.schemas import EvaluationResult

router = APIRouter(prefix="/evaluation", tags=["evaluation"])


@router.get("/{submission_id}", response_model=EvaluationResult | None)
async def get_evaluation(submission_id: str) -> None:
    """Not yet implemented: will run extract -> render -> LLM-analyze -> score."""
    return
