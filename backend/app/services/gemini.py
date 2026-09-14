"""
Gemini API integration (app/services/gemini.py).

Wraps google.generativeai for the 3 AI use-cases described in SPEC.md section 3:
  3a. Interview question generation
  3b. Batch relevance matching
  3c. Draft essay generation

Design goals:
  - Importing this module must NEVER crash app startup, even if the
    `google-generativeai` package is missing or GEMINI_API_KEY is unset.
  - Every public function has a genuine, usable non-AI fallback so callers
    never need to handle a hard failure from this module.
  - All prompts are in Korean; all Gemini calls request a strict output format
    (JSON or plain text) and defensively strip ```json ... ``` fences before
    parsing, since Gemini sometimes wraps output in markdown fences.
"""
import json
import logging
import os
import re
import time
from typing import Optional

from app.models import EXPERIENCE_CATEGORY_ORDER

logger = logging.getLogger("careerbank.gemini")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip() or "gemini-2.0-flash"
GEMINI_TIMEOUT_SECONDS = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "15"))

# Resume import sends a whole document and asks for structured JSON back, so it
# needs longer than the short interactive calls above - but it must still give up
# well before the serverless platform kills the request, otherwise the user gets a
# 504 instead of the line-structure fallback. Keep this in sync with the
# `maxDuration` set for the backend function in vercel.json.
RESUME_IMPORT_PLATFORM_LIMIT_SECONDS = float(
    os.getenv("RESUME_IMPORT_PLATFORM_LIMIT_SECONDS", "300")
)
# Default to a wait a person will actually sit through, never above 75% of the
# platform budget (so lowering maxDuration automatically tightens this too).
GEMINI_IMPORT_TIMEOUT_SECONDS = float(
    os.getenv(
        "GEMINI_IMPORT_TIMEOUT_SECONDS",
        str(min(45.0, RESUME_IMPORT_PLATFORM_LIMIT_SECONDS * 0.75)),
    )
)

# Characters of resume text sent to Gemini. A long document mostly adds latency:
# the structured part of a resume is near the top, and the reply must still fit
# in one response. Text beyond this is dropped (the caller says so in a warning).
RESUME_IMPORT_TEXT_LIMIT = int(os.getenv("RESUME_IMPORT_TEXT_LIMIT", "6000"))

_genai = None
_model = None
_INIT_ERROR: Optional[str] = None

try:
    import google.generativeai as genai  # type: ignore

    if GEMINI_API_KEY:
        genai.configure(api_key=GEMINI_API_KEY)
        _model = genai.GenerativeModel(GEMINI_MODEL)
        _genai = genai
    else:
        _INIT_ERROR = "GEMINI_API_KEY not set"
except Exception as exc:  # pragma: no cover - defensive: package missing/broken
    _INIT_ERROR = f"google-generativeai unavailable: {exc}"
    _genai = None
    _model = None

if _INIT_ERROR:
    logger.warning("[careerbank] Gemini disabled — falling back to non-AI logic (%s)", _INIT_ERROR)


def gemini_available() -> bool:
    return _model is not None


def _generate_text(prompt: str, timeout_seconds: Optional[float] = None) -> Optional[str]:
    """Call Gemini with a short timeout; return None on any failure."""
    if _model is None:
        return None
    try:
        request_options = {"timeout": timeout_seconds or GEMINI_TIMEOUT_SECONDS}
        response = _model.generate_content(prompt, request_options=request_options)
        text = getattr(response, "text", None)
        if not text:
            # Some SDK versions expose candidates instead of a flat .text
            candidates = getattr(response, "candidates", None) or []
            for cand in candidates:
                parts = getattr(getattr(cand, "content", None), "parts", None) or []
                for part in parts:
                    if getattr(part, "text", None):
                        text = part.text
                        break
                if text:
                    break
        return text
    except Exception as exc:
        logger.warning("[careerbank] Gemini call failed: %s", exc)
        return None


def _strip_code_fences(text: str) -> str:
    """Strip ```json ... ``` / ``` ... ``` fences that Gemini sometimes wraps output in."""
    t = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", t, flags=re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # Fallback: strip any leading/trailing fence lines even if unbalanced.
    t = re.sub(r"^```(?:json)?", "", t, flags=re.IGNORECASE).strip()
    t = re.sub(r"```$", "", t).strip()
    return t


