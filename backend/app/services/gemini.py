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
from typing import Optional

from app.models import EXPERIENCE_CATEGORY_ORDER

logger = logging.getLogger("careerbank.gemini")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip() or "gemini-2.0-flash"
GEMINI_TIMEOUT_SECONDS = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "15"))
# Resume import sends a whole document and asks for structured JSON back, which
# routinely takes longer than the short interactive calls the default is sized for.
GEMINI_IMPORT_TIMEOUT_SECONDS = float(
    os.getenv("GEMINI_IMPORT_TIMEOUT_SECONDS", str(max(GEMINI_TIMEOUT_SECONDS, 90)))
)

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


def _tokenize(text: str) -> set[str]:
    return set(_TOKEN_RE.findall((text or "").lower()))


def heuristic_match_scores(question_text: str, experience_summaries: list[str]) -> list[float]:
    """
    Simple keyword-overlap fallback scorer: lowercased token overlap between the
    essay question text and each experience's combined text, normalized to 0-100.
    """
    q_tokens = _tokenize(question_text)
    scores = []
    for summary in experience_summaries:
        e_tokens = _tokenize(summary)
        if not q_tokens or not e_tokens:
            scores.append(0.0)
            continue
        overlap = q_tokens & e_tokens
        # Normalize by the smaller set so short answers aren't unfairly punished,
        # then scale to 0-100.
        denom = min(len(q_tokens), len(e_tokens)) or 1
        ratio = len(overlap) / denom
        scores.append(round(min(ratio, 1.0) * 100, 2))
    return scores


def batch_match_scores(
    question_text: str,
    company: Optional[str],
    position: Optional[str],
    experience_summaries: list[str],
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

        prompt = f"""당신은 채용 자기소개서 컨설턴트입니다. 아래 자기소개서 문항과, 지원자가 겪은 여러 경험 목록이
주어집니다. 각 경험이 이 문항에 답하기에 얼마나 적합한지 0~100 사이의 점수로 평가해 주세요.
(100 = 이 문항의 답변으로 매우 적합, 0 = 전혀 관련 없음)

{header}

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

        prompt = f"""당신은 채용 자기소개서 작성을 돕는 전문 컨설턴트입니다. 아래 자기소개서 문항과 지원자의
경험(상황-행동-결과)들을 활용하여, 자연스럽고 설득력 있는 한국어 자기소개서 답변을 작성해 주세요.

{header}

지원자의 경험:
{exp_block}

작성 지침:
- 위 경험들을 자연스럽게 녹여서 하나의 완결된 글로 작성하세요.
- 문항의 의도에 맞게 답변하세요.
- 글자 수 제한이 있다면 반드시 지키도록 노력하세요.
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


def extract_resume_fields(raw_text: str) -> Optional[dict]:
    """Structure an uploaded resume's text into our resume schema.

    Returns the parsed dict, or None when Gemini is unavailable / the response
    can't be parsed - the caller falls back to handing the raw text back.
    """
    if _model is None or not raw_text.strip():
        return None

    # Long resumes get truncated: the tail is rarely the structured part.
    excerpt = raw_text.strip()[:12000]

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

    text = _generate_text(prompt, timeout_seconds=GEMINI_IMPORT_TIMEOUT_SECONDS)
    if not text:
        logger.info("[careerbank] Gemini resume import returned nothing")
        return None

    data = _try_parse_json(text)
    if not isinstance(data, dict) or not isinstance(data.get("content"), dict):
        logger.info("[careerbank] Gemini resume import response unparseable")
        return None
    return data
