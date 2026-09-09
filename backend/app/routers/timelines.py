from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TimelineEntry, TimelineItem, User
from app.schemas import (
    TimelineEntryCreate,
    TimelineEntryOut,
    TimelineEntryUpdate,
    TimelineItemCreate,
    TimelineItemOut,
)
from app.security import get_current_user

router = APIRouter(prefix="/timelines", tags=["timelines"])


def _get_owned_timeline(timeline_id: int, current_user: User, db: Session) -> TimelineEntry:
    entry = db.get(TimelineEntry, timeline_id)
    if entry is None or entry.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Timeline not found")
    return entry


@router.get("", response_model=list[TimelineEntryOut])
def list_timelines(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Flat list with category field; newest first within category.
    # Order by category, then created_at desc — frontend groups by category.
    entries = (
        db.query(TimelineEntry)
        .filter(TimelineEntry.user_id == current_user.id)
        .order_by(TimelineEntry.category.asc(), TimelineEntry.created_at.desc())
        .all()
    )
    return entries


@router.post("", response_model=TimelineEntryOut, status_code=status.HTTP_201_CREATED)
def create_timeline(
    payload: TimelineEntryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = TimelineEntry(
        user_id=current_user.id,
        category=payload.category,
        title=payload.title,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/{timeline_id}", response_model=TimelineEntryOut)
def update_timeline(
    timeline_id: int,
    payload: TimelineEntryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = _get_owned_timeline(timeline_id, current_user, db)
    entry.category = payload.category
    entry.title = payload.title
    entry.start_date = payload.start_date
    entry.end_date = payload.end_date
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/{timeline_id}/items", response_model=list[TimelineItemOut])
def list_timeline_items(
    timeline_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = _get_owned_timeline(timeline_id, current_user, db)
    items = (
        db.query(TimelineItem)
        .filter(TimelineItem.timeline_entry_id == entry.id)
        .order_by(TimelineItem.created_at.asc())
        .all()
    )
    return items


@router.post("/{timeline_id}/items", response_model=TimelineItemOut, status_code=status.HTTP_201_CREATED)
def create_timeline_item(
    timeline_id: int,
    payload: TimelineItemCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = _get_owned_timeline(timeline_id, current_user, db)
    item = TimelineItem(timeline_entry_id=entry.id, title=payload.title)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item
