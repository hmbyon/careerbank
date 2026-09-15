"""Resume: an auto-drafted, user-editable summary of the user's timeline entries."""
import ipaddress
import re
import socket
from datetime import date, datetime
from io import BytesIO
from urllib.parse import urlparse
from urllib.request import urlopen

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityCategory, Resume, TimelineEntry, User
from app.schemas import (
    ResumeContent,
    ResumeImportContent,
    ResumeImportItem,
    ResumeImportOut,
    ResumeItem,
    ResumeOut,
    ResumeUpdate,
)
from app.security import get_current_user
from app.services.gemini import RESUME_IMPORT_TEXT_LIMIT, extract_resume_fields
# Moved to a shared module (experience extraction reads the same formats); the
# private names are kept so the import code below reads exactly as before.
from app.services.document_text import extract_docx_text as _extract_docx_text
from app.services.document_text import extract_pdf_text as _extract_pdf_text

router = APIRouter(prefix="/resume", tags=["resume"])

# Timeline categories -> the keys used inside resumes.content.
CATEGORY_KEYS: dict[ActivityCategory, str] = {
    ActivityCategory.EDUCATION: "education",
    ActivityCategory.CAREER: "career",
    ActivityCategory.ACTIVITY: "activity",
    ActivityCategory.CERTIFICATE: "certificate",
}

# The same mapping the other way round: resumes.content key -> timeline category.
SECTION_CATEGORIES: dict[str, ActivityCategory] = {key: category for category, key in CATEGORY_KEYS.items()}

# Section order + Korean headings, shared by the draft builder and the PDF renderer.
SECTIONS: list[tuple[str, str]] = [
    ("education", "학력"),
    ("career", "경력"),
    ("activity", "대외활동"),
    ("certificate", "자격증"),
]


def _get_resume(current_user: User, db: Session) -> Resume | None:
    return db.query(Resume).filter(Resume.user_id == current_user.id).first()


def _build_draft(current_user: User, db: Session) -> ResumeOut:
    """Build an unsaved resume from the user's profile + timeline entries.

    Nothing is written to the DB - this is only ever returned as a response.
    """
    entries = (
        db.query(TimelineEntry)
        .filter(TimelineEntry.user_id == current_user.id)
        .order_by(TimelineEntry.start_date.desc())
        .all()
    )
    grouped: dict[str, list[ResumeItem]] = {key: [] for key in CATEGORY_KEYS.values()}
    for entry in entries:
        key = CATEGORY_KEYS.get(entry.category)
        if key is None:
            continue
        grouped[key].append(
            ResumeItem(
                title=entry.title,
                start_date=entry.start_date,
                end_date=entry.end_date,
                timeline_entry_id=entry.id,
                section_label=None,
                description=None,
            )
        )
    return ResumeOut(
        user_id=current_user.id,
        name=current_user.name,
        email=current_user.email,
        phone=None,
        birth_date=None,
        photo_url=None,
        content=ResumeContent(**grouped),
        draft=True,
    )


def _current_resume(current_user: User, db: Session) -> ResumeOut:
    """The saved resume if there is one, otherwise a freshly built draft."""
    resume = _get_resume(current_user, db)
    if resume is None:
        return _build_draft(current_user, db)
    return ResumeOut.model_validate(resume)


