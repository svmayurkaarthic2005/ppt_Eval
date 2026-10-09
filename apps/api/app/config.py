from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# The project has a single .env at the repo root (see .env.example), but
# pydantic-settings resolves a relative env_file against the process's
# current working directory -- which is apps/api when running uvicorn
# locally, not the repo root. Docker never hit this (docker-compose injects
# the env_file as real process env vars, bypassing this lookup entirely),
# but local dev silently got empty settings. Resolve from this file's own
# location instead, so it works regardless of where the process is launched.
#
# In Docker: /app/app/config.py -> parents[2] would be /
# In local: workspace/apps/api/app/config.py -> parents[3] is workspace/
# Try parents[3] first (local), fall back to checking parents for .env file
_current_file = Path(__file__).resolve()
_ROOT_ENV_FILE: Path | None = None
try:
    _ROOT_ENV_FILE = _current_file.parents[3] / ".env"
    if not _ROOT_ENV_FILE.exists():
        # Docker environment or different structure - search upward
        for parent in _current_file.parents:
            env_file = parent / ".env"
            if env_file.exists():
                _ROOT_ENV_FILE = env_file
                break
        else:
            _ROOT_ENV_FILE = None  # No .env found, rely on environment variables
except IndexError:
    # Can't go up 3 parents - search upward from current location
    for parent in _current_file.parents:
        env_file = parent / ".env"
        if env_file.exists():
            _ROOT_ENV_FILE = env_file
            break


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ROOT_ENV_FILE if _ROOT_ENV_FILE else None, 
        extra="ignore"
    )

    groq_api_key: str = ""
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_anon_key: str = ""
    database_url: str = ""
    libreoffice_path: str = ""
    semantic_scholar_api_key: str = ""





@lru_cache
def get_settings() -> Settings:
    return Settings()

