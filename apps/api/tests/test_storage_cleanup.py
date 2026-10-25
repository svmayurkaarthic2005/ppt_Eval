from unittest.mock import MagicMock, patch

from app.storage_cleanup import cleanup_submission_storage


def test_cleanup_submission_storage_removes_all_given_paths():
    storage = MagicMock()
    with patch("app.storage_cleanup.get_service_client", return_value=MagicMock(storage=storage)):
        cleanup_submission_storage(
            pptx_path="decks/a.pptx",
            ps_path="problem-statements/b.pdf",
            image_paths=["slides/1.png", "slides/2.png"],
        )

    storage.from_.assert_any_call("pptx-uploads")
    storage.from_("pptx-uploads").remove.assert_any_call(["decks/a.pptx"])
    storage.from_.assert_any_call("problem-statements")
    storage.from_("problem-statements").remove.assert_any_call(["problem-statements/b.pdf"])
    storage.from_.assert_any_call("rendered-slides")
    storage.from_("rendered-slides").remove.assert_any_call(["slides/1.png", "slides/2.png"])


def test_cleanup_submission_storage_skips_absent_paths():
    storage = MagicMock()
    with patch("app.storage_cleanup.get_service_client", return_value=MagicMock(storage=storage)):
        cleanup_submission_storage(pptx_path=None, ps_path=None, image_paths=None)

    storage.from_.assert_not_called()


def test_cleanup_submission_storage_is_best_effort_on_failure():
    """One bucket's removal failing must not stop the others from being attempted."""
    storage = MagicMock()
    storage.from_.return_value.remove.side_effect = RuntimeError("storage unavailable")

    with patch("app.storage_cleanup.get_service_client", return_value=MagicMock(storage=storage)):
        cleanup_submission_storage(pptx_path="decks/a.pptx", ps_path="ps/b.pdf", image_paths=["s/1.png"])

    assert storage.from_.call_count == 3
