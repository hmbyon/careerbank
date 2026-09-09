import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import auth, dashboard, essay_questions, experiences, interview, matches, timelines

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
