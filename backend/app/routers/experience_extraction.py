"""Experience candidates from an uploaded report / slide deck (PDF, PPTX, DOCX).

Two steps on purpose: /analyze only reads the file and returns candidates - it
takes no database session and writes nothing. The user picks and edits
candidates on the preview screen, and /save stores exactly those.
"""
import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityCategory, ExperienceCategory, SubExperience, TimelineEntry, TimelineItem, User
from app.schemas import (
    ExperienceCandidate,
    ExperienceExtractionOut,
    ExperienceSaveOut,
    ExperienceSaveRequest,
    ExperienceSaveResult,
    ExtractionTargetTimeline,
    TimelineItemOut,
)
from app.security import get_current_user
from app.services.document_text import extract_docx_text, extract_pdf_text, extract_pptx_text
from app.services.gemini import EXPERIENCE_EXTRACTION_TEXT_LIMIT, extract_experience_candidates

logger = logging.getLogger("careerbank.experience_extraction")

router = APIRouter(prefix="/experience-extraction", tags=["experience-extraction"])

# Same upload ceiling as resume import.
_MAX_BYTES = 10 * 1024 * 1024
_ITEM_TITLE_MAX = 30  # timeline_items.title
_TIMELINE_TITLE_MAX = 50  # timeline_entries.title
_STAR_MAX = 5000
_TRIGGER_MAX = 500  # sub_experiences.trigger_question
# Fewer non-space characters than this is page numbers or a stray caption - in
# practice a scanned or image-only document.
_MIN_TEXT_CHARS = 20

_EXTRACTORS = {"pdf": extract_pdf_text, "pptx": extract_pptx_text, "docx": extract_docx_text}

_NO_TEXT_DETAIL = {
    "pdf": (
        "파일에서 글자를 찾지 못했어요. 스캔 이미지 PDF는 인식할 수 없어요. "
        "글자를 드래그해 선택할 수 있는 PDF나 원본 파일(PPTX/DOCX)로 올려주세요."
    ),
    "pptx": "슬라이드에서 글자를 찾지 못했어요. 이미지로만 된 슬라이드는 인식할 수 없어요.",
    "docx": "문서에서 글자를 찾지 못했어요. 이미지로만 된 문서는 인식할 수 없어요.",
}

# Why no candidates came back, in the user's words. Keys match the failure
# reasons extract_experience_candidates returns.
_FAILURE_WARNINGS = {
    "no_ai": "AI를 사용할 수 없어 문서에서 경험을 찾지 못했어요. 잠시 후 다시 시도해주세요.",
    "timeout": (
        "AI 분석이 시간 안에 끝나지 않았어요. 문서의 텍스트는 정상적으로 읽었으니 "
        "잠시 후 다시 시도하거나, 문서를 나눠서 올려주세요."
    ),
    "unparseable": "AI 응답을 이해하지 못해 경험 후보를 만들지 못했어요. 다시 시도해주세요.",
}

_NOTHING_FOUND = "문서에서 구체적인 활동이나 프로젝트 경험을 찾지 못했어요."

_TRUNCATED_NOTICE = (
    f"문서가 길어서 앞부분 약 {EXPERIENCE_EXTRACTION_TEXT_LIMIT}자까지만 분석했어요. "
    "뒷부분의 경험은 문서를 나눠서 다시 올려주세요."
)


