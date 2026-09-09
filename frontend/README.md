# 경험은행 (CareerBank) — Frontend

Next.js (App Router, TypeScript, Tailwind CSS) frontend for CareerBank. Talks to the FastAPI
backend in `../backend` over the REST API described in `../SPEC.md` (section 2).

## Screens

All 13 screens from the spec are implemented:

| Route | Screen |
|---|---|
| `/login` | 로그인 |
| `/signup` | 회원가입 |
| `/dashboard` | 대시보드 (요약 카드 3종) |
| `/timelines` | 타임라인 목록 (카테고리별 그룹) |
| `/timelines/new`, `/timelines/[id]/edit` | 타임라인 등록/수정 |
| `/timelines/[id]/items` | 세부항목 목록 + 등록 |
| `/interview?timelineId=&itemId=` | AI 인터뷰 (질문 → 답변 → 다음 질문 루프) |
| `/experiences` | 경험 저장소 (카테고리 필터) |
| `/experiences/[id]` | 경험 상세 (S/A/R 수정, 삭제) |
| `/essay-questions` | 자소서 문항 목록 |
| `/essay-questions/new` | 자소서 문항 등록 |
| `/essay-questions/[id]/matches` | 매칭된 경험 목록 + 확정 |
| `/essay-questions/[id]/draft` | 초안 확인/수정/재생성/저장 |

## Local development

Requires Node.js 18.18+ (Node 20+ recommended).

```bash
npm install
cp .env.local.example .env.local
# edit .env.local so NEXT_PUBLIC_API_URL points at your locally running backend,
# e.g. http://localhost:8000/api (see ../backend/README.md to start it)
npm run dev
```

Open http://localhost:3000 — you'll land on `/login` if you're not signed in yet. Use
`/signup` to create an account first.

If the backend isn't running, pages will load and show a friendly error/loading state instead of
crashing (all API calls go through `lib/api.ts`, which surfaces the backend's error message or a
"서버에 연결할 수 없어요" message on network failure).

### Build

```bash
npm run build
npm run start   # serve the production build locally
```

## Environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of the backend API, **including** the `/api` prefix (e.g. `http://localhost:8000/api` locally, `https://your-backend.onrender.com/api` in production). |

See `.env.local.example`.

## Deploying to Vercel

1. Push this repo (or just the `frontend/` folder, if you deploy it as its own Vercel project)
   to GitHub/GitLab/Bitbucket.
2. In the [Vercel dashboard](https://vercel.com/new), import the repository.
   - If the whole monorepo (`careerbank/`) is imported, set the Vercel project's
     **Root Directory** to `frontend`.
   - Framework preset: Next.js (auto-detected).
3. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_API_URL` = the URL of your deployed backend (from `../backend`'s Render
     deployment), including the `/api` prefix, e.g.
     `https://careerbank-backend.onrender.com/api`.
4. Deploy. Vercel builds with `npm run build` and serves the app.
5. Once you have the Vercel URL, make sure the backend's `FRONTEND_URL` env var (CORS) is set to
   it so the browser can call the API — see `../backend/README.md`.

Every subsequent push to the connected branch redeploys automatically. If you change
`NEXT_PUBLIC_API_URL` in the Vercel dashboard, trigger a redeploy for it to take effect (it's
baked in at build time, since it's a `NEXT_PUBLIC_*` variable).

## Project structure

```
app/
  layout.tsx              root layout (AuthProvider)
  page.tsx                "/" - redirects to /dashboard or /login
  (auth)/login/           /login (no nav)
  (auth)/signup/          /signup (no nav)
  (app)/layout.tsx        route-guarded layout with the top nav (redirects to /login if signed out)
  (app)/dashboard/        /dashboard
  (app)/timelines/...     /timelines, /timelines/new, /timelines/[id]/edit, /timelines/[id]/items
  (app)/interview/        /interview
  (app)/experiences/...   /experiences, /experiences/[id]
  (app)/essay-questions/  /essay-questions, .../new, .../[id]/matches, .../[id]/draft
components/                shared UI: NavBar, Spinner, EmptyState, ErrorBanner, ConfirmDialog, TimelineForm
contexts/AuthContext.tsx   localStorage-backed auth state (JWT + user), auto-logout on 401
lib/api.ts                 fetch wrapper (Bearer auth, typed ApiError reading `.detail`) + one function per endpoint
lib/types.ts                shared TypeScript types matching the API contract
lib/constants.ts            the 4 activity categories and 16 experience categories (enum value → Korean label)
```

## Notes on the API contract

- `lib/api.ts` attaches `Authorization: Bearer <token>` from `localStorage` to every request, and
  throws `ApiError` (with `.status` and `.message` = the backend's `.detail`) on non-2xx
  responses.
- A handful of screens need data the API doesn't expose a single-resource GET for (e.g. a single
  timeline, or the essay-question text shown above its match list) — for those, the frontend
  fetches the relevant list endpoint (`GET /timelines`, `GET /essay-questions`) and finds the item
  by id client-side, rather than inventing new backend endpoints.
- `POST /essay-questions` is treated as successful on both a 2xx response and on `409` (per the
  spec, a duplicate `question_text` is only a soft, informational warning — the row is still
  created either way); if the response includes a `warning` field it's shown to the user.
