# QuietKeep: routers/auth.py
# Authentication endpoints: login, logout, first-run setup, status check,
# TOTP 2FA enrollment/verification, and password reset via filesystem token.
# Single admin user only. Password set during first-run wizard.
# Author: QuietWire (Dennis Ayotte)

import base64
import io
import os
import secrets
from datetime import datetime
from pathlib import Path
from typing import Optional

import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    COOKIE_NAME,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.database import get_db
from app.models import AdminUserModel

router = APIRouter(prefix="/api/auth", tags=["auth"])

_DATA_DIR = Path(os.environ.get("QUIETKEEP_DATA_DIR", "/app/data"))
_RESET_TOKEN_PATH = _DATA_DIR / ".password_reset_token"


class LoginRequest(BaseModel):
    username: str
    password: str
    totp_code: Optional[str] = None


class SetupRequest(BaseModel):
    password: str


class TOTPVerifyRequest(BaseModel):
    code: str


class ChangePasswordRequest(BaseModel):
    password: str


class ResetPasswordRequest(BaseModel):
    reset_token: str
    new_password: str


@router.get("/status")
async def auth_status(db: AsyncSession = Depends(get_db)):
    """Check if auth is set up.

    Returns:
        - setup_complete: whether an admin user exists
    """
    result = await db.execute(select(func.count()).select_from(AdminUserModel))
    count = result.scalar()
    return {"setup_complete": count > 0}


@router.post("/setup")
async def setup_admin(body: SetupRequest, response: Response, db: AsyncSession = Depends(get_db)):
    """First-run: create the admin user. Only works when no admin exists."""
    result = await db.execute(select(func.count()).select_from(AdminUserModel))
    count = result.scalar()
    if count > 0:
        raise HTTPException(status_code=409, detail="Admin user already exists")

    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user = AdminUserModel(
        username="admin",
        password_hash=hash_password(body.password),
        created_at=datetime.utcnow(),
    )
    db.add(user)
    await db.commit()

    # Auto-login after setup
    token = create_access_token("admin")
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=86400,
    )
    return {"message": "Admin user created", "username": "admin"}


@router.post("/login")
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    """Authenticate and set JWT cookie. If TOTP is enabled, requires totp_code."""
    result = await db.execute(
        select(AdminUserModel).where(AdminUserModel.username == body.username)
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    # Check TOTP if enabled
    if user.totp_enabled:
        if not body.totp_code:
            # Tell the frontend that 2FA is required
            return {"requires_totp": True, "message": "2FA code required"}
        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(body.totp_code, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid 2FA code")

    token = create_access_token(user.username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=86400,
    )
    return {"message": "Login successful", "username": user.username}


@router.post("/logout")
async def logout(response: Response):
    """Clear the auth cookie."""
    response.delete_cookie(key=COOKIE_NAME)
    return {"message": "Logged out"}


@router.get("/me")
async def get_me(user: AdminUserModel = Depends(get_current_user)):
    """Return current user info. 401 if not authenticated."""
    return {"username": user.username, "totp_enabled": user.totp_enabled}


# ─── Password Management ─────────────────────────────────────────────────────


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    response: Response,
    user: AdminUserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change the admin password. Requires current authentication."""
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user.password_hash = hash_password(body.password)
    await db.commit()

    # Issue a fresh token
    token = create_access_token(user.username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=86400,
    )
    return {"message": "Password changed"}


@router.post("/generate-reset-token")
async def generate_reset_token(user: AdminUserModel = Depends(get_current_user)):
    """Generate a password reset token and write it to disk.

    The user can also generate this manually on the server:
        docker exec <container> cat /app/data/.password_reset_token
    Or create one:
        docker exec <container> python -c "import secrets; print(secrets.token_urlsafe(32))" > /app/data/.password_reset_token
    """
    token = secrets.token_urlsafe(32)
    _RESET_TOKEN_PATH.write_text(token)
    return {"message": "Reset token written to server", "token": token}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, response: Response, db: AsyncSession = Depends(get_db)):
    """Reset password using a filesystem token. No auth required.

    The reset token file is created either via the API (while logged in)
    or manually on the server filesystem. This is the recovery path for
    users who forget their password.
    """
    if not _RESET_TOKEN_PATH.exists():
        raise HTTPException(status_code=400, detail="No reset token found. Generate one on the server.")

    stored_token = _RESET_TOKEN_PATH.read_text().strip()
    if not secrets.compare_digest(body.reset_token, stored_token):
        raise HTTPException(status_code=401, detail="Invalid reset token")

    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    result = await db.execute(select(AdminUserModel).where(AdminUserModel.username == "admin"))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="No admin user found")

    user.password_hash = hash_password(body.new_password)
    await db.commit()

    # Delete the token so it can't be reused
    _RESET_TOKEN_PATH.unlink(missing_ok=True)

    # Auto-login after reset
    token = create_access_token(user.username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=86400,
    )
    return {"message": "Password reset successful"}


# ─── TOTP 2FA ─────────────────────────────────────────────────────────────────


@router.post("/totp/setup")
async def totp_setup(user: AdminUserModel = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Generate a new TOTP secret and return it as a QR code (base64 PNG).

    Does not enable TOTP yet. The user must verify a code first via /totp/verify.
    """
    secret = pyotp.random_base32()
    user.totp_secret = secret
    await db.commit()

    # Build the provisioning URI for authenticator apps
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name="admin", issuer_name="QuietKeep")

    # Generate QR code as base64 PNG
    img = qrcode.make(uri)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    qr_b64 = base64.b64encode(buffer.getvalue()).decode()

    return {
        "secret": secret,
        "qr_code": f"data:image/png;base64,{qr_b64}",
        "uri": uri,
    }


@router.post("/totp/verify")
async def totp_verify(
    body: TOTPVerifyRequest,
    user: AdminUserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verify a TOTP code and enable 2FA if valid."""
    if not user.totp_secret:
        raise HTTPException(status_code=400, detail="Run /totp/setup first")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid code. Try again.")

    user.totp_enabled = True
    await db.commit()
    return {"message": "2FA enabled", "totp_enabled": True}


@router.post("/totp/disable")
async def totp_disable(
    body: TOTPVerifyRequest,
    user: AdminUserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Disable 2FA. Requires a valid TOTP code to confirm."""
    if not user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA is not enabled")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid code")

    user.totp_enabled = False
    user.totp_secret = None
    await db.commit()
    return {"message": "2FA disabled", "totp_enabled": False}