def _clip(value, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def _parse_month(value) -> date | None:
    """'YYYY-MM' (or with a day) -> the 1st of that month; anything else -> None."""
    if not isinstance(value, str):
        return None
    for fmt in ("%Y-%m", "%Y-%m-%d", "%Y.%m", "%Y/%m"):
        try:
            return datetime.strptime(value.strip(), fmt).date().replace(day=1)
        except ValueError:
            continue
    return None


def _enum_or(enum_cls, value, default):
    try:
        return enum_cls(str(value).strip().upper())
    except ValueError:
        return default


def _file_stem(filename: str) -> str:
    return (filename.rsplit(".", 1)[0] if "." in filename else filename).strip()


def _to_candidates(raw_items: list, fallback_title: str) -> list[ExperienceCandidate]:
    candidates: list[ExperienceCandidate] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        situation = _clip(raw.get("situation"), _STAR_MAX)
        action = _clip(raw.get("action"), _STAR_MAX)
        result = _clip(raw.get("result"), _STAR_MAX)
        if not (situation or action or result):
            continue  # nothing to store as an experience
        timeline_title = _clip(raw.get("timeline_title"), _TIMELINE_TITLE_MAX) or fallback_title[:_TIMELINE_TITLE_MAX]
        start = _parse_month(raw.get("start_date"))
        end = _parse_month(raw.get("end_date"))
        candidates.append(
            ExperienceCandidate(
                item_title=_clip(raw.get("item_title"), _ITEM_TITLE_MAX) or timeline_title[:_ITEM_TITLE_MAX],
                timeline_title=timeline_title,
                activity_category=_enum_or(ActivityCategory, raw.get("activity_category"), ActivityCategory.ACTIVITY),
                experience_category=_enum_or(ExperienceCategory, raw.get("experience_category"), None),
                situation=situation,
                action=action,
                result=result,
                start_date=start,
                end_date=end if end is None or start is None or end >= start else None,
            )
        )
    return candidates


@router.get("/targets", response_model=list[ExtractionTargetTimeline])
def list_save_targets(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The user's timelines with their items, so the preview can offer save locations."""
    entries = (
        db.query(TimelineEntry)
        .filter(TimelineEntry.user_id == current_user.id)
        .order_by(TimelineEntry.category.asc(), TimelineEntry.created_at.desc())
        .all()
    )
    items_by_entry: dict[int, list[TimelineItemOut]] = {entry.id: [] for entry in entries}
    if entries:
        items = (
            db.query(TimelineItem)
            .filter(TimelineItem.timeline_entry_id.in_(list(items_by_entry)))
            .order_by(TimelineItem.created_at.asc(), TimelineItem.id.asc())
            .all()
        )
        for item in items:
            items_by_entry[item.timeline_entry_id].append(TimelineItemOut.model_validate(item))
    return [
        ExtractionTargetTimeline.model_validate(entry).model_copy(update={"items": items_by_entry[entry.id]})
        for entry in entries
    ]


@router.post("/analyze", response_model=ExperienceExtractionOut)
def analyze_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Read an uploaded document and return experience candidates.

    Nothing is written here - no timeline, item or experience. The endpoint
    takes no database session of its own; the user reviews the candidates and
    stores the ones they pick through /save.
    """
    filename = file.filename or ""
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if suffix in ("ppt", "doc"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="예전 형식(.ppt/.doc) 파일은 읽을 수 없어요. PPTX·DOCX 또는 PDF로 저장한 뒤 올려주세요.",
        )
    if suffix not in _EXTRACTORS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PDF, PPTX, DOCX 파일만 올릴 수 있어요.",
        )

    raw = file.file.read(_MAX_BYTES + 1)
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="빈 파일이에요.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="파일 용량은 10MB 이하여야 해요."
        )

    try:
        text = _EXTRACTORS[suffix](raw)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="파일에서 텍스트를 읽지 못했어요. 파일이 손상됐거나 암호가 걸려 있지 않은지 확인해주세요.",
        )

    if len("".join(text.split())) < _MIN_TEXT_CHARS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_NO_TEXT_DETAIL[suffix])

    truncated = len(text.strip()) > EXPERIENCE_EXTRACTION_TEXT_LIMIT
    raw_items, failure_reason = extract_experience_candidates(text)

    if raw_items is None:
        reason = failure_reason or "no_ai"
        return ExperienceExtractionOut(
            source_filename=filename,
            warning=_FAILURE_WARNINGS.get(reason, _FAILURE_WARNINGS["no_ai"]),
            failure_reason=reason,
            truncated=truncated,
        )

    candidates = _to_candidates(raw_items, _file_stem(filename) or "업로드한 문서")
    warning = None if candidates else _NOTHING_FOUND
    if truncated:
        warning = f"{warning} {_TRUNCATED_NOTICE}" if warning else _TRUNCATED_NOTICE
    return ExperienceExtractionOut(
        source_filename=filename,
        candidates=candidates,
        warning=warning,
        truncated=truncated,
    )


@router.post("/save", response_model=ExperienceSaveOut)
def save_candidates(
    payload: ExperienceSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Store the candidates the user picked, each under its chosen location.

    Every item's location is checked on its own, so one stale choice (say, a
    timeline deleted in another tab) is reported in its result without
    blocking the others. Everything that passes is written in one commit; if
    that commit itself fails, nothing is saved and the request errors.
    """
    entries = {
        entry.id: entry
        for entry in db.query(TimelineEntry)
        .filter(TimelineEntry.user_id == current_user.id)
        .order_by(TimelineEntry.id.asc())
        .all()
    }
    # (category, title) -> timeline, for items with no chosen timeline: the user's
    # existing timeline of that name, or one created earlier in this request.
    by_title: dict[tuple[ActivityCategory, str], TimelineEntry] = {}
    for entry in entries.values():
        by_title.setdefault((entry.category, entry.title), entry)
    new_entry_ids: set[int] = set()

    source = (payload.source_filename or "").strip()
    trigger_question = (f"'{source}' 문서에서 가져온 경험" if source else "문서에서 가져온 경험")[:_TRIGGER_MAX]
    default_timeline_title = (_file_stem(source) or "문서에서 가져온 경험")[:_TIMELINE_TITLE_MAX]
    this_month = date.today().replace(day=1)

    results: list[ExperienceSaveResult] = []
    try:
        for index, item in enumerate(payload.items):
            created_item = False
            if item.timeline_item_id is not None:
                target_item = db.get(TimelineItem, item.timeline_item_id)
                entry = entries.get(target_item.timeline_entry_id) if target_item else None
                if entry is None:
                    results.append(
                        ExperienceSaveResult(
                            index=index, saved=False, error="선택한 세부항목을 찾을 수 없어요. 삭제됐는지 확인해주세요."
                        )
                    )
                    continue
            else:
                if item.timeline_entry_id is not None:
                    entry = entries.get(item.timeline_entry_id)
                    if entry is None:
                        results.append(
                            ExperienceSaveResult(
                                index=index, saved=False, error="선택한 타임라인을 찾을 수 없어요. 삭제됐는지 확인해주세요."
                            )
                        )
                        continue
                else:
                    title = item.timeline_title or default_timeline_title
                    entry = by_title.get((item.activity_category, title))
                    if entry is None:
                        start = item.start_date.replace(day=1) if item.start_date else this_month
                        end = item.end_date.replace(day=1) if item.end_date else None
                        entry = TimelineEntry(
                            user_id=current_user.id,
                            category=item.activity_category,
                            title=title,
                            start_date=start,
                            end_date=end if end is None or end >= start else None,
                        )
                        db.add(entry)
                        db.flush()
                        entries[entry.id] = entry
                        by_title[(item.activity_category, title)] = entry
                        new_entry_ids.add(entry.id)
                target_item = TimelineItem(timeline_entry_id=entry.id, title=item.item_title)
                db.add(target_item)
                db.flush()
                created_item = True

            star = [item.situation, item.action, item.result]
            experience = SubExperience(
                timeline_entry_id=entry.id,
                timeline_item_id=target_item.id,
                category=item.experience_category,
                trigger_question=trigger_question,
                # The experience list and matching read `answer`; the STAR parts are its text.
                answer="\n".join(part for part in star if part),
                situation=item.situation,
                action=item.action,
                result=item.result,
            )
            db.add(experience)
            db.flush()
            results.append(
                ExperienceSaveResult(
                    index=index,
                    saved=True,
                    sub_experience_id=experience.id,
                    timeline_entry_id=entry.id,
                    timeline_title=entry.title,
                    timeline_item_id=target_item.id,
                    item_title=target_item.title,
                    created_timeline=entry.id in new_entry_ids,
                    created_item=created_item,
                )
            )
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("[careerbank] saving extracted experiences failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="저장 중 오류가 발생해 아무 항목도 저장되지 않았어요. 잠시 후 다시 시도해주세요.",
        )

    saved = sum(1 for r in results if r.saved)
    return ExperienceSaveOut(saved_count=saved, failed_count=len(results) - saved, results=results)
