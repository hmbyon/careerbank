from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import EssayQuestion, Match, User
from app.schemas import MatchRecordOut
from app.security import get_current_user

router = APIRouter(prefix="/matches", tags=["matches"])


@router.put("/{match_id}/confirm", response_model=MatchRecordOut)
def confirm_match(
    match_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    match = (
        db.query(Match)
        .join(EssayQuestion, Match.essay_question_id == EssayQuestion.id)
        .filter(Match.id == match_id, EssayQuestion.user_id == current_user.id)
        .first()
    )
    if match is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")

    match.confirmed = True
    db.commit()
    db.refresh(match)
    return match
