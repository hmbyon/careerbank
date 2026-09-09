# CareerBank (경험은행) — Implementation Spec

This is a full-stack implementation of a school mini-project design (요구사항정의서/화면설계서/API명세서/DB설계서 already finalized as documentation). Now we are building the REAL, working, deployable app from that spec. This file is the single source of truth handed to both the backend and frontend builders — read it fully before writing any code.

Project name: 경험은행 (CareerBank) — an experience-management + AI-matching web app for writing self-introduction essays (자소서). Users log activities on a timeline, get AI-guided interview questions to extract structured "experiences" (situation/action/result) from each activity, then when they paste in an essay question, the AI matches their best-fitting experiences and drafts an essay from them.

Stack (decided by the project owner):
- Backend: FastAPI (Python)
- DB: PostgreSQL in production (use `DATABASE_URL` env var), SQLite fallback for local dev if `DATABASE_URL` is unset (use SQLAlchemy so both work transparently)
- Frontend: Next.js (React, TypeScript), App Router
- AI: Google **Gemini API** (free tier) — NOT OpenAI/Claude. Use the `google-generativeai` Python package. Model name must be read from `GEMINI_MODEL` env var, default `"gemini-2.0-flash"`.
- Deployment target: real internet deployment, not local-only. Backend → Render (or any Docker host with a free tier). DB → Neon or Supabase free Postgres. Frontend → Vercel. Must be genuinely deployable with free tiers only.
- Auth: simple JWT bearer auth (the original spec explicitly excludes security-scheme detail as "out of grading scope", so keep it simple but real: bcrypt password hashing, JWT access token, no refresh-token complexity needed).

## 1. Data model (DB) — 6 tables

### users
- id (PK, bigint/serial)
- email (unique, not null)
- password_hash (not null)
- name (not null)
- created_at (not null, default now)

### timeline_entries
- id (PK)
- user_id (FK -> users.id, not null)
- category (enum `activity_category`: EDUCATION, CAREER, ACTIVITY, CERTIFICATE) not null
- title (varchar, not null) — e.g. "SKALA", "OO대학교 경영학과"
- start_date (date, not null)
- end_date (date, nullable — null means "in progress")
- created_at (not null)
- updated_at (nullable)

### timeline_items
- id (PK)
- timeline_entry_id (FK -> timeline_entries.id, not null)
- title (varchar, not null, max 30 chars) — e.g. class name, team project name, job title
- created_at (not null)

### sub_experiences
- id (PK)
- timeline_entry_id (FK -> timeline_entries.id, not null — always set)
- timeline_item_id (FK -> timeline_items.id, nullable — null means interview happened at timeline level, not item level)
- category (enum `experience_category`, 16 values — see below) not null
- trigger_question (varchar, not null) — the actual AI question asked (for traceability)
- answer (text, not null) — the user's raw answer
- situation (text, nullable) — editable afterwards
- action (text, nullable)
- result (text, nullable)
- created_at (not null)
- updated_at (nullable)

### essay_questions
- id (PK)
- user_id (FK -> users.id, not null)
- question_text (varchar, not null, max 1000 chars)
- char_limit (integer, nullable)
- company (varchar, nullable)
- position (varchar, nullable)
- draft_text (text, nullable) — AI-generated / user-edited final draft
- created_at (not null)
- updated_at (nullable)

### matches
- id (PK)
- sub_experience_id (FK -> sub_experiences.id, not null)
- essay_question_id (FK -> essay_questions.id, not null)
- relevance_score (decimal(5,2), not null) — 0-100
- confirmed (boolean, not null, default false) — only confirmed=true matches feed into draft generation
- created_at (not null)
- UNIQUE (sub_experience_id, essay_question_id)

### Enums

`activity_category`: EDUCATION(학력), CAREER(경력), ACTIVITY(대외활동), CERTIFICATE(자격증)

`experience_category` (16 values, used both as AI-interview category tags and as the experience-store filter):
COLLABORATION(협력·팀워크), LEADERSHIP(리더십), COMMUNICATION(대인관계·소통), INITIATIVE(도전정신·실행력), RESPONSIBILITY(책임감·성실성), PROBLEM_SOLVING(문제해결력), RESILIENCE(실패극복·회복탄력성), GOAL_MANAGEMENT(목표관리·추진력), VALUES_ETHICS(가치관·윤리의식), SELF_INITIATIVE(자기주도성), CREATIVITY(창의성·문제인식), TECHNICAL_SKILL(직무 전문성/기술 습득), PERFORMANCE(성과·수치화된 결과), PROJECT_MANAGEMENT(프로젝트/일정 관리), DATA_DRIVEN(데이터·분석 기반 의사결정), STAKEHOLDER(고객/이해관계자 대응)

