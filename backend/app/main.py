import logging
import os
from collections import defaultdict
from contextlib import contextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import MetaData, Table, inspect, select, text

from app.database import Base, engine
from app.models import Application
from app.routers import (
    admin,
    applications,
    auth,
    dashboard,
    essay_questions,
    experience_extraction,
    experiences,
    feedback,
    free_essays,
    interview,
    matches,
    resume,
    timelines,
)

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

app = FastAPI(title="CareerBank API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


logger = logging.getLogger("careerbank.migration")


@app.on_event("startup")
def on_startup():
    # Simplicity over migrations, per spec (student project size).
    with _schema_lock():
        Base.metadata.create_all(bind=engine)
        _add_missing_columns()
        _backfill_applications()


# Arbitrary constant naming this app's startup schema lock in Postgres.
_SCHEMA_LOCK_KEY = 725310041


@contextmanager
def _schema_lock():
    """Serialize the startup schema work across processes sharing a Postgres database.

    Several serverless instances can boot at once. Without this, two of them race
    to create the same new table (one fails with a duplicate pg_class entry) or to
    back-fill the same rows. The lock lives on its own connection, so the work
    below can use pooled connections freely. SQLite is local and single-process.
    """
    if engine.dialect.name != "postgresql":
        yield
        return
    with engine.connect() as conn:
        conn.execute(text("SELECT pg_advisory_lock(:key)"), {"key": _SCHEMA_LOCK_KEY})
        try:
            yield
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _SCHEMA_LOCK_KEY})


# create_all only creates missing tables, never new columns on existing ones.
# Additive, nullable columns listed here are added on startup so both the local
# SQLite file and the production Postgres pick them up without a manual step.
_ADDED_COLUMNS = [
    ("essay_questions", "job_description", "TEXT"),
    ("essay_questions", "application_id", "INTEGER REFERENCES applications(id)"),
]

# Indexes the models declare on columns from _ADDED_COLUMNS; create_all only
# builds indexes together with a new table.
_ADDED_INDEXES = [
    ("ix_essay_questions_application_id", "essay_questions", "application_id"),
]


def _add_missing_columns():
    inspector = inspect(engine)
    for table, column, ddl_type in _ADDED_COLUMNS:
        existing = {c["name"] for c in inspector.get_columns(table)}
        if column in existing:
            continue
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))
    with engine.begin() as conn:
        for name, table, column in _ADDED_INDEXES:
            conn.execute(text(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({column})"))


# Questions saved without a company still need an application to live under.
_NO_COMPANY_LABEL = "회사 미지정"


def _backfill_applications():
    """Give every essay question without an application one, grouped by user + company.

    Before applications existed, company / position / job_description were typed
    per question. Questions of one user whose company matches (ignoring surrounding
    whitespace) share one application; questions with no company share a
    "회사 미지정" one. Only rows whose application_id is still NULL are touched, so
    restarts are no-ops, and the legacy columns are read but never modified.

    Grouping is deliberately exact: "Naver" and "naver" stay separate applications
    and are only logged, since merging would be a guess. Where one group holds
    different positions or job descriptions, the most recently created question's
    value wins and the conflict is logged with the question ids for manual review.
    """
    # Runs inside _schema_lock, so an instance booting alongside another waits and
    # then finds nothing left to migrate.
    with engine.begin() as conn:
        questions = Table("essay_questions", MetaData(), autoload_with=conn)
        legacy = [name for name in ("company", "position", "job_description") if name in questions.c]
        rows = conn.execute(
            select(questions.c.id, questions.c.user_id, questions.c.created_at, *(questions.c[n] for n in legacy))
            .where(questions.c.application_id.is_(None))
            .order_by(questions.c.id)
        ).mappings().all()
        if not rows:
            return

        groups: dict[tuple[int, str], list] = defaultdict(list)
        for row in rows:
            company = (row.get("company") or "").strip() or _NO_COMPANY_LABEL
            groups[(row["user_id"], company)].append(row)

        applications = Application.__table__
        created = reused = 0
        for (user_id, company), members in groups.items():
            # Newest first, so the first non-empty value found is the one kept.
            newest_first = sorted(members, key=lambda r: (r["created_at"] is not None, r["created_at"], r["id"]), reverse=True)
            ids = sorted(r["id"] for r in members)
            values = {}
            for field in ("position", "job_description"):
                present = [(r.get(field) or "").strip() for r in newest_first]
                present = [v for v in present if v]
                values[field] = present[0] if present else None
                if len(set(present)) > 1:
                    logger.warning(
                        "[careerbank][migration] conflicting %s for user_id=%s company=%r: "
                        "%d different values across questions %s; kept the newest (%r)",
                        field, user_id, company, len(set(present)), ids, values[field][:80],
                    )

            # An application left from an earlier run (e.g. a question saved by an
            # older instance mid-deploy) is reused instead of duplicated.
            existing_id = conn.execute(
                select(applications.c.id)
                .where(applications.c.user_id == user_id, applications.c.company == company)
                .order_by(applications.c.id)
                .limit(1)
            ).scalar()
            if existing_id is None:
                created_times = [r["created_at"] for r in members if r["created_at"] is not None]
                result = conn.execute(
                    applications.insert().values(
                        user_id=user_id,
                        company=company,
                        position=values["position"],
                        job_description=values["job_description"],
                        **({"created_at": min(created_times)} if created_times else {}),
                    )
                )
                application_id = result.inserted_primary_key[0]
                created += 1
            else:
                application_id = existing_id
                reused += 1

            conn.execute(
                questions.update()
                .where(questions.c.id.in_(ids), questions.c.application_id.is_(None))
                .values(application_id=application_id)
            )

        # Companies that differ only by case or spacing were kept apart; flag them.
        by_user: dict[int, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
        for user_id, company in groups:
            by_user[user_id]["".join(company.split()).casefold()].append(company)
        for user_id, variants in by_user.items():
            for names in variants.values():
                if len(names) > 1:
                    logger.warning(
                        "[careerbank][migration] similar company names kept as separate applications "
                        "for user_id=%s: %s", user_id, names,
                    )

        logger.warning(
            "[careerbank][migration] linked %d essay questions to applications "
            "(%d created, %d existing reused, %d users)",
            len(rows), created, reused, len({r["user_id"] for r in rows}),
        )


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(timelines.router, prefix="/api")
app.include_router(interview.router, prefix="/api")
app.include_router(experiences.router, prefix="/api")
app.include_router(experience_extraction.router, prefix="/api")
app.include_router(applications.router, prefix="/api")
app.include_router(essay_questions.router, prefix="/api")
app.include_router(matches.router, prefix="/api")
app.include_router(resume.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(free_essays.router, prefix="/api")
