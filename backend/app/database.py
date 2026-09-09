"""
Database engine / session / Base setup.

Supports both:
  - SQLite for local dev (default, when DATABASE_URL is unset)
  - PostgreSQL in production (when DATABASE_URL is set, e.g. Render + Neon)

Render/Heroku-style URLs sometimes come as `postgres://...` which SQLAlchemy's
psycopg2 dialect no longer accepts directly — rewrite to `postgresql+psycopg2://`.
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if not DATABASE_URL:
    # Local dev fallback: a SQLite file in the backend working directory.
    DATABASE_URL = "sqlite:///./careerbank.db"
elif DATABASE_URL.startswith("postgres://"):
    # Render/Heroku give postgres:// but SQLAlchemy + psycopg2 wants postgresql+psycopg2://
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