def _try_parse_json(text: str):
    cleaned = _strip_code_fences(text)
    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        # Last resort: try to find the first {...} or [...] block.
        for open_c, close_c in (("{", "}"), ("[", "]")):
            start = cleaned.find(open_c)
            end = cleaned.rfind(close_c)
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(cleaned[start : end + 1])
                except json.JSONDecodeError:
                    continue
        return None


# ---------------------------------------------------------------------------
# 3a. Interview question generation
# ---------------------------------------------------------------------------

# Genuine, usable default Korean interview questions for all 16 experience
# categories. Used as the fallback when Gemini is unavailable, errors, times
# out, or returns something we can't parse/validate.
DEFAULT_QUESTIONS: dict[str, str] = {
    "COLLABORATION": "이 활동에서 다른 사람들과 협력하며 함께 목표를 이뤘던 순간이 있다면 이야기해 주세요.",
    "LEADERSHIP": "이 활동에서 팀이나 모임을 이끌어야 했던 순간이 있었나요? 어떻게 이끌었는지 말씀해 주세요.",
    "COMMUNICATION": "이 활동 중 다른 사람과의 소통이 특히 중요했던 상황이 있었다면 어떤 방식으로 대화를 풀어나갔는지 이야기해 주세요.",
    "INITIATIVE": "이 활동에서 스스로 나서서 새로운 시도나 도전을 했던 경험이 있다면 들려주세요.",
    "RESPONSIBILITY": "이 활동에서 맡은 역할을 끝까지 책임지고 해냈던 경험이 있다면 이야기해 주세요.",
    "PROBLEM_SOLVING": "이 활동 중 예상치 못한 문제나 어려움을 마주하고 해결했던 경험을 말씀해 주세요.",
    "RESILIENCE": "이 활동에서 실패하거나 좌절했던 순간, 그리고 그것을 어떻게 극복했는지 이야기해 주세요.",
    "GOAL_MANAGEMENT": "이 활동에서 목표를 세우고 그것을 달성하기 위해 어떻게 계획하고 추진했는지 말씀해 주세요.",
    "VALUES_ETHICS": "이 활동에서 본인의 가치관이나 원칙을 지키기 위해 고민했던 순간이 있다면 이야기해 주세요.",
    "SELF_INITIATIVE": "이 활동에서 누가 시키지 않아도 스스로 계획하고 실행했던 경험이 있다면 들려주세요.",
    "CREATIVITY": "이 활동에서 기존과는 다른 새로운 아이디어나 방식으로 문제를 바라봤던 경험이 있다면 말씀해 주세요.",
    "TECHNICAL_SKILL": "이 활동을 하면서 특정 직무 역량이나 기술을 배우고 성장시켰던 경험을 이야기해 주세요.",
    "PERFORMANCE": "이 활동에서 수치나 눈에 보이는 성과로 나타났던 결과가 있다면 구체적으로 말씀해 주세요.",
    "PROJECT_MANAGEMENT": "이 활동에서 일정이나 여러 작업을 동시에 관리해야 했던 경험이 있다면 어떻게 관리했는지 이야기해 주세요.",
    "DATA_DRIVEN": "이 활동에서 데이터나 근거를 바탕으로 의사결정을 내렸던 경험이 있다면 들려주세요.",
    "STAKEHOLDER": "이 활동에서 고객이나 이해관계자를 직접 상대해야 했던 경험이 있다면 어떻게 대응했는지 말씀해 주세요.",
}


def _fallback_question(used_categories: list[str]) -> dict:
    """Pick the first unused category in fixed order and return its default question."""
    remaining = [c for c in EXPERIENCE_CATEGORY_ORDER if c not in used_categories]
    if not remaining:
        return {"category": None, "question": None}
    category = remaining[0]
    return {"category": category, "question": DEFAULT_QUESTIONS[category]}


