import logging

from app.supabase_client import get_service_client

logger = logging.getLogger("hackeval.storage_cleanup")


def cleanup_submission_storage(
    pptx_path: str | None,
    ps_path: str | None,
    image_paths: list[str] | None = None,
) -> None:
    """Best-effort cleanup of Supabase storage files for a submission."""
    storage = get_service_client().storage
    if pptx_path:
        try:
            storage.from_("pptx-uploads").remove([pptx_path])
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to remove pptx file %s: %s", pptx_path, exc)

    if ps_path:
        try:
            storage.from_("problem-statements").remove([ps_path])
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to remove problem statement file %s: %s", ps_path, exc)

    if image_paths:
        try:
            storage.from_("rendered-slides").remove(image_paths)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to remove rendered slide images: %s", exc)
