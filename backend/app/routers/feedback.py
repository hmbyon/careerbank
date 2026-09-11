"""User feedback submission + an admin-only view over everything submitted."""
import os

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Feedback, User
from app.schemas import AdminUserOut, FeedbackCreate, FeedbackOut, FeedbackStatusUpdate
from app.security import get_current_user

router = APIRouter(prefix="/feedback", tags=["feedback"])

# Who can read and triage feedback. Configurable so the address never has to be
# hardcoded in a commit; the default matches the project owner.
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "hmbyon97@naver.com").strip().lower()


def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    """403 for a signed-in non-admin (401 already handled by get_current_user)."""
    if (current_user.email or "").strip().lower() != ADMIN_EMAIL:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return current_user


def _to_out(fb: Feedback) -> FeedbackOut:
    out = FeedbackOut.model_validate(fb)
    out.user_email = fb.user.email if fb.user else None
    return out


@router.post("", response_model=FeedbackOut, status_code=status.HTTP_201_CREATED)
def create_feedback(
    payload: FeedbackCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Any signed-in user can submit."""
    fb = Feedback(
        user_id=current_user.id,
        category=payload.category,
        content=payload.content,
        page_path=payload.page_path,
    )
    db.add(fb)
    db.commit()
    db.refresh(fb)
    return _to_out(fb)


@router.get("", response_model=list[FeedbackOut])
def list_feedback(
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Feedback)
        .options(joinedload(Feedback.user))
        # created_at is second-resolution, so id breaks ties deterministically.
        .order_by(Feedback.created_at.desc(), Feedback.id.desc())
        .all()
    )
    return [_to_out(fb) for fb in rows]


@router.put("/{feedback_id}", response_model=FeedbackOut)
def update_feedback_status(
    feedback_id: int,
    payload: FeedbackStatusUpdate,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    fb = db.get(Feedback, feedback_id)
    if fb is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")
    fb.status = payload.status
    db.commit()
    db.refresh(fb)
    return _to_out(fb)