def generate_interview_question(
    timeline_category: str,
    timeline_title: str,
    item_title: Optional[str],
    used_categories: list[str],
) -> dict:
    """
    Returns {"category": <str|None>, "question": <str|None>}.
    None/None signals all 16 categories have already been used for this context.
    """
    remaining = [c for c in EXPERIENCE_CATEGORY_ORDER if c not in used_categories]
    if not remaining:
        return {"category": None, "question": None}

    if _model is None:
        return _fallback_question(used_categories)

    context_line = f"활동 분류: {timeline_category}, 활동명: {timeline_title}"
    if item_title:
        context_line += f", 세부 항목: {item_title}"

    prompt = f"""당신은 친절하고 유능한 커리어 코치입니다. 아래 활동에 대해, 아직 다루지 않은 역량 카테고리 중
하나를 골라 그 역량이 드러나는 구체적인 경험(상황-행동-결과, STAR)을 이끌어낼 수 있는
자연스러운 한국어 인터뷰 질문을 하나 만들어 주세요.

{context_line}

이미 사용된 카테고리(다시 고르면 안 됨): {', '.join(used_categories) if used_categories else '없음'}
아직 사용 가능한 카테고리: {', '.join(remaining)}

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명이나 마크다운 없이 JSON만 출력하세요.
{{"category": "위 사용 가능한 카테고리 중 정확히 하나", "question": "활동/항목 이름을 자연스럽게 언급하는 한국어 질문 한 문장"}}
"""

    text = _generate_text(prompt)
    if text:
        data = _try_parse_json(text)
        if isinstance(data, dict):
            category = data.get("category")
            question = data.get("question")
            if (
                isinstance(category, str)
                and category in remaining
                and isinstance(question, str)
                and question.strip()
            ):
                return {"category": category, "question": question.strip()}

    logger.info("[careerbank] Gemini interview question fallback triggered")
    return _fallback_question(used_categories)


# ---------------------------------------------------------------------------
# 3b. Batch relevance matching
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"[\w가-힣]+")

# Korean glues particles onto the end of a noun, so a plain whitespace/word split
# makes "책임감을" and "책임감" completely different tokens and the overlap comes
# out empty. Strip the common ones before comparing. Longest first, so "으로서"
# is tried before "로" and "서".
_JOSA = tuple(
    sorted(
        (
            "으로써", "으로서", "에게서", "이라고", "이라는",
            "으로", "로서", "로써", "에서", "에게", "께서", "부터", "까지",
            "마다", "조차", "처럼", "보다", "이나", "라도", "한테", "이란", "이라",
            "을", "를", "이", "가", "은", "는", "에", "의", "로", "와", "과", "도", "만", "랑", "나", "야",
        ),
        key=len,
        reverse=True,
    )
)

# Below this length a "stem" is too generic to mean anything, so we neither strip
# down to it nor let it match as a substring.
_MIN_STEM_LEN = 2


def _strip_josa(token: str) -> str:
    """"책임감을" -> "책임감". Leaves the token alone if the stem gets too short."""
    for josa in _JOSA:
        if token.endswith(josa) and len(token) - len(josa) >= _MIN_STEM_LEN:
            return token[: -len(josa)]
    return token


def _tokenize(text: str) -> set[str]:
    return set(_TOKEN_RE.findall((text or "").lower()))


def _stems(text: str) -> set[str]:
    return {_strip_josa(token) for token in _tokenize(text)}


def heuristic_match_scores(question_text: str, experience_summaries: list[str]) -> list[float]:
    """
    Simple keyword-overlap fallback scorer: lowercased token overlap between the
    essay question text and each experience's combined text, normalized to 0-100.

    Matching is particle-insensitive: tokens are compared after their Korean
    particle is stripped, and a token that appears anywhere inside the question
    text also counts, so "책임감" scores against "책임감을 발휘했던 경험".
    """
    q_stems = _stems(question_text)
    q_text = (question_text or "").lower()
    scores = []
    for summary in experience_summaries:
        e_stems = _stems(summary)
        if not q_stems or not e_stems:
            scores.append(0.0)
            continue
        overlap = {
            stem
            for stem in e_stems
            if stem in q_stems or (len(stem) >= _MIN_STEM_LEN and stem in q_text)
        }
        # Normalize by the smaller set so short answers aren't unfairly punished,
        # then scale to 0-100.
        denom = min(len(q_stems), len(e_stems)) or 1
        ratio = len(overlap) / denom
        scores.append(round(min(ratio, 1.0) * 100, 2))
    return scores


# Job postings can be long; the requirements are what matter and a shorter prompt
# keeps the call inside its timeout.
JOB_DESCRIPTION_PROMPT_LIMIT = 4000


