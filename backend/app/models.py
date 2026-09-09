"""SQLAlchemy models for all 6 tables + 2 enums (see SPEC.md section 1)."""
import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ActivityCategory(str, enum.Enum):
    EDUCATION = "EDUCATION"
    CAREER = "CAREER"
    ACTIVITY = "ACTIVITY"
    CERTIFICATE = "CERTIFICATE"


class ExperienceCategory(str, enum.Enum):
    COLLABORATION = "COLLABORATION"
    LEADERSHIP = "LEADERSHIP"
    COMMUNICATION = "COMMUNICATION"
    INITIATIVE = "INITIATIVE"
    RESPONSIBILITY = "RESPONSIBILITY"
    PROBLEM_SOLVING = "PROBLEM_SOLVING"
    RESILIENCE = "RESILIENCE"
    GOAL_MANAGEMENT = "GOAL_MANAGEMENT"
    VALUES_ETHICS = "VALUES_ETHICS"
    SELF_INITIATIVE = "SELF_INITIATIVE"
    CREATIVITY = "CREATIVITY"
    TECHNICAL_SKILL = "TECHNICAL_SKILL"
    PERFORMANCE = "PERFORMANCE"
    PROJECT_MANAGEMENT = "PROJECT_MANAGEMENT"
    DATA_DRIVEN = "DATA_DRIVEN"
    STAKEHOLDER = "STAKEHOLDER"


# Fixed, stable ordering used for round-robin fallback / "all categories used" checks.
EXPERIENCE_CATEGORY_ORDER = [c.value for c in ExperienceCategory]


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    timeline_entries: Mapped[list["TimelineEntry"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    essay_questions: Mapped[list["EssayQuestion"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class TimelineEntry(Base):
    __tablename__ = "timeline_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    category: Mapped[ActivityCategory] = mapped_column(SAEnum(ActivityCategory, name="activity_category"), nullable=False)
    title: Mapped[str] = mapped_column(String(50), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, onupdate=func.now())

    user: Mapped["User"] = relationship(back_populates="timeline_entries")
    items: Mapped[list["TimelineItem"]] = relationship(
        back_populates="timeline_entry", cascade="all, delete-orphan"
    )
    sub_experiences: Mapped[list["SubExperience"]] = relationship(
        back_populates="timeline_entry", cascade="all, delete-orphan"
    )


class TimelineItem(Base):
    __tablename__ = "timeline_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    timeline_entry_id: Mapped[int] = mapped_column(ForeignKey("timeline_entries.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    timeline_entry: Mapped["TimelineEntry"] = relationship(back_populates="items")
    sub_experiences: Mapped[list["SubExperience"]] = relationship(
        back_populates="timeline_item", cascade="all, delete-orphan"
    )


class SubExperience(Base):
    __tablename__ = "sub_experiences"

    id: Mapped[int] = mapped_column(primary_key=True)
    timeline_entry_id: Mapped[int] = mapped_column(ForeignKey("timeline_entries.id"), nullable=False, index=True)
    timeline_item_id: Mapped[int | None] = mapped_column(ForeignKey("timeline_items.id"), nullable=True, index=True)
    category: Mapped[ExperienceCategory] = mapped_column(
        SAEnum(ExperienceCategory, name="experience_category"), nullable=False
    )
    trigger_question: Mapped[str] = mapped_column(String(500), nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    situation: Mapped[str | None] = mapped_column(Text, nullable=True)
    action: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, onupdate=func.now())

    timeline_entry: Mapped["TimelineEntry"] = relationship(back_populates="sub_experiences")
    timeline_item: Mapped["TimelineItem | None"] = relationship(back_populates="sub_experiences")
    matches: Mapped[list["Match"]] = relationship(back_populates="sub_experience", cascade="all, delete-orphan")


class EssayQuestion(Base):
    __tablename__ = "essay_questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    question_text: Mapped[str] = mapped_column(String(1000), nullable=False)
    char_limit: Mapped[int | None] = mapped_column(nullable=True)
    company: Mapped[str | None] = mapped_column(String(200), nullable=True)
    position: Mapped[str | None] = mapped_column(String(200), nullable=True)
    draft_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, onupdate=func.now())

    user: Mapped["User"] = relationship(back_populates="essay_questions")
    matches: Mapped[list["Match"]] = relationship(back_populates="essay_question", cascade="all, delete-orphan")


class Match(Base):
    __tablename__ = "matches"
    __table_args__ = (UniqueConstraint("sub_experience_id", "essay_question_id", name="uq_match_pair"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sub_experience_id: Mapped[int] = mapped_column(ForeignKey("sub_experiences.id"), nullable=False, index=True)
    essay_question_id: Mapped[int] = mapped_column(ForeignKey("essay_questions.id"), nullable=False, index=True)
    relevance_score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    sub_experience: Mapped["SubExperience"] = relationship(back_populates="matches")
    essay_question: Mapped["EssayQuestion"] = relationship(back_populates="matches")


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # URL only - no file upload. Rendered into the PDF header when reachable.
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # {"education": [...], "career": [...], "activity": [...], "certificate": [...]}
    # where each element is {"title": str, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" | None}.
    content: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, onupdate=func.now())
