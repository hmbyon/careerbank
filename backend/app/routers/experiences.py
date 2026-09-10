from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import ExperienceCategory, SubExperience, TimelineEntry, User
from app.schemas import SubExperienceOut, SubExperienceUpdate
from app.security import get_current_user

router = APIRouter(prefix="/experiences", tags=["experiences"])


def _get_owned_experience(experience_id: int, current_user: User, db: Session) -> SubExperience:
    exp = (
        db.query(SubExperience)
        .join(TimelineEntry, SubExperience.timeline_entry_id == TimelineEntry.id)
        .filter(SubExperience.id == experience_id, TimelineEntry.user_id == current_user.id)
        .first()
    )
    if exp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experience not found")
    return exp


@router.get("", response_model=list[SubExperienceOut])
def list_experiences(
    category: Optional[ExperienceCategory] = Query(default=None),
    timeline_entry_id: Optional[int] = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = (
        db.query(SubExperience)
        .join(TimelineEntry, SubExperience.timeline_entry_id == TimelineEntry.id)
        .options(joinedload(SubExperience.timeline_entry))
        .filter(TimelineEntry.user_id == current_user.id)
    )
    # Both filters are independent and combine with AND. An unknown or someone
    # else's timeline id simply yields nothing, since the user filter still applies.
    if category is not None:
        query = query.filter(SubExperience.category == category)
    if timeline_entry_id is not None:
        query = query.filter(SubExperience.timeline_entry_id == timeline_entry_id)
    experiences = query.order_by(SubExperience.created_at.desc()).all()
    return experiences


@router.put("/{experience_id}", response_model=SubExperienceOut)
def update_experience(
    experience_id: int,
    payload: SubExperienceUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exp = _get_owned_experience(experience_id, current_user, db)
    exp.category = payload.category
    exp.situation = payload.situation
    exp.action = payload.action
    exp.result = payload.result
    if payload.answer is not None:
        exp.answer = payload.answer
    db.commit()
    db.refresh(exp)
    return exp


@router.delete("/{experience_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_experience(
    experience_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exp = _get_owned_experience(experience_id, current_user, db)
    db.delete(exp)  # cascades to delete dependent matches (relationship cascade)
    db.commit()
    return None