def _job_description_excerpt(job_description: Optional[str]) -> str:
    return (job_description or "").strip()[:JOB_DESCRIPTION_PROMPT_LIMIT]


def batch_match_scores(
    question_text: str,
    company: Optional[str],
    position: Optional[str],
    experience_summaries: list[str],
    job_description: Optional[str] = None,
) -> list[float]:
    """
    Returns a list of scores (0-100), same length/order as experience_summaries.
    Tries a single batched Gemini call first; falls back to keyword-overlap heuristic.
    """
    if not experience_summaries:
        return []

    if _model is not None:
        header = f"자기소개서 문항: {question_text}"
        if company:
            header += f"\n지원 회사: {company}"
        if position:
            header += f"\n지원 직무: {position}"

        numbered = "\n".join(f"{i}. {s}" for i, s in enumerate(experience_summaries))

        # Without a job description the prompt is byte-for-byte what it was before.
        jd = _job_description_excerpt(job_description)
        jd_block = (
            f"\n\n채용공고 요구사항:\n{jd}\n\n"
            "평가 시 문항 적합도와 함께, 각 경험이 위 채용공고가 요구하는 역량·경험과 얼마나 부합하는지도 반영하세요."
            if jd
            else ""
        )

        prompt = f"""당신은 채용 자기소개서 컨설턴트입니다. 아래 자기소개서 문항과, 지원자가 겪은 여러 경험 목록이
주어집니다. 각 경험이 이 문항에 답하기에 얼마나 적합한지 0~100 사이의 점수로 평가해 주세요.
(100 = 이 문항의 답변으로 매우 적합, 0 = 전혀 관련 없음)

{header}{jd_block}

경험 목록:
{numbered}

반드시 아래 JSON 배열 형식으로만 응답하세요. 목록에 있는 모든 항목에 대해 하나씩 포함해야 합니다.
다른 설명이나 마크다운 없이 JSON만 출력하세요.
[{{"index": 0, "score": 0~100 사이의 숫자}}, ...]
"""
        text = _generate_text(prompt)
        if text:
            data = _try_parse_json(text)
            if isinstance(data, list):
                score_by_index: dict[int, float] = {}
                for entry in data:
                    if not isinstance(entry, dict):
                        continue
                    idx = entry.get("index")
                    score = entry.get("score")
                    try:
                        idx = int(idx)
                        score = float(score)
                    except (TypeError, ValueError):
                        continue
                    score_by_index[idx] = max(0.0, min(100.0, score))
                if len(score_by_index) == len(experience_summaries):
                    return [round(score_by_index[i], 2) for i in range(len(experience_summaries))]
                logger.info("[careerbank] Gemini match response incomplete, using heuristic fallback")

    logger.info("[careerbank] Gemini matching fallback (heuristic) triggered")
    return heuristic_match_scores(question_text, experience_summaries)


# ---------------------------------------------------------------------------
# 3c. Draft essay generation
# ---------------------------------------------------------------------------

def _fallback_draft(
    question_text: str,
    experiences: list[dict],
    char_limit: Optional[int],
) -> str:
    """Template fallback: concatenate confirmed experiences' STAR fields into a readable paragraph."""
    paragraphs = []
    for exp in experiences:
        situation = (exp.get("situation") or "").strip()
        action = (exp.get("action") or "").strip()
        result = (exp.get("result") or "").strip()
        parts = [p for p in (situation, action, result) if p]
        if parts:
            paragraphs.append(" ".join(parts))
    body = "\n\n".join(paragraphs) if paragraphs else "등록된 경험 내용이 부족하여 초안을 충분히 작성하지 못했습니다."
    draft = body
    if char_limit and len(draft) > char_limit:
        draft = draft[: max(char_limit - 1, 0)].rstrip() + "…"
    return draft


