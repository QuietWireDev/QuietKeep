# QuietKeep: routers/tags.py
# CRUD endpoints for host tags/groups.
# Author: QuietWire (Dennis Ayotte)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import HostModel, TagCreate, TagModel, TagResponse, TagUpdate, host_tags

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[TagResponse])
async def list_tags(db: AsyncSession = Depends(get_db)):
    """List all tags."""
    result = await db.execute(select(TagModel).order_by(TagModel.name))
    return result.scalars().all()


@router.post("", response_model=TagResponse, status_code=201)
async def create_tag(body: TagCreate, db: AsyncSession = Depends(get_db)):
    """Create a new tag."""
    existing = await db.execute(select(TagModel).where(TagModel.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Tag already exists")
    tag = TagModel(name=body.name, color=body.color)
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.put("/{tag_id}", response_model=TagResponse)
async def update_tag(tag_id: int, body: TagUpdate, db: AsyncSession = Depends(get_db)):
    """Update a tag's name or color."""
    result = await db.execute(select(TagModel).where(TagModel.id == tag_id))
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    if body.name is not None:
        tag.name = body.name
    if body.color is not None:
        tag.color = body.color
    await db.commit()
    await db.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=204)
async def delete_tag(tag_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a tag (removes from all hosts)."""
    result = await db.execute(select(TagModel).where(TagModel.id == tag_id))
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    await db.delete(tag)
    await db.commit()


@router.post("/{tag_id}/hosts/{host_id}", status_code=204)
async def assign_tag(tag_id: int, host_id: int, db: AsyncSession = Depends(get_db)):
    """Assign a tag to a host."""
    tag = await db.execute(select(TagModel).where(TagModel.id == tag_id))
    tag = tag.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    host = await db.execute(
        select(HostModel).options(selectinload(HostModel.tags)).where(HostModel.id == host_id)
    )
    host = host.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    if tag not in host.tags:
        host.tags.append(tag)
        await db.commit()


@router.delete("/{tag_id}/hosts/{host_id}", status_code=204)
async def remove_tag(tag_id: int, host_id: int, db: AsyncSession = Depends(get_db)):
    """Remove a tag from a host."""
    tag = await db.execute(select(TagModel).where(TagModel.id == tag_id))
    tag = tag.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    host = await db.execute(
        select(HostModel).options(selectinload(HostModel.tags)).where(HostModel.id == host_id)
    )
    host = host.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    if tag in host.tags:
        host.tags.remove(tag)
        await db.commit()
