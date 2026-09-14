"""
Heuristic fallback scorer + summary-building helpers for essay-question <-> experience matching.

The actual scoring implementation (keyword-overlap heuristic) and the Gemini-batched
scorer both live in app.services.gemini, since they share tokenizing/parsing helpers.
This module provides the higher-level helpers routers use: building experience
summaries and running the full "score all of a user's experiences" step, batching
through Gemini with a heuristic fallback.
"""
from typing import Optional

from app.models import SubExperience
from app.services.gemini import batch_match_scores, heuristic_match_scores  # re-exported


def experience_summary(exp: SubExperience) -> str:
    """
    Build the text used to score an experience against an essay question:
    situation/action/result if present, else the raw answer + trigger_question.
    """
    if exp.situation or exp.action or exp.result:
        parts = [exp.situation or "", exp.action or "", exp.result or ""]
        return " ".join(p for p in parts if p).strip()
    return f"{exp.trigger_question} {exp.answer}".strip()


def score_experiences(
    question_text: str,
    company: Optional[str],
    position: Optional[str],
    experiences: list[SubExperience],
    job_description: Optional[str] = None,
) -> list[float]:
    """Score every experience against the essay question; returns scores in the same order."""
    summaries = [experience_summary(e) for e in experiences]
    return batch_match_scores(question_text, company, position, summaries, job_description=job_description)
