"""Resume: an auto-drafted, user-editable summary of the user's timeline entries."""
from io import BytesIO

from fastapi import APIRouter, Depends, Response
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityCategory, Resume, TimelineEntry, User
from app.schemas import ResumeContent, ResumeItem, ResumeOut, ResumeUpdate
from app.security import get_current_user

router = APIRouter(prefix="/resume", tags=["resume"])

# Timeline categories -> the keys used inside resumes.content.
CATEGORY_KEYS: dict[ActivityCategory, str] = {
    ActivityCategory.EDUCATION: "education",
    ActivityCategory.CAREER: "career",
    ActivityCategory.ACTIVITY: "activity",
    ActivityCategory.CERTIFICATE: "certificate",
}

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
            ResumeItem(title=entry.title, start_date=entry.start_date, end_date=entry.end_date)
        )
    return ResumeOut(
        user_id=current_user.id,
        name=current_user.name,
        email=current_user.email,
        phone=None,
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


@router.put("", response_model=ResumeOut)
def upsert_resume(
    payload: ResumeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    phone = payload.phone.strip() if payload.phone else None
    content = payload.content.model_dump(mode="json")

    resume = _get_resume(current_user, db)
    if resume is None:
        resume = Resume(
            user_id=current_user.id,
            name=payload.name,
            email=payload.email,
            phone=phone,
            content=content,
        )
        db.add(resume)
    else:
        resume.name = payload.name
        resume.email = payload.email
        resume.phone = phone
        resume.content = content
    db.commit()
    db.refresh(resume)
    return resume


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

# reportlab's built-in fonts are Latin-only; the Adobe CJK CID font ships with
# reportlab itself, so Hangul renders without any extra font file or native dep.
_KO_FONT = "HYSMyeongJo-Medium"
_FALLBACK_FONT = "Helvetica"


def _resolve_font() -> str:
    try:
        pdfmetrics.getFont(_KO_FONT)
        return _KO_FONT
    except KeyError:
        pass
    try:
        pdfmetrics.registerFont(UnicodeCIDFont(_KO_FONT))
        return _KO_FONT
    except Exception:
        # Never fail the download over a font: Latin text still renders fine.
        return _FALLBACK_FONT


def _format_period(item: dict) -> str:
    start = item.get("start_date") or ""
    end = item.get("end_date") or "현재"
    return f"{start} ~ {end}" if start else end


def _render_pdf(data: ResumeOut) -> bytes:
    font = _resolve_font()
    content = data.content.model_dump(mode="json")

    title_style = ParagraphStyle("cbTitle", fontName=font, fontSize=20, leading=26, spaceAfter=4)
    meta_style = ParagraphStyle("cbMeta", fontName=font, fontSize=10, leading=15, textColor=colors.HexColor("#555555"))
    heading_style = ParagraphStyle("cbHeading", fontName=font, fontSize=13, leading=18, spaceBefore=14, spaceAfter=6)
    cell_style = ParagraphStyle("cbCell", fontName=font, fontSize=10, leading=14)
    empty_style = ParagraphStyle("cbEmpty", fontName=font, fontSize=10, leading=14, textColor=colors.HexColor("#888888"))

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title="이력서",
        author=data.name,
    )

    flow = [Paragraph(data.name, title_style)]
    contact = " | ".join(part for part in (data.email, data.phone) if part)
    if contact:
        flow.append(Paragraph(contact, meta_style))
    flow.append(Spacer(1, 6))

    table_width = doc.width
    for key, label in SECTIONS:
        flow.append(Paragraph(label, heading_style))
        items = content.get(key) or []
        if not items:
            flow.append(Paragraph("등록된 항목이 없어요.", empty_style))
            continue
        rows = [
            [Paragraph(item.get("title", ""), cell_style), Paragraph(_format_period(item), cell_style)]
            for item in items
        ]
        table = Table(rows, colWidths=[table_width * 0.62, table_width * 0.38])
        table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDDD")),
                ]
            )
        )
        flow.append(table)

    doc.build(flow)
    return buffer.getvalue()


@router.get("/pdf", responses={200: {"content": {"application/pdf": {}}, "description": "이력서 PDF"}})
def download_resume_pdf(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    data = _current_resume(current_user, db)
    pdf = _render_pdf(data)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="resume.pdf"'},
    )
