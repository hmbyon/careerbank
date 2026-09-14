"""Free-form cover letters: no question, just company info. Experiences are chosen
and the draft is written by AI on create and on regenerate."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import (
    FreeEssay,
    FreeEssayExperience,
    FreeEssayStatus,
    SubExperience,
    TimelineEntry,
    User,
)
from app.schemas import (
    FreeEssayCreate,
    FreeEssayDetail,
    FreeEssayOut,
    FreeEssayUpdate,
    FreeEssayUsedExperience,
)
from app.security import get_current_user
from app.services.gemini import (
    free_essay_experience_count,
    generate_free_essay_draft,
    select_experiences_for_free_essay,
)
from app.services.matching import experience_summary

router = APIRouter(prefix="/free-essays", tags=["free-essays"])

NO_EXPERIENCE_DETAIL = "저장된 경험이 없어요. 타임라인에서 인터뷰로 경험을 먼저 등록해주세요."

# Why the draft came out the way it did, in the user's words.
_GENERATION_WARNINGS = {
    "no_ai": "AI 키가 없어 선택된 경험을 이어 붙인 기본 초안이에요. 내용을 다듬어서 사용해주세요.",
    "timeout": "AI 초안 생성이 시간 안에 끝나지 않았어요. 잠시 후 '다시 생성'을 눌러주세요.",
    "error": "AI 초안 생성에 실패했어요. 잠시 후 '다시 생성'을 눌러주세요.",
}


def _get_owned_free_essay(free_essay_id: int, current_user: User, db: Session) -> FreeEssay:
    fe = db.get(FreeEssay, free_essay_id)
    if fe is None or fe.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Free essay not found")
    return fe


def _user_experiences(current_user: User, db: Session) -> list[SubExperience]:
    return (
        db.query(SubExperience)
        .join(TimelineEntry, SubExperience.timeline_entry_id == TimelineEntry.id)
        .options(joinedload(SubExperience.timeline_entry), joinedload(SubExperience.timeline_item))
        .filter(TimelineEntry.user_id == current_user.id)
        .order_by(SubExperience.created_at.asc(), SubExperience.id.asc())
        .all()
    )


def _experience_title(exp: SubExperience) -> str:
    title = exp.timeline_entry.title if exp.timeline_entry else ""
    if exp.timeline_item:
        title = f"{title} > {exp.timeline_item.title}" if title else exp.timeline_item.title
    return title


def _compose(
    company: str,
    position: Optional[str],
    job_description: Optional[str],
    char_limit: Optional[int],
    experiences: list[SubExperience],
) -> tuple[Optional[str], Optional[str], list[SubExperience]]:
    """Pick experiences and write the draft. No DB writes, so no lock is held while
    the AI calls run (matters for the local SQLite file)."""
    count = free_essay_experience_count(len(experiences), char_limit)
    summaries = [experience_summary(e) for e in experiences]
    picked = select_experiences_for_free_essay(company, position, job_description, summaries, count)
    chosen = [experiences[i] for i in picked]
    text, reason = generate_free_essay_draft(
        company,
        position,
        job_description,
        char_limit,
        [
            {
                "title": _experience_title(e),
                "situation": e.situation,
                "action": e.action,
                "result": e.result,
                "answer": e.answer,
            }
            for e in chosen
        ],
    )
    return text, reason, chosen


def _apply_generation(
    fe: FreeEssay,
    text: Optional[str],
    reason: Optional[str],
    chosen: list[SubExperience],
    db: Session,
) -> Optional[str]:
    """Store the result on the essay; returns the warning to show, if any."""
    if text is None:
        # Keep whatever draft (and experience list) was there before.
        fe.status = FreeEssayStatus.FAILED
        return _GENERATION_WARNINGS.get(reason or "error", _GENERATION_WARNINGS["error"])

    fe.draft_text = text
    fe.status = FreeEssayStatus.COMPLETED
    # Delete-then-insert explicitly: letting the ORM reorder these could insert a
    # re-chosen experience before its old row is gone and trip the unique pair.
    db.query(FreeEssayExperience).filter(FreeEssayExperience.free_essay_id == fe.id).delete(
        synchronize_session=False
    )
    db.flush()
    for rank, exp in enumerate(chosen):
        db.add(FreeEssayExperience(free_essay_id=fe.id, sub_experience_id=exp.id, rank=rank))
    return _GENERATION_WARNINGS.get(reason) if reason else None


def _base_fields(fe: FreeEssay, used_count: int) -> dict:
    return dict(
        id=fe.id,
        user_id=fe.user_id,
        company=fe.company,
        position=fe.position,
        job_description=fe.job_description,
        char_limit=fe.char_limit,
        draft_text=fe.draft_text,
        status=fe.status,
        created_at=fe.created_at,
        updated_at=fe.updated_at,
        used_experience_count=used_count,
    )


def _detail(fe: FreeEssay, db: Session, warning: Optional[str] = None) -> FreeEssayDetail:
    rows = (
        db.query(FreeEssayExperience)
        .options(
            joinedload(FreeEssayExperience.sub_experience).joinedload(SubExperience.timeline_entry),
            joinedload(FreeEssayExperience.sub_experience).joinedload(SubExperience.timeline_item),
        )
        .filter(FreeEssayExperience.free_essay_id == fe.id)
        .order_by(FreeEssayExperience.rank.asc())
        .all()
    )
    used = [
        FreeEssayUsedExperience(
            sub_experience_id=row.sub_experience.id,
            category=row.sub_experience.category,
            title=_experience_title(row.sub_experience),
            trigger_question=row.sub_experience.trigger_question,
        )
        # A deleted experience can leave a row behind where FKs aren't enforced (SQLite).
        for row in rows
        if row.sub_experience is not None
    ]
    return FreeEssayDetail(**_base_fields(fe, len(used)), used_experiences=used, warning=warning)


@router.get("", response_model=list[FreeEssayOut])
def list_free_essays(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    essays = (
        db.query(FreeEssay)
        .filter(FreeEssay.user_id == current_user.id)
        .order_by(FreeEssay.created_at.desc(), FreeEssay.id.desc())
        .all()
    )
    counts = dict(
        db.query(FreeEssayExperience.free_essay_id, func.count(FreeEssayExperience.id))
        .join(SubExperience, FreeEssayExperience.sub_experience_id == SubExperience.id)
        .filter(FreeEssayExperience.free_essay_id.in_([fe.id for fe in essays] or [-1]))
        .group_by(FreeEssayExperience.free_essay_id)
        .all()
    )
    return [FreeEssayOut(**_base_fields(fe, counts.get(fe.id, 0))) for fe in essays]


@router.post("", response_model=FreeEssayDetail, status_code=status.HTTP_201_CREATED)
def create_free_essay(
    payload: FreeEssayCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    experiences = _user_experiences(current_user, db)
    if not experiences:
        # Nothing to write from: don't create a row or spend an AI call.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=NO_EXPERIENCE_DETAIL)

    text, reason, chosen = _compose(
        payload.company, payload.position, payload.job_description, payload.char_limit, experiences
    )

    fe = FreeEssay(
        user_id=current_user.id,
        company=payload.company,
        position=payload.position,
        job_description=payload.job_description,
        char_limit=payload.char_limit,
    )
    db.add(fe)
    db.flush()
    warning = _apply_generation(fe, text, reason, chosen, db)
    db.commit()
    db.refresh(fe)
    return _detail(fe, db, warning)


@router.get("/{free_essay_id}", response_model=FreeEssayDetail)
def get_free_essay(
    free_essay_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    fe = _get_owned_free_essay(free_essay_id, current_user, db)
    return _detail(fe, db)


@router.put("/{free_essay_id}", response_model=FreeEssayDetail)
def update_free_essay(
    free_essay_id: int,
    payload: FreeEssayUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Inputs only. The existing draft stays until the user regenerates."""
    fe = _get_owned_free_essay(free_essay_id, current_user, db)
    fe.company = payload.company
    fe.position = payload.position
    fe.job_description = payload.job_description
    fe.char_limit = payload.char_limit
    db.commit()
    db.refresh(fe)
    return _detail(fe, db)


@router.delete("/{free_essay_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_free_essay(
    free_essay_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    fe = _get_owned_free_essay(free_essay_id, current_user, db)
    db.delete(fe)  # cascades to its used-experience rows
    db.commit()
    return None


@router.post("/{free_essay_id}/regenerate", response_model=FreeEssayDetail)
def regenerate_free_essay(
    free_essay_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-pick experiences and rewrite the draft from the saved inputs."""
    fe = _get_owned_free_essay(free_essay_id, current_user, db)
    experiences = _user_experiences(current_user, db)
    if not experiences:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=NO_EXPERIENCE_DETAIL)

    text, reason, chosen = _compose(fe.company, fe.position, fe.job_description, fe.char_limit, experiences)
    warning = _apply_generation(fe, text, reason, chosen, db)
    db.commit()
    db.refresh(fe)
    return _detail(fe, db, warning)