def generate_draft(
    question_text: str,
    company: Optional[str],
    position: Optional[str],
    char_limit: Optional[int],
    experiences: list[dict],
    job_description: Optional[str] = None,
) -> str:
    """
    experiences: list of {"situation": str|None, "action": str|None, "result": str|None}
    for all confirmed matches. Returns plain Korean essay text.
    """
    if _model is not None:
        header = f"자기소개서 문항: {question_text}"
        if company:
            header += f"\n지원 회사: {company}"
        if position:
            header += f"\n지원 직무: {position}"
        if char_limit:
            header += f"\n글자 수 제한: 공백 포함 최대 {char_limit}자 (반드시 이 제한을 넘기지 않도록 작성)"

        exp_lines = []
        for i, exp in enumerate(experiences, start=1):
            situation = (exp.get("situation") or "").strip()
            action = (exp.get("action") or "").strip()
            result = (exp.get("result") or "").strip()
            exp_lines.append(
                f"[경험 {i}]\n상황: {situation or '(없음)'}\n행동: {action or '(없음)'}\n결과: {result or '(없음)'}"
            )
        exp_block = "\n\n".join(exp_lines)

        # Without a job description the prompt is byte-for-byte what it was before.
        jd = _job_description_excerpt(job_description)
        jd_block = f"\n\n채용공고:\n{jd}" if jd else ""
        jd_guideline = (
            "- 채용공고의 핵심 키워드와 요구 역량을 경험과 연결해 자연스럽게 녹여내세요. 키워드를 나열하거나 억지로 끼워 넣지 마세요.\n"
            if jd
            else ""
        )

        prompt = f"""당신은 채용 자기소개서 작성을 돕는 전문 컨설턴트입니다. 아래 자기소개서 문항과 지원자의
경험(상황-행동-결과)들을 활용하여, 자연스럽고 설득력 있는 한국어 자기소개서 답변을 작성해 주세요.

{header}{jd_block}

지원자의 경험:
{exp_block}

작성 지침:
- 위 경험들을 자연스럽게 녹여서 하나의 완결된 글로 작성하세요.
- 문항의 의도에 맞게 답변하세요.
{jd_guideline}- 글자 수 제한이 있다면 반드시 지키도록 노력하세요.
- 출력은 순수한 한국어 자기소개서 본문 텍스트만 작성하세요. JSON, 마크다운, 따옴표, 설명 문구를 절대 포함하지 마세요.
"""
        text = _generate_text(prompt)
        if text:
            cleaned = _strip_code_fences(text).strip()
            # Strip a wrapping pair of quotes, if Gemini added one.
            if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] == '"':
                cleaned = cleaned[1:-1].strip()
            if cleaned:
                return cleaned

    logger.info("[careerbank] Gemini draft generation fallback (template) triggered")
    return _fallback_draft(question_text, experiences, char_limit)


# ---------------------------------------------------------------------------
# 3d. Resume import: structure an uploaded resume's raw text
# ---------------------------------------------------------------------------

# Keys of resumes.content, mirrored here so the prompt and the caller agree.
RESUME_SECTION_KEYS = ["education", "career", "activity", "certificate"]


def extract_resume_fields(raw_text: str) -> tuple[Optional[dict], Optional[str]]:
    """Structure an uploaded resume's text into our resume schema.

    Returns (parsed, failure_reason). `parsed` is None whenever the caller should
    fall back to line-structure parsing, and `failure_reason` says why:
    "no_ai" (key missing/unusable), "timeout" (gave up before the platform would),
    or "unparseable" (Gemini answered with something we can't use).
    """
    if _model is None or not raw_text.strip():
        return None, "no_ai"

    # Long resumes get truncated: the tail is rarely the structured part, and a
    # shorter prompt is what keeps this call inside the timeout budget.
    excerpt = raw_text.strip()[:RESUME_IMPORT_TEXT_LIMIT]

    prompt = f"""당신은 이력서 파싱 전문가입니다. 아래는 사용자가 업로드한 이력서에서 추출한 원문 텍스트입니다.
이 내용을 정해진 JSON 구조로 정리해 주세요.

--- 원문 시작 ---
{excerpt}
--- 원문 끝 ---

규칙:
- 항목은 반드시 education(학력), career(경력), activity(대외활동), certificate(자격증/어학) 4개 키 중
  가장 적절한 곳에 넣으세요. 4개 키는 값이 비어 있어도 모두 포함해야 합니다.
- section_label에는 원문에 적힌 실제 섹션 제목(예: "해외경험", "어학", "활동경험")을 넣으세요.
  원문의 섹션 제목이 학력/경력/대외활동/자격증과 같다면 null로 두세요.
- 기간은 연-월까지만, "YYYY-MM" 형식으로 쓰세요. 진행중이면 end_date를 null로 두세요.
  원문에서 기간을 찾을 수 없으면 null로 두세요.
- title은 50자 이내의 짧은 항목명(학교명/회사명/활동명)만 넣으세요.
- description에는 그 항목의 세부 설명을 줄바꿈으로 구분해 여러 줄로 넣으세요. 없으면 null.
- birth_date는 "YYYY-MM-DD" 형식, 없으면 null.
- 원문에 없는 내용을 지어내지 마세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명이나 마크다운 없이 JSON만 출력하세요.
{{"name": "이름 또는 null", "birth_date": "YYYY-MM-DD 또는 null", "phone": "전화번호 또는 null",
  "content": {{"education": [{{"title": "...", "section_label": null, "start_date": "YYYY-MM", "end_date": "YYYY-MM 또는 null", "description": "여러 줄 설명 또는 null"}}],
  "career": [], "activity": [], "certificate": []}}}}
"""

    started = time.monotonic()
    text = _generate_text(prompt, timeout_seconds=GEMINI_IMPORT_TIMEOUT_SECONDS)
    elapsed = time.monotonic() - started

    if not text:
        # _generate_text swallows the cause, so infer it: a call that ran the full
        # budget was a timeout, anything quicker was an API/config error.
        timed_out = elapsed >= GEMINI_IMPORT_TIMEOUT_SECONDS * 0.9
        logger.info(
            "[careerbank] Gemini resume import produced nothing after %.1fs (%s)",
            elapsed,
            "timeout" if timed_out else "error",
        )
        return None, "timeout" if timed_out else "no_ai"

    data = _try_parse_json(text)
    if not isinstance(data, dict) or not isinstance(data.get("content"), dict):
        logger.info("[careerbank] Gemini resume import response unparseable")
        return None, "unparseable"
    return data, None


