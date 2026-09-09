# 경험은행 (CareerBank)

자소서(자기소개서)를 쓸 때 놓치기 쉬운 경험을 AI 유도 질문으로 끌어내어 저장하고, 자소서 문항이 들어오면 저장된 경험 중 가장 잘 맞는 것을 AI가 매칭·추천해 초안까지 생성해주는 서비스입니다.

SKALA 판교5반 · 혜민 (개인별코드 P152) 미니프로젝트의 기획·설계 문서(`요구사항정의서`, `화면설계서`, `API 명세서`, `DB 설계서`)를 실제로 구현·배포 가능한 풀스택 앱으로 만든 결과물입니다. 설계 원문은 `SPEC.md`에 정리되어 있습니다.

## 구성

```
careerbank/
  SPEC.md      전체 구현 스펙 (DB 스키마, API 18개, AI 로직, 화면 13개) — 백엔드/프론트엔드 모두 이 문서 기준으로 구현됨
  backend/     FastAPI 백엔드 — 자세한 내용은 backend/README.md
  frontend/    Next.js 프론트엔드 — 자세한 내용은 frontend/README.md
```

- **Backend**: FastAPI + SQLAlchemy(SQLite 로컬 / PostgreSQL 배포), JWT 인증, Google **Gemini API**로 AI 인터뷰 질문 생성·경험 매칭·초안 생성 — Gemini 키가 없어도 모든 기능이 폴백 로직으로 정상 동작합니다.
- **Frontend**: Next.js(App Router) + TypeScript + Tailwind CSS, 화면설계서의 13개 화면을 모두 구현.
- 두 파트는 `backend`가 `/api/*` 로 노출하는 REST API로만 통신합니다 (`SPEC.md` 2번 항목이 정확한 계약).
- 로컬에서 두 서버를 함께 띄워 회원가입→로그인→타임라인 등록→세부항목→AI 인터뷰→경험 저장→자소서 문항 등록→매칭→확정→초안 생성/저장까지 전체 플로우를 통합 테스트로 이미 검증했습니다.

## 로컬에서 빠르게 실행하기

터미널 두 개를 열어 각각 실행하세요.

```bash
# 1) 백엔드
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # 필요하면 GEMINI_API_KEY 등 채워넣기 (없어도 동작함)
uvicorn app.main:app --reload --port 8000
```

```bash
# 2) 프론트엔드
cd frontend
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000/api
npm run dev
```

브라우저에서 http://localhost:3000 접속 → `/signup`으로 계정 생성 → 바로 사용 가능합니다.

무료 Gemini API 키는 https://aistudio.google.com/apikey 에서 발급받아 `backend/.env`의 `GEMINI_API_KEY`에 넣으면 AI 인터뷰 질문/매칭/초안 생성이 실제 Gemini 응답으로 동작합니다 (키가 없어도 폴백으로 전부 작동은 합니다).

## 무료로 실제 인터넷에 배포하기 (권장 조합)

목표: 어디서든 접속 가능한 실제 서비스, 비용 없이. 아래 3개 무료 서비스 조합을 사용합니다.

| 레이어 | 서비스 | 이유 |
|---|---|---|
| DB (PostgreSQL) | **Neon** (neon.tech) | 무료 티어가 90일 만료 없이 영구적으로 유지됨 (Render 자체 무료 Postgres는 90일 후 삭제됨) |
| 백엔드 (FastAPI) | **Render** (render.com) | Dockerfile 기반 무료 웹 서비스, `backend/render.yaml`로 원클릭에 가깝게 배포 가능 |
| 프론트엔드 (Next.js) | **Vercel** (vercel.com) | Next.js 공식 배포처, 무료 티어로 충분 |
| AI | **Gemini API** (Google AI Studio) | 무료 티어 존재 |

순서 (자세한 단계는 `backend/README.md`, `frontend/README.md`에 각각 스크린샷 없이 텍스트로 정리되어 있음):

1. 이 프로젝트를 GitHub 저장소로 푸시.
2. **Neon**에서 무료 프로젝트 생성 → PostgreSQL 연결 문자열 복사.
3. **Google AI Studio**(https://aistudio.google.com/apikey)에서 무료 Gemini API 키 발급.
4. **Render**에서 New → Blueprint로 저장소 연결 후 `backend/render.yaml` 선택 → 환경변수(`DATABASE_URL`=Neon 연결 문자열, `GEMINI_API_KEY`, `FRONTEND_URL`=아직 모르면 임시로 비워두고 나중에 업데이트) 입력 → 배포. 배포 완료 후 나온 URL(예: `https://careerbank-backend.onrender.com`)을 기억해두기.
5. **Vercel**에서 New Project로 저장소 연결, Root Directory를 `frontend`로 지정 → 환경변수 `NEXT_PUBLIC_API_URL` = `https://careerbank-backend.onrender.com/api` (4번에서 얻은 URL + `/api`) 입력 → 배포.
6. 배포된 Vercel URL(예: `https://careerbank.vercel.app`)을 다시 **Render**의 백엔드 환경변수 `FRONTEND_URL`에 넣고 재배포 (CORS 허용을 위해 필요).
7. Vercel URL로 접속해서 회원가입부터 끝까지 테스트.

무료 티어 특성상 Render 백엔드는 일정 시간 요청이 없으면 슬립 상태가 되고, 슬립 이후 첫 요청은 몇십 초 정도 느릴 수 있습니다(콜드 스타트) — 무료로 상시 배포할 때 감수해야 하는 부분입니다.

## 다음에 더 하고 싶다면

- Render 무료 플랜의 슬립/콜드스타트가 거슬리면 유료 플랜으로 전환하거나, Fly.io 등 다른 무료/저가 호스팅으로 옮길 수 있습니다.
- 인증을 소셜 로그인(Google 등)으로 확장하거나, 리프레시 토큰을 추가해 세션을 더 오래 유지할 수 있습니다.
- 이력서 PDF 내보내기 등 설계 단계에서 범위 밖으로 남겨둔 기능을 추가할 수 있습니다.

---
*판교5-P152-혜민 · 경험은행(CareerBank)*
