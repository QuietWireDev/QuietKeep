# QuietKeep: auth.py
# JWT token creation/verification and FastAPI dependency for route protection.
# Uses HTTP-only cookies for token storage (no localStorage exposure).
# JWT secret is auto-generated on first run and stored in the data directory.
# Author: QuietWire (Dennis Ayotte)

import os
import secrets
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AdminUserModel

logger = logging.getLogger(__name__)

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT settings
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
COOKIE_NAME = "quietkeep_token"

# The secret is stored in a file so it persists across container restarts
# but is never committed to source control.
_SECRET_PATH = Path(os.environ.get("QUIETKEEP_DATA_DIR", "/app/data")) / ".jwt_secret"


def _get_secret_key() -> str:
    """Load or generate the JWT signing secret."""
    if _SECRET_PATH.exists():
        return _SECRET_PATH.read_text().strip()
    secret = secrets.token_urlsafe(64)
    _SECRET_PATH.parent.mkdir(parents=True, exist_ok=True)
    _SECRET_PATH.write_text(secret)
    _SECRET_PATH.chmod(0o600)
    logger.info("Generated new JWT secret")
    return secret


def get_secret_key() -> str:
    return _get_secret_key()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(username: str, expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    payload = {"sub": username, "exp": expire}
    return jwt.encode(payload, get_secret_key(), algorithm=ALGORITHM)


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> AdminUserModel:
    """FastAPI dependency that extracts and validates the JWT from the cookie.

    Returns the AdminUserModel if valid, raises 401 otherwise.
    """
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    try:
        payload = jwt.decode(token, get_secret_key(), algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    result = await db.execute(
        select(AdminUserModel).where(AdminUserModel.username == username)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user