# ---------------------------------------------------------------------------
# 3e. STAR decomposition of an interview answer
# ---------------------------------------------------------------------------

def decompose_star(answer: str, trigger_question: Optional[str] = None) -> Optional[dict]:
    """Split an interview answer into situation / action / result.

    Returns {"situation": str, "action": str, "result": str}, or None when Gemini
    is unavailable or the response can't be used - the caller then stores the
    answer with the three fields left empty, exactly as before.
    """
    if _model is None or not answer.strip():
        return None

    context = f"질문: {trigger_question.strip()}\n" if trigger_question else ""
    prompt = f"""당신은 취업 준비를 돕는 커리어 코치입니다. 아래 경험 답변을 STAR 구조로 나눠 주세요.

{context}답변: {answer.strip()}

작성 지침:
- situation: 어떤 상황·배경이었는지
- action: 본인이 구체적으로 무엇을 했는지
- result: 그래서 어떤 결과·배움이 있었는지
- 답변에 없는 내용을 지어내지 마세요. 해당 내용이 답변에 없으면 빈 문자열("")로 두세요.
- 각 항목은 답변의 표현을 살려 한국어 서술문으로 쓰세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명이나 마크다운 없이 JSON만 출력하세요.
{{"situation": "...", "action": "...", "result": "..."}}
"""

    text = _generate_text(prompt)
    if not text:
        logger.info("[careerbank] Gemini STAR decomposition returned nothing")
        return None

    data = _try_parse_json(text)
    if not isinstance(data, dict):
        logger.info("[careerbank] Gemini STAR decomposition unparseable")
        return None

    result = {key: data.get(key) for key in ("situation", "action", "result")}
    cleaned = {
        key: value.strip() if isinstance(value, str) else "" for key, value in result.items()
    }
    if not any(cleaned.values()):
        return None
    return cleaned


# ---------------------------------------------------------------------------
# 3f. Free-form cover letter: pick experiences for a company, then write it
# ---------------------------------------------------------------------------

# A whole cover letter is the longest text we ask Gemini to write, so it gets its
# own budget. It still has to finish well inside the platform limit (vercel.json
# maxDuration) with room left for the experience-selection call that runs first.
GEMINI_FREE_ESSAY_TIMEOUT_SECONDS = float(
    os.getenv(
        "GEMINI_FREE_ESSAY_TIMEOUT_SECONDS",
        str(min(90.0, RESUME_IMPORT_PLATFORM_LIMIT_SECONDS * 0.5)),
    )
)

