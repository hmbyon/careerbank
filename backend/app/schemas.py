"""Pydantic schemas for requests/responses."""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import ActivityCategory, ExperienceCategory


# ---------- Auth ----------

class SignupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=6)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- Dashboard ----------

class DashboardSummary(BaseModel):
    timeline_count: int
    experience_count: int
    essay_question_count: int


# ---------- Timelines ----------

class TimelineEntryCreate(BaseModel):
    category: ActivityCategory
    title: str = Field(..., min_length=1, max_length=50)
    start_date: date
    end_date: Optional[date] = None

    @field_validator("end_date")
    @classmethod
    def check_dates(cls, v, info):
        start = info.data.get("start_date")
        if v is not None and start is not None and start > v:
            raise ValueError("start_date must be <= end_date")
        return v


class TimelineEntryUpdate(TimelineEntryCreate):
    pass


class TimelineEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    category: ActivityCategory
    title: str
    start_date: date
    end_date: Optional[date]
    created_at: datetime
    updated_at: Optional[datetime]


class TimelineItemCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=30)


class TimelineItemUpdate(TimelineItemCreate):
    """Same single editable field as creation."""


class TimelineItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    timeline_entry_id: int
    title: str
    created_at: datetime


# ---------- Interview ----------

class InterviewQuestionOut(BaseModel):
    category: Optional[ExperienceCategory]
    question: Optional[str]


class InterviewAnswerRequest(BaseModel):
    timeline_id: int
    item_id: Optional[int] = None
    category: ExperienceCategory
    trigger_question: str = Field(..., min_length=1, max_length=500)
    answer: str = Field(..., min_length=1)


class SubExperienceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    timeline_entry_id: int
    timeline_item_id: Optional[int]
    category: ExperienceCategory
    trigger_question: str
    answer: str
    situation: Optional[str]
    action: Optional[str]
    result: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]


class InterviewAnswerResponse(BaseModel):
    saved: SubExperienceOut
    next_question: Optional[InterviewQuestionOut]


# ---------- Experiences ----------

class SubExperienceUpdate(BaseModel):
    category: ExperienceCategory
    situation: str = Field(..., min_length=1)
    action: str = Field(..., min_length=1)
    result: str = Field(..., min_length=1)
    # The original interview answer, editable from the experience detail page.
    # Optional so older callers that omit it keep working; omitted = leave as is.
    answer: Optional[str] = Field(default=None, min_length=1)


# ---------- Essay questions ----------

class EssayQuestionCreate(BaseModel):
    question_text: str = Field(..., min_length=1, max_length=1000)
    char_limit: Optional[int] = Field(default=None, gt=0)
    company: Optional[str] = Field(default=None, max_length=200)
    position: Optional[str] = Field(default=None, max_length=200)


class EssayQuestionUpdate(EssayQuestionCreate):
    """Same editable fields as creation; every one is replaced on save."""


class EssayQuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    question_text: str
    char_limit: Optional[int]
    company: Optional[str]
    position: Optional[str]
    draft_text: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]


class EssayQuestionCreateResponse(EssayQuestionOut):
    warning: Optional[str] = None


class EssayQuestionListItem(EssayQuestionOut):
    status: str


class DraftUpdateRequest(BaseModel):
    draft_text: str = Field(..., min_length=1)


# ---------- Matches ----------

class MatchOut(BaseModel):
    match_id: int
    sub_experience: SubExperienceOut
    relevance_score: float
    confirmed: bool


class MatchRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sub_experience_id: int
    essay_question_id: int
    relevance_score: float
    confirmed: bool
    created_at: datetime


# ---------- Resume ----------

class ResumeItem(BaseModel):
    # Kept in sync with TimelineEntry.title (String(50)) - every item becomes one.
    title: str = Field(..., min_length=1, max_length=50)
    start_date: date
    end_date: Optional[date] = None
    # Set by PUT /api/resume: the timeline_entries row this item is mirrored into.
    # Null means "not linked yet" - saving creates the entry and fills this in.
    timeline_entry_id: Optional[int] = None
    # Heading this item is grouped under in the rendered resume. Blank falls back
    # to the category's default Korean label (학력/경력/대외활동/자격증), so free-form
    # sections like "해외경험" / "어학" work without touching the timeline enum.
    section_label: Optional[str] = Field(default=None, max_length=50)
    # Free text; each non-empty line becomes one "- " bullet under the title.
    description: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("end_date")
    @classmethod
    def check_dates(cls, v, info):
        start = info.data.get("start_date")
        if v is not None and start is not None and start > v:
            raise ValueError("start_date must be <= end_date")
        return v


class ResumeContent(BaseModel):
    education: list[ResumeItem] = Field(default_factory=list)
    career: list[ResumeItem] = Field(default_factory=list)
    activity: list[ResumeItem] = Field(default_factory=list)
    certificate: list[ResumeItem] = Field(default_factory=list)


class ResumeUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    phone: Optional[str] = Field(default=None, max_length=50)
    birth_date: Optional[date] = None
    photo_url: Optional[str] = Field(default=None, max_length=500)
    content: ResumeContent


class ResumeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # A never-saved resume is returned as an in-memory draft, so the row-only
    # fields (id / timestamps) are absent and `draft` is true.
    id: Optional[int] = None
    user_id: int
    name: str
    email: str
    phone: Optional[str] = None
    birth_date: Optional[date] = None
    photo_url: Optional[str] = None
    content: ResumeContent
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    draft: bool = False


class ResumeImportItem(BaseModel):
    """An item parsed out of an uploaded resume file.

    Looser than ResumeItem on purpose: an import only pre-fills the form, so a
    missing title or period is expected and the user fixes it before saving.
    """
    title: str = Field(default="", max_length=50)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    section_label: Optional[str] = Field(default=None, max_length=50)
    description: Optional[str] = Field(default=None, max_length=2000)


class ResumeImportContent(BaseModel):
    education: list[ResumeImportItem] = Field(default_factory=list)
    career: list[ResumeImportItem] = Field(default_factory=list)
    activity: list[ResumeImportItem] = Field(default_factory=list)
    certificate: list[ResumeImportItem] = Field(default_factory=list)


class ResumeImportOut(BaseModel):
    """Never persisted - the form is pre-filled and the user saves explicitly."""
    name: str
    email: str
    phone: Optional[str] = None
    birth_date: Optional[date] = None
    photo_url: Optional[str] = None
    content: ResumeImportContent
    draft: bool = True
    # Set when the text was extracted but AI structuring was unavailable.
    warning: Optional[str] = None
