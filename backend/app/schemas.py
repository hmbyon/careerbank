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


# ---------- Essay questions ----------

class EssayQuestionCreate(BaseModel):
    question_text: str = Field(..., min_length=1, max_length=1000)
    char_limit: Optional[int] = Field(default=None, gt=0)
    company: Optional[str] = Field(default=None, max_length=200)
    position: Optional[str] = Field(default=None, max_length=200)


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
