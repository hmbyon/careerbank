from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import EssayQuestion, Match, SubExperience, TimelineEntry, User
from app.schemas import (
    DraftUpdateRequest,
    EssayQuestionCreate,
    EssayQuestionCreateResponse,
    EssayQuestionListItem,
    EssayQuestionOut,
    MatchOut,
    SubExperienceOut,
)
from app.security import get_current_user
from app.services.gemini import generate_draft
from app.services.matching import score_experiences

router = APIRouter(tags=["essay-questions"])


def _get_owned_essay_question(essay_question_id: int, current_user: User, db: Session) -> EssayQuestion:
    eq = db.get(EssayQuestion, essay_question_id)
    if eq is None or eq.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Essay question not found")
    return eq


def _run_matching(eq: EssayQuestion, current_user: User, db: Session) -> None:
    """Score all of the user's experiences against this essay question and create Match rows
    (skip pairs that already have a Match, respecting the unique constraint)."""
    experiences = (
        db.query(SubExperience)
        .join(TimelineEntry, SubExperience.timeline_entry_id == TimelineEntry.id)
        .filter(TimelineEntry.user_id == current_user.id)
        .all()
    )
    if not experiences:
        return

    existing_pairs = {
        sub_exp_id
        for (sub_exp_id,) in db.query(Match.sub_experience_id).filter(Match.essay_question_id == eq.id).all()
    }
    to_score = [e for e in experiences if e.id not in existing_pairs]
    if not to_score:
        return

    scores = score_experiences(eq.question_text, eq.company, eq.position, to_score)
    for exp, score in zip(to_score, scores):
        db.add(
            Match(
                sub_experience_id=exp.id,
                essay_question_id=eq.id,
                relevance_score=score,
                confirmed=False,
            )
        )
    db.commit()


@router.get("/essay-questions", response_model=list[EssayQuestionListItem])
def list_essay_questions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    questions = (
        db.query(EssayQuestion)
        .filter(EssayQuestion.user_id == current_user.id)
        .order_by(EssayQuestion.created_at.desc())
        .all()
    )
    result = []
    for q in questions:
        status_label = "매칭완료" if q.draft_text else "매칭대기"
        result.append(
            EssayQuestionListItem(
                id=q.id,
                user_id=q.user_id,
                question_text=q.question_text,
                char_limit=q.char_limit,
                company=q.company,
                position=q.position,
                draft_text=q.draft_text,
                created_at=q.created_at,
                updated_at=q.updated_at,
                status=status_label,
            )
        )
    return result


@router.post("/essay-questions", response_model=EssayQuestionCreateResponse, status_code=status.HTTP_201_CREATED)
def create_essay_question(
    payload: EssayQuestionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    duplicate = (
        db.query(EssayQuestion)
        .filter(
            EssayQuestion.user_id == current_user.id,
            EssayQuestion.question_text == payload.question_text,
        )
        .first()
    )

    eq = EssayQuestion(
        user_id=current_user.id,
        question_text=payload.question_text,
        char_limit=payload.char_limit,
        company=payload.company,
        position=payload.position,
    )
    db.add(eq)
    db.commit()
    db.refresh(eq)

    # Immediately run matching (see spec section 2 / 3b).
    _run_matching(eq, current_user, db)

    warning = "동일한 문항이 이미 등록되어 있습니다." if duplicate else None
    return EssayQuestionCreateResponse(
        id=eq.id,
        user_id=eq.user_id,
        question_text=eq.question_text,
        char_limit=eq.char_limit,
        company=eq.company,
        position=eq.position,
        draft_text=eq.draft_text,
        created_at=eq.created_at,
        updated_at=eq.updated_at,
        warning=warning,
    )


@router.get("/essay-questions/{essay_question_id}/matches", response_model=list[MatchOut])
def get_matches(
    essay_question_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    eq = _get_owned_essay_question(essay_question_id, current_user, db)

    existing_count = db.query(Match).filter(Match.essay_question_id == eq.id).count()
    if existing_count == 0:
        _run_matching(eq, current_user, db)

    matches = (
        db.query(Match)
        .options(joinedload(Match.sub_experience))
        .filter(Match.essay_question_id == eq.id)
        .order_by(Match.relevance_score.desc())
        .all()
    )
    return [
        MatchOut(
            match_id=m.id,
            sub_experience=SubExperienceOut.model_validate(m.sub_experience),
            relevance_score=float(m.relevance_score),
            confirmed=m.confirmed,
        )
        for m in matches
    ]


@router.post("/essay-questions/{essay_question_id}/draft", response_model=EssayQuestionOut)
def generate_essay_draft(
    essay_question_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    eq = _get_owned_essay_question(essay_question_id, current_user, db)

    confirmed_matches = (
        db.query(Match)
        .options(joinedload(Match.sub_experience))
        .filter(Match.essay_question_id == eq.id, Match.confirmed.is_(True))
        .all()
    )
    if not confirmed_matches:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No confirmed matches to draft from")

    experiences = [
        {
            "situation": m.sub_experience.situation,
            "action": m.sub_experience.action,
            "result": m.sub_experience.result,
        }
        for m in confirmed_matches
    ]

    draft = generate_draft(eq.question_text, eq.company, eq.position, eq.char_limit, experiences)
    eq.draft_text = draft
    db.commit()
    db.refresh(eq)

    return eq


@router.put("/essay-questions/{essay_question_id}/draft", response_model=EssayQuestionOut)
def update_essay_draft(
    essay_question_id: int,
    payload: DraftUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    eq = _get_owned_essay_question(essay_question_id, current_user, db)
    eq.draft_text = payload.draft_text
    db.commit()
    db.refresh(eq)

    return eq
