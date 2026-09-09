from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EssayQuestion, SubExperience, TimelineEntry, User
from app.schemas import DashboardSummary
from app.security import get_current_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def get_summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    timeline_count = (
        db.query(func.count(TimelineEntry.id)).filter(TimelineEntry.user_id == current_user.id).scalar()
    )
    experience_count = (
        db.query(func.count(SubExperience.id))
        .join(TimelineEntry, SubExperience.timeline_entry_id == TimelineEntry.id)
        .filter(TimelineEntry.user_id == current_user.id)
        .scalar()
    )
    essay_question_count = (
        db.query(func.count(EssayQuestion.id)).filter(EssayQuestion.user_id == current_user.id).scalar()
    )
    return DashboardSummary(
        timeline_count=timeline_count or 0,
        experience_count=experience_count or 0,
        essay_question_count=essay_question_count or 0,
    )
