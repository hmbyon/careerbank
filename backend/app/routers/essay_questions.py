from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Application, EssayQuestion, Match, SubExperience, TimelineEntry, User
from app.schemas import (
    DraftUpdateRequest,
    EssayQuestionCreate,
    EssayQuestionCreateResponse,
    EssayQuestionListItem,
    EssayQuestionOut,
    EssayQuestionUpdate,
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


def _application_context(eq: EssayQuestion) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """(company, position, job_description) for prompts, read from the question's application."""
    application = eq.application
    if application is None:
        return None, None, None
    return application.company, application.position, application.job_description


def question_list_item(eq: EssayQuestion) -> EssayQuestionListItem:
    status_label = "매칭완료" if eq.draft_text else "매칭대기"
    return EssayQuestionListItem(**EssayQuestionOut.model_validate(eq).model_dump(), status=status_label)


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

    company, position, job_description = _application_context(eq)
    scores = score_experiences(eq.question_text, company, position, to_score, job_description=job_description)
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
        .options(joinedload(EssayQuestion.application))
        .filter(EssayQuestion.user_id == current_user.id)
        .order_by(EssayQuestion.created_at.desc())
        .all()
    )
    return [question_list_item(q) for q in questions]


@router.post("/essay-questions", response_model=EssayQuestionCreateResponse, status_code=status.HTTP_201_CREATED)
def create_essay_question(
    payload: EssayQuestionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    application = db.get(Application, payload.application_id)
    if application is None or application.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

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
        application_id=application.id,
        question_text=payload.question_text,
        char_limit=payload.char_limit,
    )
    db.add(eq)
    db.commit()
    db.refresh(eq)

    # Immediately run matching (see spec section 2 / 3b).
    _run_matching(eq, current_user, db)

    warning = "동일한 문항이 이미 등록되어 있습니다." if duplicate else None
    return EssayQuestionCreateResponse(**EssayQuestionOut.model_validate(eq).model_dump(), warning=warning)


@router.get("/essay-questions/{essay_question_id}", response_model=EssayQuestionListItem)
def get_essay_question(
    essay_question_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return question_list_item(_get_owned_essay_question(essay_question_id, current_user, db))


@router.put("/essay-questions/{essay_question_id}", response_model=EssayQuestionOut)
def update_essay_question(
    essay_question_id: int,
    payload: EssayQuestionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    eq = _get_owned_essay_question(essay_question_id, current_user, db)

    # Scores were computed against the old wording, so they stop meaning anything
    # once the question itself changes - drop them and let the next view rematch.
    # A char_limit-only edit keeps its matches, including whatever the user had
    # already confirmed. Job description changes are handled per application.
    question_changed = eq.question_text != payload.question_text

    eq.question_text = payload.question_text
    eq.char_limit = payload.char_limit

    if question_changed:
        db.query(Match).filter(Match.essay_question_id == eq.id).delete(synchronize_session=False)

    db.commit()
    db.refresh(eq)
    return eq


@router.delete("/essay-questions/{essay_question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_essay_question(
    essay_question_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    eq = _get_owned_essay_question(essay_question_id, current_user, db)
    db.delete(eq)  # cascades to this question's matches (relationship cascade)
    db.commit()
    return None


def _matches_out(eq: EssayQuestion, db: Session) -> list[MatchOut]:
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

    return _matches_out(eq, db)


@router.post("/essay-questions/{essay_question_id}/rematch", response_model=list[MatchOut])
def rematch(
    essay_question_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Throw away this question's matches and score every experience again.

    Matching normally runs once, on first view, so a question created before
    GEMINI_API_KEY was set would keep its heuristic scores forever. Only this
    question's Match rows are touched - its draft_text and every other question
    are left alone - and `confirmed` flags are lost with the rows they sat on,
    which is why the UI confirms before calling this.
    """
    eq = _get_owned_essay_question(essay_question_id, current_user, db)

    db.query(Match).filter(Match.essay_question_id == eq.id).delete(synchronize_session=False)
    db.commit()

    _run_matching(eq, current_user, db)
    return _matches_out(eq, db)


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

    company, position, job_description = _application_context(eq)
    draft = generate_draft(
        eq.question_text,
        company,
        position,
        eq.char_limit,
        experiences,
        job_description=job_description,
    )
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
