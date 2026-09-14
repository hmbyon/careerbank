import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import inspect, text

from app.database import Base, engine
from app.routers import (
    admin,
    auth,
    dashboard,
    essay_questions,
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


@app.on_event("startup")
def on_startup():
    # Simplicity over migrations, per spec (student project size).
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()


# create_all only creates missing tables, never new columns on existing ones.
# Additive, nullable columns listed here are added on startup so both the local
# SQLite file and the production Postgres pick them up without a manual step.
_ADDED_COLUMNS = [
    ("essay_questions", "job_description", "TEXT"),
]


def _add_missing_columns():
    inspector = inspect(engine)
    for table, column, ddl_type in _ADDED_COLUMNS:
        existing = {c["name"] for c in inspector.get_columns(table)}
        if column in existing:
            continue
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(timelines.router, prefix="/api")
app.include_router(interview.router, prefix="/api")
app.include_router(experiences.router, prefix="/api")
app.include_router(essay_questions.router, prefix="/api")
app.include_router(matches.router, prefix="/api")
app.include_router(resume.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(free_essays.router, prefix="/api")