FREE_ESSAY_MIN_EXPERIENCES = 3
FREE_ESSAY_MAX_EXPERIENCES = 6
# Without a char limit, aim for a typical free-form cover letter length.
FREE_ESSAY_DEFAULT_LENGTH = "1200~1500자"


def free_essay_experience_count(total: int, char_limit: Optional[int]) -> int:
    """How many experiences to build on: about one per 350 chars, 3-6, never more than exist."""
    if total <= 0:
        return 0
    target = 4 if not char_limit else round(char_limit / 350)
    target = max(FREE_ESSAY_MIN_EXPERIENCES, min(FREE_ESSAY_MAX_EXPERIENCES, target))
    return min(target, total)


def _free_essay_header(company: str, position: Optional[str]) -> str:
    header = f"지원 회사: {company}"
    if position:
        header += f"\n지원 직무: {position}"
    return header


def _heuristic_experience_order(
    company: str, position: Optional[str], job_description: Optional[str], summaries: list[str]
) -> list[int]:
    query = " ".join(p for p in (company, position, _job_description_excerpt(job_description)) if p)
    scores = heuristic_match_scores(query, summaries)
    return sorted(range(len(summaries)), key=lambda i: (-scores[i], i))


def select_experiences_for_free_essay(
    company: str,
    position: Optional[str],
    job_description: Optional[str],
    experience_summaries: list[str],
    count: int,
) -> list[int]:
    """
    Indices (most relevant first) of the `count` experiences that best fit a cover
    letter for this company / posting. Never raises: falls back to keyword overlap.
    """
    total = len(experience_summaries)
    count = min(count, total)
    if count <= 0:
        return []

    fallback = _heuristic_experience_order(company, position, job_description, experience_summaries)
    # Using every experience anyway - only the order matters, no AI call needed.
    if count == total or _model is None:
        return fallback[:count]

    jd = _job_description_excerpt(job_description)
    jd_block = f"\n\n채용공고:\n{jd}" if jd else ""
    numbered = "\n".join(f"{i}. {s}" for i, s in enumerate(experience_summaries))

    prompt = f"""당신은 채용 자기소개서 컨설턴트입니다. 문항 없이 회사 정보만으로 쓰는 자유형식 자기소개서에
담을 경험을 고르려고 합니다. 아래 경험 목록에서 이 회사·직무{'·채용공고' if jd else ''}에 지원하는 자기소개서의 근거로
가장 적합한 경험을 정확히 {count}개 골라 주세요. 가능하면 서로 다른 강점을 보여주는 경험을 고르세요.

{_free_essay_header(company, position)}{jd_block}

경험 목록:
{numbered}

반드시 아래 JSON 형식으로만 응답하세요. 가장 적합한 순서대로 index를 나열하세요.
다른 설명이나 마크다운 없이 JSON만 출력하세요.
{{"indices": [0, 1, 2]}}
"""

    text = _generate_text(prompt)
    data = _try_parse_json(text) if text else None
    raw = data.get("indices") if isinstance(data, dict) else data if isinstance(data, list) else None

    picked: list[int] = []
    for value in raw or []:
        try:
            idx = int(value)
        except (TypeError, ValueError):
            continue
        if 0 <= idx < total and idx not in picked:
            picked.append(idx)
        if len(picked) == count:
            break

    if not picked:
        logger.info("[careerbank] Gemini free essay selection fallback (heuristic) triggered")
        return fallback[:count]
    # Top up from the heuristic order if Gemini returned fewer than asked.
    for idx in fallback:
        if len(picked) == count:
            break
        if idx not in picked:
            picked.append(idx)
    return picked


def _experience_lines(experiences: list[dict]) -> str:
    lines = []
    for i, exp in enumerate(experiences, start=1):
        title = (exp.get("title") or "").strip()
        situation = (exp.get("situation") or "").strip()
        action = (exp.get("action") or "").strip()
        result = (exp.get("result") or "").strip()
        head = f"[경험 {i}]" + (f" 활동: {title}" if title else "")
        if situation or action or result:
            body = f"상황: {situation or '(없음)'}\n행동: {action or '(없음)'}\n결과: {result or '(없음)'}"
        else:
            body = f"답변: {(exp.get('answer') or '').strip() or '(없음)'}"
        lines.append(f"{head}\n{body}")
    return "\n\n".join(lines)


