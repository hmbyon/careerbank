from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SubExperience, TimelineEntry, TimelineItem, User
from app.schemas import InterviewAnswerRequest, InterviewAnswerResponse, InterviewQuestionOut, SubExperienceOut
from app.security import get_current_user
from app.services.gemini import decompose_star, generate_interview_question

router = APIRouter(prefix="/interview", tags=["interview"])


def _get_owned_context(
    timeline_id: int, item_id: Optional[int], current_user: User, db: Session
) -> tuple[TimelineEntry, Optional[TimelineItem]]:
    entry = db.get(TimelineEntry, timeline_id)
    if entry is None or entry.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Timeline not found")

    item = None
    if item_id is not None:
        item = db.get(TimelineItem, item_id)
        if item is None or item.timeline_entry_id != entry.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Timeline item not found")

    return entry, item


def _used_categories(timeline_id: int, item_id: Optional[int], db: Session) -> list[str]:
    query = db.query(SubExperience.category).filter(SubExperience.timeline_entry_id == timeline_id)
    if item_id is None:
        query = query.filter(SubExperience.timeline_item_id.is_(None))
    else:
        query = query.filter(SubExperience.timeline_item_id == item_id)
    return [c.value if hasattr(c, "value") else c for (c,) in query.all()]


def _parse_skip_categories(raw: Optional[str]) -> list[str]:
    """"LEADERSHIP,CREATIVITY" -> ["LEADERSHIP", "CREATIVITY"].

    Values the client made up are harmless: the generator picks from a fixed
    category list, so anything unrecognised simply never matches.
    """
    if not raw:
        return []
    return [part.strip().upper() for part in raw.split(",") if part.strip()]


def _next_question(
    entry: TimelineEntry,
    item: Optional[TimelineItem],
    db: Session,
    skip_categories: Optional[list[str]] = None,
) -> InterviewQuestionOut:
    # Skipped categories are session-only: they come from the client, are merged
    # in just for this pick, and are never written to the DB.
    used = _used_categories(entry.id, item.id if item else None, db)
    if skip_categories:
        used = list(dict.fromkeys(used + skip_categories))
    result = generate_interview_question(
        timeline_category=entry.category.value,
        timeline_title=entry.title,
        item_title=item.title if item else None,
        used_categories=used,
    )
    return InterviewQuestionOut(category=result["category"], question=result["question"])


@router.get("/question", response_model=InterviewQuestionOut)
def get_interview_question(
    timeline_id: int = Query(...),
    item_id: Optional[int] = Query(default=None),
    skip_categories: Optional[str] = Query(
        default=None,
        description="쉼표로 구분한 카테고리 목록. 이번 인터뷰에서 건너뛴 질문을 다시 받지 않기 위해 사용합니다.",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry, item = _get_owned_context(timeline_id, item_id, current_user, db)
    return _next_question(entry, item, db, _parse_skip_categories(skip_categories))


@router.post("/answer", response_model=InterviewAnswerResponse, status_code=status.HTTP_201_CREATED)
def post_interview_answer(
    payload: InterviewAnswerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry, item = _get_owned_context(payload.timeline_id, payload.item_id, current_user, db)

    # Pre-fill S/A/R from the answer so the experience detail page starts filled in.
    # Purely additive: None (AI off or unusable response) stores the answer exactly
    # as before, with the three fields left empty for the user to write themselves.
    star = decompose_star(payload.answer, payload.trigger_question)

    sub_exp = SubExperience(
        timeline_entry_id=entry.id,
        timeline_item_id=item.id if item else None,
        category=payload.category,
        trigger_question=payload.trigger_question,
        answer=payload.answer,
        situation=star["situation"] if star else None,
        action=star["action"] if star else None,
        result=star["result"] if star else None,
    )
    db.add(sub_exp)
    db.commit()
    db.refresh(sub_exp)

    next_q = _next_question(entry, item, db)
    next_q_out = None if next_q.category is None else next_q

    return InterviewAnswerResponse(
        saved=SubExperienceOut.model_validate(sub_exp),
        next_question=next_q_out,
    )
