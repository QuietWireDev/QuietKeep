# QuietKeep: config.py
# Application settings loaded from environment variables with default values.
# All values can be overridden via env vars or a .env file.
# Docker deployment sets QUIETKEEP_HOST and SSH_KEY_PATH via entrypoint.sh.
# Author: QuietWire (Dennis Ayotte)

from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "QuietKeep"
    database_url: str = "sqlite+aiosqlite:///./quietkeep.db"
    ssh_key_path: str = "/app/ssh/id_ed25519_quietkeep"  # Docker volume mount path
    ssh_timeout: int = 15
    scan_interval_hours: int = 6
    self_hostname: str = "quietkeep"  # Used to prevent QuietKeep from patching itself
    quietkeep_host: str = "localhost"  # Overridden at container startup with actual IP
    build_tag: str = ""  # Set to "TEST", "BETA", etc. to show a badge in the UI. Empty = production.

    class Config:
        env_file = ".env"


settings = Settings()