def _fit_char_limit(text: str, char_limit: Optional[int]) -> str:
    """Cut to the limit at the last sentence end that fits, if Gemini overshoots."""
    if not char_limit or len(text) <= char_limit:
        return text
    cut = text[:char_limit]
    end = max(cut.rfind("다."), cut.rfind(". "), cut.rfind("요."))
    if end >= int(char_limit * 0.6):
        return cut[: end + 2].rstrip()
    return cut.rstrip()


def _fallback_free_essay(company: str, experiences: list[dict], char_limit: Optional[int]) -> str:
    """Template fallback: joins the chosen experiences between a short opening and closing."""
    paragraphs = [f"{company}에 지원하며, 제 경험 가운데 이 회사에서 의미 있게 쓰일 수 있는 것들을 정리했습니다."]
    for exp in experiences:
        parts = [(exp.get(k) or "").strip() for k in ("situation", "action", "result")]
        text = " ".join(p for p in parts if p) or (exp.get("answer") or "").strip()
        if text:
            paragraphs.append(text)
    paragraphs.append(f"이러한 경험을 바탕으로 {company}에서도 맡은 일에 책임감을 가지고 기여하겠습니다.")
    return _fit_char_limit("\n\n".join(paragraphs), char_limit)


def generate_free_essay_draft(
    company: str,
    position: Optional[str],
    job_description: Optional[str],
    char_limit: Optional[int],
    experiences: list[dict],
) -> tuple[Optional[str], Optional[str]]:
    """
    experiences: [{"title", "situation", "action", "result", "answer"}] already chosen.

    Returns (text, failure_reason):
      (text, None)      - Gemini wrote it
      (text, "no_ai")   - no key: template fallback text
      (None, "timeout") - gave up before the platform would kill the request
      (None, "error")   - Gemini failed or returned nothing usable
    """
    if _model is None:
        return _fallback_free_essay(company, experiences, char_limit), "no_ai"

    jd = _job_description_excerpt(job_description)
    jd_block = f"\n\n채용공고:\n{jd}" if jd else ""
    jd_guideline = (
        "- 채용공고의 핵심 키워드와 요구 역량이 경험과 연결되어 자연스럽게 드러나게 쓰세요. 키워드를 나열하지 마세요.\n"
        if jd
        else ""
    )
    length_guideline = (
        f"- 공백 포함 {char_limit}자를 절대 넘기지 말고, 가능하면 제한의 90% 이상 분량으로 쓰세요.\n"
        if char_limit
        else f"- 공백 포함 {FREE_ESSAY_DEFAULT_LENGTH} 내외로 쓰세요.\n"
    )

    prompt = f"""당신은 채용 자기소개서 작성을 돕는 전문 컨설턴트입니다. 따로 정해진 문항이 없는 자유형식 자기소개서를
아래 회사 정보와 지원자의 경험을 바탕으로 작성해 주세요.

{_free_essay_header(company, position)}{jd_block}

지원자의 경험:
{_experience_lines(experiences)}

작성 지침:
- 지원동기, 경험에서 드러난 강점과 역량, 입사 후 포부가 자연스럽게 이어지는 하나의 완결된 글로 쓰세요.
- 소제목, 번호, 항목 나열 없이 문단으로 이어지게 쓰세요.
- 위 경험들을 구체적인 근거로 활용하되, 경험에 없는 사실이나 수치를 지어내지 마세요.
{jd_guideline}{length_guideline}- 출력은 순수한 한국어 자기소개서 본문 텍스트만 작성하세요. JSON, 마크다운, 따옴표, 설명 문구를 절대 포함하지 마세요.
"""

    started = time.monotonic()
    text = _generate_text(prompt, timeout_seconds=GEMINI_FREE_ESSAY_TIMEOUT_SECONDS)
    elapsed = time.monotonic() - started
    if not text:
        timed_out = elapsed >= GEMINI_FREE_ESSAY_TIMEOUT_SECONDS * 0.9
        logger.info(
            "[careerbank] Gemini free essay draft produced nothing after %.1fs (%s)",
            elapsed,
            "timeout" if timed_out else "error",
        )
        return None, "timeout" if timed_out else "error"

    cleaned = _strip_code_fences(text).strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] == '"':
        cleaned = cleaned[1:-1].strip()
    if not cleaned:
        return None, "error"
    return _fit_char_limit(cleaned, char_limit), None