@router.get("", response_model=ResumeOut)
def get_resume(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _current_resume(current_user, db)


def _first_of_month(value: date | None) -> date | None:
    """Periods are year-month only, so the day is always stored as the 1st."""
    return value.replace(day=1) if value else None


def _normalize_periods(content: ResumeContent) -> None:
    for key in SECTION_CATEGORIES:
        for item in getattr(content, key):
            item.start_date = _first_of_month(item.start_date)
            item.end_date = _first_of_month(item.end_date)


def _sync_timeline_entries(content: ResumeContent, current_user: User, db: Session) -> None:
    """Mirror the resume's items into timeline_entries, filling in `timeline_entry_id`.

    An unlinked item creates a new entry; a linked one is updated in place, so the
    resume form doubles as the entry point for building a timeline.

    Nothing is ever deleted: dropping a row from the resume form must not destroy
    the timeline entry, because its items / sub-experiences (interview answers)
    hang off it. Unlinking is intentional - the entry stays in the timeline.
    """
    for key, category in SECTION_CATEGORIES.items():
        for item in getattr(content, key):
            if item.timeline_entry_id is not None:
                entry = db.get(TimelineEntry, item.timeline_entry_id)
                if entry is None or entry.user_id != current_user.id:
                    # Gone, or someone else's row: never write to it, and don't
                    # keep the dangling reference in this user's resume either.
                    item.timeline_entry_id = None
                    continue
                # `updated_at` is bumped by the column's onupdate when a field changes.
                entry.category = category
                entry.title = item.title
                entry.start_date = item.start_date
                entry.end_date = item.end_date
                continue

            entry = TimelineEntry(
                user_id=current_user.id,
                category=category,
                title=item.title,
                start_date=item.start_date,
                end_date=item.end_date,
            )
            db.add(entry)
            db.flush()  # assign the PK so it can be stored back into the resume
            item.timeline_entry_id = entry.id


@router.put("", response_model=ResumeOut)
def upsert_resume(
    payload: ResumeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    phone = payload.phone.strip() if payload.phone else None
    photo_url = payload.photo_url.strip() if payload.photo_url else None
    _normalize_periods(payload.content)
    # Fills in timeline_entry_id on the items, so the saved content carries the links.
    _sync_timeline_entries(payload.content, current_user, db)
    content = payload.content.model_dump(mode="json")

    resume = _get_resume(current_user, db)
    if resume is None:
        resume = Resume(
            user_id=current_user.id,
            name=payload.name,
            email=payload.email,
            phone=phone,
            birth_date=payload.birth_date,
            photo_url=photo_url,
            content=content,
        )
        db.add(resume)
    else:
        resume.name = payload.name
        resume.email = payload.email
        resume.phone = phone
        resume.birth_date = payload.birth_date
        resume.photo_url = photo_url
        resume.content = content
    db.commit()
    db.refresh(resume)
    return resume


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

# reportlab's built-in fonts are Latin-only; the Adobe CJK CID fonts ship with
# reportlab itself, so Hangul renders without any extra font file or native dep.
# Neither has a bold cut, so the gothic face stands in for emphasis against the
# lighter myeongjo body text.
_KO_BODY_FONT = "HYSMyeongJo-Medium"
_KO_BOLD_FONT = "HYGothic-Medium"
_FALLBACK_FONT = "Helvetica"
_FALLBACK_BOLD_FONT = "Helvetica-Bold"

# Cap on the profile photo we are willing to pull in (bytes) and how long to wait.
_PHOTO_MAX_BYTES = 5 * 1024 * 1024
_PHOTO_TIMEOUT_SECONDS = 5


def _resolve_font(name: str, fallback: str) -> str:
    try:
        pdfmetrics.getFont(name)
        return name
    except KeyError:
        pass
    try:
        pdfmetrics.registerFont(UnicodeCIDFont(name))
        return name
    except Exception:
        # Never fail the download over a font: Latin text still renders fine.
        return fallback


def _format_year_month(value: str | None) -> str:
    """'2021-03-01' -> '2021. 03.' - periods are year-month only, never the day."""
    if not value:
        return ""
    parts = value.split("-")
    return f"{parts[0]}. {parts[1]}." if len(parts) >= 2 else value


def _format_period(item: dict) -> str:
    start = _format_year_month(item.get("start_date"))
    end = _format_year_month(item.get("end_date")) or "현재"
    return f"{start} – {end}" if start else end


def _korean_age(birth: date, today: date) -> int:
    """만 나이: full years elapsed, so the birthday must already have passed."""
    age = today.year - birth.year
    if (today.month, today.day) < (birth.month, birth.day):
        age -= 1
    return age


def _format_birth_date(value: str | None) -> str | None:
    """'1997-10-25' -> '1997. 10. 25. (만 28세)'."""
    if not value:
        return None
    try:
        birth = date.fromisoformat(value)
    except ValueError:
        return value
    formatted = f"{birth.year}. {birth.month}. {birth.day}."
    age = _korean_age(birth, date.today())
    return f"{formatted} (만 {age}세)" if age >= 0 else formatted


def _is_public_http_url(url: str) -> bool:
    """Only plain http(s) to a public address - the server does the fetching."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            return False
    return True


def _fetch_photo(url: str | None) -> bytes | None:
    """Best-effort profile photo bytes. Any problem just means "no photo" - never a 500."""
    if not url or not _is_public_http_url(url):
        return None
    try:
        with urlopen(url, timeout=_PHOTO_TIMEOUT_SECONDS) as response:  # noqa: S310 - scheme checked above
            raw = response.read(_PHOTO_MAX_BYTES + 1)
        if not raw or len(raw) > _PHOTO_MAX_BYTES:
            return None
        ImageReader(BytesIO(raw)).getSize()  # forces a decode, so a broken file fails here
        return raw
    except Exception:
        return None


def _grouped_sections(content: dict) -> list[tuple[str, list[dict]]]:
    """Group items by their display heading, in first-appearance order.

    An item's own `section_label` wins; otherwise it falls back to the Korean
    label of the category it sits under.
    """
    groups: dict[str, list[dict]] = {}
    for key, default_label in SECTIONS:
        for item in content.get(key) or []:
            label = (item.get("section_label") or "").strip() or default_label
            groups.setdefault(label, []).append(item)
    return list(groups.items())


# Imported/pasted text often already carries its own bullet marker; strip it so
# the renderer doesn't produce "- - text".
_BULLET_PREFIX_RE = re.compile(r"^[-*\u2022\u00b7\u25cf\u25aa]+\s*")


def _bullets(item: dict) -> list[str]:
    lines = []
    for raw in (item.get("description") or "").splitlines():
        line = _BULLET_PREFIX_RE.sub("", raw.strip()).strip()
        if line:
            lines.append(line)
    return lines


def _render_pdf(data: ResumeOut, author_name: str) -> bytes:
    body_font = _resolve_font(_KO_BODY_FONT, _FALLBACK_FONT)
    bold_font = _resolve_font(_KO_BOLD_FONT, _FALLBACK_BOLD_FONT)
    content = data.content.model_dump(mode="json")

    name_style = ParagraphStyle("cbName", fontName=bold_font, fontSize=20, leading=26, spaceAfter=6)
    meta_style = ParagraphStyle("cbMeta", fontName=body_font, fontSize=10, leading=16, textColor=colors.HexColor("#444444"))
    heading_style = ParagraphStyle("cbHeading", fontName=bold_font, fontSize=13, leading=18)
    period_style = ParagraphStyle("cbPeriod", fontName=body_font, fontSize=9.5, leading=14, textColor=colors.HexColor("#555555"))
    item_title_style = ParagraphStyle("cbItemTitle", fontName=bold_font, fontSize=11, leading=16)
    bullet_style = ParagraphStyle(
        "cbBullet", fontName=body_font, fontSize=9.5, leading=15, leftIndent=9, firstLineIndent=-9
    )
    empty_style = ParagraphStyle("cbEmpty", fontName=body_font, fontSize=9.5, leading=14, textColor=colors.HexColor("#888888"))
    confirm_style = ParagraphStyle("cbConfirm", fontName=body_font, fontSize=10, leading=16, alignment=TA_CENTER)
    author_style = ParagraphStyle("cbAuthor", fontName=bold_font, fontSize=10, leading=16, alignment=TA_CENTER)

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title="이력서",
        author=author_name,
    )
    table_width = doc.width

    # ---- header: name + personal details on the left, photo on the right ----
    details = [Paragraph(data.name, name_style)]
    birth = _format_birth_date(data.birth_date.isoformat() if data.birth_date else None)
    for label, value in (("생년월일", birth), ("전화번호", data.phone), ("이메일", data.email)):
        if value:
            details.append(Paragraph(f"{label} &nbsp;&nbsp; {value}", meta_style))

    photo = _fetch_photo(data.photo_url)
    if photo is None:
        flow: list = list(details)
    else:
        photo_w = 28 * mm
        # Separate streams: ImageReader and Image each consume the buffer they get.
        img_w, img_h = ImageReader(BytesIO(photo)).getSize()
        photo_h = photo_w * img_h / img_w if img_w else photo_w
        header = Table(
            [[details, Image(BytesIO(photo), width=photo_w, height=photo_h)]],
            colWidths=[table_width - photo_w - 6 * mm, photo_w + 6 * mm],
        )
        header.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (0, 0), "TOP"),
                    ("VALIGN", (1, 0), (1, 0), "TOP"),
                    ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        flow = [header]

    flow.append(Spacer(1, 10))

    # ---- sections: heading, then "period | title + bullets" rows ----
    groups = _grouped_sections(content)
    if not groups:
        flow.append(Paragraph("등록된 항목이 없어요.", empty_style))

    for label, items in groups:
        heading = Table([[Paragraph(label, heading_style)]], colWidths=[table_width])
        heading.setStyle(
            TableStyle(
                [
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 12),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.8, colors.HexColor("#333333")),
                ]
            )
        )
        flow.append(heading)

        rows = []
        for item in items:
            cell = [Paragraph(item.get("title", ""), item_title_style)]
            cell += [Paragraph(f"- {line}", bullet_style) for line in _bullets(item)]
            rows.append([Paragraph(_format_period(item), period_style), cell])
        table = Table(rows, colWidths=[table_width * 0.3, table_width * 0.7])
        table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        flow.append(table)

    # ---- closing statement ----
    flow.append(Spacer(1, 26))
    flow.append(Paragraph("위의 모든 기재사항은 사실과 다름없음을 확인합니다.", confirm_style))
    flow.append(Spacer(1, 8))
    flow.append(Paragraph(f"작성자: {author_name}", author_style))

    doc.build(flow)
    return buffer.getvalue()


@router.get("/pdf", responses={200: {"content": {"application/pdf": {}}, "description": "이력서 PDF"}})
def download_resume_pdf(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    data = _current_resume(current_user, db)
    # The closing line is signed by the logged-in account, not the editable header name.
    pdf = _render_pdf(data, current_user.name)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="resume.pdf"'},
    )


# ---------------------------------------------------------------------------
# Import: pre-fill the form from an uploaded resume file
# ---------------------------------------------------------------------------

_IMPORT_MAX_BYTES = 10 * 1024 * 1024
_TITLE_MAX = 50
_SECTION_LABEL_MAX = 50
_DESCRIPTION_MAX = 2000

_CHECK_SUFFIX = "항목명과 기간이 맞는지 확인·수정한 뒤 저장해주세요."

# Why the line-structure fallback ran, in the user's words. Keys match the
# failure reasons extract_resume_fields returns.
_FALLBACK_WARNINGS = {
    "no_ai": f"AI 키가 없어 파일의 줄 구조만 보고 항목을 나눴어요. {_CHECK_SUFFIX}",
    "timeout": (
        "AI 파싱이 시간 안에 끝나지 않아 파일의 줄 구조만 보고 항목을 나눴어요. "
        f"텍스트는 그대로 추출됐어요. {_CHECK_SUFFIX}"
    ),
    "unparseable": f"AI 응답을 이해하지 못해 파일의 줄 구조만 보고 항목을 나눴어요. {_CHECK_SUFFIX}",
}

_TRUNCATED_NOTICE = (
    f"이력서가 길어서 앞부분 약 {RESUME_IMPORT_TEXT_LIMIT}자까지만 분석했어요. "
    "뒷부분 내용은 직접 추가해주세요."
)


def _clip(value, limit: int) -> str | None:
    """Trim AI/raw output to what the resume schema accepts."""
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed[:limit] if trimmed else None


def _parse_month(value) -> date | None:
    """Accepts 'YYYY-MM' or 'YYYY-MM-DD'; always returns the 1st of that month."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    for fmt in ("%Y-%m", "%Y-%m-%d", "%Y.%m", "%Y/%m"):
        try:
            return datetime.strptime(text, fmt).date().replace(day=1)
        except ValueError:
            continue
    return None


def _parse_birth_date(value) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


def _to_import_items(raw_items) -> list[ResumeImportItem]:
    items: list[ResumeImportItem] = []
    if not isinstance(raw_items, list):
        return items
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        items.append(
            ResumeImportItem(
                title=_clip(raw.get("title"), _TITLE_MAX) or "",
                start_date=_parse_month(raw.get("start_date")),
                end_date=_parse_month(raw.get("end_date")),
                section_label=_clip(raw.get("section_label"), _SECTION_LABEL_MAX),
                description=_clip(raw.get("description"), _DESCRIPTION_MAX),
            )
        )
    return items


# --- No-AI fallback parsing -------------------------------------------------
# Good enough to break a resume into editable chunks; the user tidies up after.

_MAX_FALLBACK_ITEMS = 40

# "2015.03", "2015-03", "2015 / 03", "2015년 3월" - the year is what anchors it.
_MONTH_RE = r"(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*월?"
# Dash-ish separators, including the soft hyphen PDF text extraction often
# yields for an en dash, plus the fullwidth and wave variants.
_DASHES = "\\-\u00ad\u2010-\u2015\u2212\uff0d~\u223c\u301c\uff5e"
# A leading period like "2015.03 - 2019.02" or a single "2022.05".
_PERIOD_RE = re.compile(
    rf"^\s*{_MONTH_RE}\.?\s*(?:[{_DASHES}]+|부터|to)?\s*(?:{_MONTH_RE}\.?|현재|재직중|진행중)?\s*[.{_DASHES}:)\]]*\s*"
)
_BULLET_LINE_RE = re.compile(r"^\s*[-*•·●▪\u00ad\u2010-\u2015]\s+")
# Boilerplate this app itself prints, ignored when a generated PDF is re-imported.
_FOOTER_LINE_RE = re.compile(r"^\s*(?:위의 모든 기재사항은|작성자\s*[:：])")

# A line that is exactly one of these switches which section later items land in.
_SECTION_HEADINGS: list[tuple[str, tuple[str, ...]]] = [
    ("education", ("학력", "학 력", "education")),
    ("career", ("경력", "경 력", "career", "work experience", "경력사항")),
    ("certificate", ("자격증", "자격 및 어학", "어학", "자격", "certificate", "certification", "language")),
    ("activity", ("대외활동", "활동", "활동경험", "해외경험", "교내활동", "activity", "experience")),
]


def _match_section_heading(line: str) -> tuple[str, str] | None:
    """A short standalone heading line -> (section key, the heading text as written)."""
    text = line.strip().strip("[]<>()■●◆□▶·-–—:").strip()
    if not text or len(text) > 20:
        return None
    lowered = text.lower().replace(" ", "")
    for key, keywords in _SECTION_HEADINGS:
        for keyword in keywords:
            if lowered == keyword.lower().replace(" ", ""):
                return key, text
    return None


_DOC_TITLE_RE = re.compile(r"^\s*이\s*력\s*서\s*$|^\s*resume\s*$|^\s*curriculum\s+vitae\s*$", re.IGNORECASE)
_EMAIL_LINE_RE = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.]+$")
_HEADER_FIELD_RES: list[tuple[str, "re.Pattern[str]"]] = [
    ("name", re.compile(r"^(?:이름|성명|name)\s*[:：]?\s*(.+)$", re.IGNORECASE)),
    ("birth_date", re.compile(r"^(?:생년월일|생일|출생(?:일)?|birth(?:day|date)?)\s*[:：]?\s*(.+)$", re.IGNORECASE)),
    ("phone", re.compile(r"^(?:연락처|전화(?:번호)?|휴대폰|핸드폰|tel|phone|mobile)\s*[:：]?\s*(.+)$", re.IGNORECASE)),
    ("email", re.compile(r"^(?:이메일|메일|e-?mail)\s*[:：]?\s*(.+)$", re.IGNORECASE)),
]


def _parse_loose_date(value: str) -> date | None:
    """'1996-04-12' / '1996.04.12' / '1996년 4월 12일' -> a date."""
    digits = re.findall(r"\d+", value)
    if len(digits) < 3:
        return None
    try:
        return date(int(digits[0]), int(digits[1]), int(digits[2]))
    except ValueError:
        return None


def _extract_header_fields(text: str) -> tuple[dict, str]:
    """Lift name / birth date / phone off the top of the document.

    Returns the found fields plus the text with those lines removed, so the
    splitter doesn't turn a contact block into bogus resume items.
    """
    found: dict = {}
    kept: list[str] = []
    header_zone = True

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if header_zone:
            if _match_section_heading(line) is not None:
                header_zone = False
            elif not line or _DOC_TITLE_RE.match(line) or _EMAIL_LINE_RE.match(line):
                continue
            else:
                matched = False
                for key, pattern in _HEADER_FIELD_RES:
                    m = pattern.match(line)
                    if not m:
                        continue
                    value = m.group(1).strip()
                    if key == "birth_date":
                        parsed = _parse_loose_date(value)
                        if parsed:
                            found[key] = parsed
                            matched = True
                    elif key == "email":
                        matched = True  # consumed, never used: the account email wins
                    elif value:
                        found.setdefault(key, value[:100 if key == "name" else 50])
                        matched = True
                    break
                if matched:
                    continue
        kept.append(raw_line)

    return found, "\n".join(kept)


def _split_period(line: str) -> tuple[date | None, date | None, str]:
    """Pull a leading period off a line: returns (start, end, remaining text)."""
    match = _PERIOD_RE.match(line)
    if not match or not match.group(1):
        return None, None, line.strip()
    start = _parse_month(f"{match.group(1)}-{int(match.group(2)):02d}")
    end = None
    if match.group(3):
        end = _parse_month(f"{match.group(3)}-{int(match.group(4)):02d}")
    return start, end, line[match.end() :].strip()


def _looks_like_title(line: str, has_period: bool, after_bullet: bool = False) -> bool:
    """Starts a new item: a dated line, or a short non-bullet line.

    `after_bullet` guards the common PDF case where a long bullet wraps onto the
    next line: the tail is short and carries no marker, so on its own it looks
    like a title. Right after a bullet it is treated as that bullet's
    continuation instead - unless it carries its own date or bullet marker.
    """
    if has_period:
        return True
    if _BULLET_LINE_RE.match(line):
        return False
    if after_bullet:
        return False
    return len(line.strip()) <= 40


def _split_text_into_items(text: str) -> dict[str, list[ResumeImportItem]]:
    """Break raw resume text into per-section draft items without any AI.

    Splits on section headings, dated lines and short heading-ish lines; bullet
    and long lines attach to the item above them as description.
    """
    grouped: dict[str, list[ResumeImportItem]] = {key: [] for key in SECTION_CATEGORIES}
    section = "education"  # nothing seen yet - keep it in the first section
    section_label: str | None = None
    current: ResumeImportItem | None = None
    body: list[str] = []
    total = 0

    def flush() -> None:
        nonlocal current, body
        if current is not None:
            current.description = _clip("\n".join(body), _DESCRIPTION_MAX)
            grouped[current_section].append(current)
        current, body = None, []

    current_section = section
    # Whether the previous kept line was a bullet, so a wrapped tail can be
    # recognised as its continuation rather than a new title.
    prev_was_bullet = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if _FOOTER_LINE_RE.match(line):
            continue

        heading = _match_section_heading(line)
        if heading is not None:
            flush()
            section, heading_text = heading
            # Only keep a label when it differs from the section's own default.
            default = dict(SECTIONS).get(section)
            section_label = None if heading_text == default else heading_text
            prev_was_bullet = False
            continue

        start, end, remainder = _split_period(line)
        has_period = start is not None

        if total < _MAX_FALLBACK_ITEMS and _looks_like_title(line, has_period, prev_was_bullet):
            flush()
            title = remainder or line
            current_section = section
            current = ResumeImportItem(
                title=_clip(title, _TITLE_MAX) or "",
                start_date=start,
                end_date=end,
                section_label=section_label,
            )
            total += 1
            prev_was_bullet = False
            continue

        if current is None:
            # Body text before any title line - open an untitled item to hold it.
            current_section = section
            current = ResumeImportItem(title="", section_label=section_label)
            total += 1
        is_bullet = bool(_BULLET_LINE_RE.match(line))
        stripped = _BULLET_LINE_RE.sub("", line).strip() or line
        if prev_was_bullet and not is_bullet and body:
            # Wrapped tail of the previous bullet - join instead of starting a new one.
            body[-1] = f"{body[-1]} {stripped}".strip()
        else:
            body.append(stripped)
        prev_was_bullet = is_bullet or prev_was_bullet

    flush()
    return grouped


@router.post("/import", response_model=ResumeImportOut)
def import_resume(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Turn an uploaded PDF/DOCX into an unsaved draft that pre-fills the form.

    Nothing is written here - no resume row, no timeline entries. The user
    reviews the parsed values and presses save, which runs the normal upsert.
    """
    filename = file.filename or ""
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if suffix not in ("pdf", "docx"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PDF 또는 DOCX 파일만 올릴 수 있어요.",
        )

    raw = file.file.read(_IMPORT_MAX_BYTES + 1)
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="빈 파일이에요.")
    if len(raw) > _IMPORT_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="파일 용량은 10MB 이하여야 해요."
        )

    try:
        text = _extract_pdf_text(raw) if suffix == "pdf" else _extract_docx_text(raw)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="파일에서 텍스트를 읽지 못했어요. 다른 파일로 다시 시도해주세요.",
        )

    if not text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="파일에서 글자를 찾지 못했어요. 스캔 이미지 PDF는 인식할 수 없어요.",
        )

    truncated = len(text.strip()) > RESUME_IMPORT_TEXT_LIMIT
    parsed, failure_reason = extract_resume_fields(text)

    def with_notice(message: str | None) -> str | None:
        """Append the truncation notice to whatever warning we already have."""
        if not truncated:
            return message
        return f"{message} {_TRUNCATED_NOTICE}" if message else _TRUNCATED_NOTICE

    if parsed is None:
        # Fallback: split the text heuristically so the user gets editable rows
        # instead of one wall of text. Still a draft - nothing is saved here.
        header, body_text = _extract_header_fields(text)
        grouped = _split_text_into_items(body_text)
        if not any(grouped.values()):
            stem = filename.rsplit(".", 1)[0] or "첨부한 이력서"
            grouped["education"] = [
                ResumeImportItem(
                    title=stem[:_TITLE_MAX],
                    section_label="첨부한 이력서 원문",
                    description=_clip(text, _DESCRIPTION_MAX),
                )
            ]
        return ResumeImportOut(
            name=header.get("name") or current_user.name,
            email=current_user.email,
            phone=header.get("phone"),
            birth_date=header.get("birth_date"),
            content=ResumeImportContent(**grouped),
            # The fallback reads the whole document, so a truncation notice would
            # only apply to the AI path - don't add it here.
            warning=_FALLBACK_WARNINGS.get(failure_reason or "no_ai", _FALLBACK_WARNINGS["no_ai"]),
        )

    raw_content = parsed.get("content") or {}
    content = ResumeImportContent(
        **{key: _to_import_items(raw_content.get(key)) for key in SECTION_CATEGORIES}
    )
    return ResumeImportOut(
        name=_clip(parsed.get("name"), 100) or current_user.name,
        email=current_user.email,
        phone=_clip(parsed.get("phone"), 50),
        birth_date=_parse_birth_date(parsed.get("birth_date")),
        content=content,
        warning=with_notice(None),
    )