Relationships: users 1:N timeline_entries; users 1:N essay_questions; timeline_entries 1:N timeline_items; timeline_entries 1:N sub_experiences; timeline_items 1:N sub_experiences (nullable FK); sub_experiences 1:N matches; essay_questions 1:N matches. Deleting a sub_experience cascades to delete its matches.

## 2. API endpoints (18 total) — implement exactly these, under prefix `/api`

Auth: all endpoints except signup/login require `Authorization: Bearer <jwt>`; resolve `current_user` from it. 401 if missing/invalid/expired.

| Method | Path | Notes |
|---|---|---|
| POST | /auth/signup | body: name, email, password(≥6 chars). 201→User(no password). 400 invalid. 409 email exists. |
| POST | /auth/login | body: email, password. 200→{access_token, user}. 401 mismatch. |
| GET | /dashboard/summary | → {timeline_count, experience_count, essay_question_count} for current user |
| GET | /timelines | → list grouped implicitly (frontend groups by category); only categories with ≥1 item are meaningful but return flat list with category field, newest first within category |
| POST | /timelines | body: category, title(≤50), start_date, end_date(nullable). start_date ≤ end_date if both present. 201 |
| PUT | /timelines/{id} | same body, must belong to current_user. 404 if not found/not owned. 200 |
| GET | /timelines/{id}/items | list items for a timeline |
| POST | /timelines/{id}/items | body: title (≤30 chars, required). 201 |
| GET | /interview/question | query: timeline_id (required), item_id (optional). Generates next AI interview question via Gemini using context (timeline title/category, item title if any, and the list of experience_category values NOT yet asked in this context, so it doesn't repeat categories). If all 16 categories already have an answer for this exact context (timeline_id+item_id combo), return 200 with `question: null` (signals "질문 소진" to the frontend). On Gemini failure, fall back to a canned default question for a category chosen round-robin. Response: {category, question} |
| POST | /interview/answer | body: timeline_id, item_id(nullable), category, trigger_question, answer(required, non-empty). Saves a sub_experience row. Then computes and returns the NEXT question (same logic as GET /interview/question) in the same response so the frontend doesn't need 2 calls. 201. Response: {saved: SubExperience, next_question: {category, question} | null} |
| GET | /experiences | query: category(optional, one of the 16 enum values or omitted=all). List current user's sub_experiences, newest first |
| PUT | /experiences/{id} | body: category, situation, action, result — all required non-empty. must belong to current_user. 404 if not found. 200 |
| DELETE | /experiences/{id} | also deletes dependent matches. 204 |
| GET | /essay-questions | list current user's essay questions with a computed `status`: "매칭완료" if draft_text is not null/empty, else "매칭대기" |
| POST | /essay-questions | body: question_text(required,≤1000), char_limit(optional int), company(optional), position(optional). Creates the row, THEN immediately runs the matching algorithm (see below) and stores Match rows. 201→EssayQuestion. (409 only as a soft warning if identical question_text already exists for this user — still create it, just include a `warning` field in the response, per spec "경고만, 등록은 허용") |
| GET | /essay-questions/{id}/matches | must belong to current_user. If no Match rows exist yet for this essay_question, run matching now (lazy) then return. Returns list of {match_id, sub_experience: {...}, relevance_score, confirmed}, sorted by relevance_score desc. Must respond within a few seconds — if Gemini is slow, fall back to a simple heuristic scorer (see below) so the endpoint never hangs. |
| PUT | /matches/{id}/confirm | toggles/sets confirmed=true for a match belonging to current_user's essay question. 200→Match |
| POST | /essay-questions/{id}/draft | Uses all matches with confirmed=true for this essay_question, generates a draft essay via Gemini (respecting char_limit if set), saves to essay_questions.draft_text, returns the updated EssayQuestion. If zero confirmed matches, 400. |
| PUT | /essay-questions/{id}/draft | body: draft_text(required). Saves user-edited text as final. 200 |

Error shape: `{"detail": "human readable message"}` matching FastAPI's default — frontend reads `.detail`.

Common status codes across the app (see 부록 공통 예외 처리 in the design doc, already implemented via the above): 200/201/204 success, 400 validation, 401 auth, 404 not found/not owned, 409 conflict (soft, informational only), 500 server error → generic message.

## 3. AI logic — Gemini integration

Create one module `app/services/gemini.py` wrapping `google.generativeai`. Read `GEMINI_API_KEY` and `GEMINI_MODEL` (default `gemini-2.0-flash`) from env. All Gemini calls must be wrapped in try/except with a short timeout and fall back gracefully — NEVER let a Gemini failure 500 the whole request when a reasonable fallback exists (see below for each use).

### 3a. Interview question generation (GET/POST interview endpoints)
Prompt Gemini with: the timeline's category+title, the item title (if any), the list of experience_category labels already asked in this context, and ask it to (a) pick ONE experience_category from the remaining unused ones that best fits this context, and (b) write ONE natural, specific, Korean interview question (like a friendly career coach) that would elicit a concrete STAR-style (situation/action/result) story for that category, referencing the activity/item name naturally. Ask Gemini to return strict JSON: `{"category": "<ONE_OF_THE_ENUM_VALUES>", "question": "<Korean question text>"}`. Parse and validate the category is one of the 16 valid enum values and not already used; if parsing/validation fails or the call errors, fall back to: pick the first unused category in a fixed order, and use a hardcoded default question template per category (write natural Korean questions for all 16, e.g. COLLABORATION → "이 활동에서 다른 사람과 협력하며 목표를 이뤘던 순간이 있다면 이야기해 주세요.", etc. — write a genuinely usable default for all 16, not placeholders).

If all 16 categories already used for this timeline_id+item_id context → return `question: null`.

### 3b. Matching (GET /essay-questions/{id}/matches, lazy-generate)
For the user's essay question (question_text + company + position if given) against ALL of that user's sub_experiences (using situation/action/result if present, else the raw answer + trigger_question), ask Gemini to score relevance 0-100 for each. To keep this efficient and within free-tier rate limits, batch ALL experiences into a SINGLE Gemini call: send the essay question plus a numbered list of experience summaries, ask for strict JSON array `[{"index": <n>, "score": <0-100>}, ...]`. Parse and map back to sub_experience ids; create Match rows (skip if a Match already exists for that pair — respect the unique constraint). If Gemini fails/times out or the user has 0 experiences, fall back to a simple heuristic: keyword-overlap scoring (lowercased token overlap between essay question_text and each experience's situation+action+result+answer, normalized to 0-100), so the endpoint always returns something.

### 3c. Draft generation (POST /essay-questions/{id}/draft)
Send Gemini the essay question_text (+ company/position if present) and the confirmed experiences' situation/action/result (STAR), ask it to write a natural, coherent Korean self-introduction essay answer using those experiences, respecting char_limit if set (aim to stay under it; mention in the prompt). Strict output: plain Korean essay text only, no JSON, no markdown, no preamble. If Gemini fails, fall back to a simple template that concatenates the confirmed experiences' situation/action/result into a readable paragraph (still usable, just not AI-polished) so this endpoint never hard-fails when there's at least 1 confirmed match.

Keep all Gemini prompt strings in Korean (matching the product's language) with clear instructions to respond ONLY with the requested format (JSON or plain text as specified) so parsing is reliable — always defensively strip markdown code fences (```json ... ```) before parsing JSON, since Gemini sometimes wraps output that way.

## 4. Non-functional / cross-cutting
- CORS: allow the frontend origin from `FRONTEND_URL` env var (default `http://localhost:3000`).
- All list endpoints scoped to `current_user` — never leak another user's data (double check ownership on every by-id lookup: 404, not 403, if not owned — matches the design doc's "대상 없음/404" pattern).
- Passwords: bcrypt via `passlib[bcrypt]`.
- JWT: `python-jose[cryptography]`, secret from `JWT_SECRET` env var (generate a fallback random one at startup ONLY for local dev convenience, but require it be set in production — document this).
- DB: SQLAlchemy 2.x models + Alembic-free approach is fine for this project size — just call `Base.metadata.create_all(engine)` on startup (simplicity over migrations, this is a student project).
- Use SQLAlchemy's engine URL: if `DATABASE_URL` starts with `postgres://`, rewrite to `postgresql+psycopg2://` (Render/Heroku-style URLs need this fix) or use `postgresql+psycopg://` with psycopg3 — pick one driver and add it to requirements.txt consistently.
- Provide `requirements.txt`, a `Dockerfile`, and a `render.yaml` (or at least clear deploy instructions) for one-click-ish deployment on Render with env vars: `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `FRONTEND_URL`.
- Provide `.env.example`.
- Add a `/health` endpoint (GET, no auth) returning `{"status":"ok"}` for uptime checks / Render health checks.
- Write a `backend/README.md` covering: local run instructions (venv, pip install, uvicorn), and step-by-step deployment to Render + a free Postgres (Neon) + how to get a free Gemini API key (Google AI Studio, https://aistudio.google.com/apikey).

## 5. Frontend (Next.js, TypeScript, App Router, Tailwind CSS)

Screens to build (13 screens from the 화면설계서, IDs in parens). Keep styling clean and simple (Tailwind utility classes) — doesn't need to be pixel-identical to the wireframes, just structurally faithful and usable.

1. `/login` (SCR-AUTH-001): email, password, login button, link to signup. On success store JWT + redirect to /dashboard.
2. `/signup` (SCR-AUTH-002): name, email, password, password confirm (client-side match check), submit → on success redirect to /login with a success message.
3. `/dashboard` (SCR-HOME-001): 3 summary cards (timelines/experiences/essay questions counts) from GET /dashboard/summary, + 3 nav buttons to timelines/experiences/essay-questions.
4. `/timelines` (SCR-TML-001): grouped by category (only non-empty groups shown), timeline cards (title+period), "등록" button → /timelines/new, each card click → /timelines/[id]/edit, "세부항목" button per card → /timelines/[id]/items.
5. `/timelines/new` and `/timelines/[id]/edit` (SCR-TML-002): category dropdown, title, start/end date, save.
6. `/timelines/[id]/items` (SCR-TML-003): add-item input (Enter to submit), list of item cards each with an "인터뷰" button → `/interview?timelineId=X&itemId=Y`, plus a "세부항목 없이 인터뷰" link → `/interview?timelineId=X`.
7. `/interview` (SCR-INTV-001, reads timelineId/itemId from query string): context badge, current AI question, answer textarea, submit button (POST answer, then load the `next_question` from the response into the same view — loop), "인터뷰 종료" button → /experiences. When `question`/`next_question` comes back null, show "더 물어볼 게 없어요" and a button to go to /experiences.
8. `/experiences` (SCR-EXP-001): category filter dropdown (all 16 + "전체"), experience cards (category badge, source timeline name, Q+A summary) → click → `/experiences/[id]`.
9. `/experiences/[id]` (SCR-EXP-002): category dropdown, situation/action/result textareas, save button, delete button (confirm popup) → back to /experiences.
10. `/essay-questions` (SCR-ESSAY-001): "등록" button → /essay-questions/new, question cards (text summary, company/position, 매칭완료/매칭대기 badge) → `/essay-questions/[id]/matches`.
11. `/essay-questions/new` (SCR-ESSAY-002): question_text textarea, char_limit number input, company, position, submit → on success go to `/essay-questions/[id]/matches`.
12. `/essay-questions/[id]/matches` (SCR-MATCH-001): question text shown at top, ranked experience cards (category, relevance %, summary, "확정" toggle button), "초안 생성" button (disabled until ≥1 confirmed) → POST draft then go to `/essay-questions/[id]/draft`.
13. `/essay-questions/[id]/draft` (SCR-MATCH-002): editable textarea with the draft, live character count vs char_limit (red warning if over, but save still allowed), "다시 생성" button (confirm popup if there are unsaved edits), "저장" button → PUT draft, then back to /essay-questions.

Cross-cutting frontend requirements:
- `lib/api.ts`: a small fetch wrapper that reads `NEXT_PUBLIC_API_URL` env var, attaches `Authorization: Bearer <token>` from a simple auth context/localStorage, and throws a typed error with the backend's `.detail` message on non-2xx responses.
- Simple `AuthContext`/hook storing the JWT + current user in localStorage; a route guard (redirect to /login) for all pages except /login and /signup.
- Root layout with a simple top nav (visible when logged in) linking to dashboard/timelines/experiences/essay-questions + logout.
- Handle loading states (simple spinners/skeletons) and empty states (the friendly Korean messages specified in the design doc's exception tables — reuse that language for a polished feel, e.g. "아직 등록된 타임라인이 없어요. 첫 활동을 등록해보세요.").
- `.env.local.example` with `NEXT_PUBLIC_API_URL=http://localhost:8000/api`.
- Provide `frontend/README.md`: local run (`npm install && npm run dev`) and deployment to Vercel (import repo, set `NEXT_PUBLIC_API_URL` to the deployed backend URL as an env var).

## 6. Deliverable layout

```
careerbank/
  SPEC.md              (this file)
  backend/             (FastAPI app — see below)
  frontend/            (Next.js app)
  README.md            (top-level: what this is, how the two halves connect, full deploy walkthrough — written last, after both halves exist)
```

Backend internal layout suggestion:
```
backend/
  app/
    main.py            (FastAPI() app, CORS, include routers, create_all, /health)
    database.py         (engine/session/Base, DATABASE_URL handling)
    models.py            (SQLAlchemy models for all 6 tables + 2 enums)
    schemas.py           (Pydantic models for requests/responses)
    security.py           (password hashing, JWT create/verify, get_current_user dependency)
    routers/
      auth.py, dashboard.py, timelines.py, interview.py, experiences.py, essay_questions.py, matches.py
    services/
      gemini.py           (all 3 Gemini use-cases + fallbacks)
      matching.py          (heuristic fallback scorer)
  requirements.txt
  Dockerfile
  render.yaml
  .env.example
  README.md
```

Build BOTH halves for real — actual working code, not stubs. This is meant to be run and deployed, not just scaffolding. Prioritize correctness of the endpoints/flows above all; keep the UI functional and clean rather than elaborate.
