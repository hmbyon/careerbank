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
    TimelineItemUpdate,
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


@router.delete("/{timeline_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_timeline(
    timeline_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Deletes the timeline and, by relationship cascade, its items, the
    sub-experiences recorded under it, and those experiences' matches."""
    entry = _get_owned_timeline(timeline_id, current_user, db)
    db.delete(entry)
    db.commit()
    return None


def _get_owned_item(
    timeline_id: int, item_id: int, current_user: User, db: Session
) -> TimelineItem:
    entry = _get_owned_timeline(timeline_id, current_user, db)
    item = db.get(TimelineItem, item_id)
    if item is None or item.timeline_entry_id != entry.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Timeline item not found")
    return item


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



@router.put("/{timeline_id}/items/{item_id}", response_model=TimelineItemOut)
def update_timeline_item(
    timeline_id: int,
    item_id: int,
    payload: TimelineItemUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _get_owned_item(timeline_id, item_id, current_user, db)
    item.title = payload.title
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{timeline_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_timeline_item(
    timeline_id: int,
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cascades to the sub-experiences recorded under this item (and their matches).
    Experiences attached to the timeline but not to any item are untouched."""
    item = _get_owned_item(timeline_id, item_id, current_user, db)
    db.delete(item)
    db.commit()
    return None
