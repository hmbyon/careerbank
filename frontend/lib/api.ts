import type {
  AdminUser,
  Application,
  ApplicationDetail,
  AuthResponse,
  DashboardSummary,
  EssayQuestion,
  ExperienceCategory,
  Feedback,
  FeedbackCategory,
  FeedbackStatus,
  FreeEssay,
  FreeEssayDetail,
  InterviewAnswerResponse,
  InterviewQuestion,
  MatchItem,
  MatchRecord,
  Resume,
  ResumeContent,
  ResumeImport,
  SubExperience,
  TimelineEntry,
  TimelineItem,
  User,
} from "./types";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(
  /\/+$/,
  ""
);

const TOKEN_KEY = "cb_token";

/** Typed error thrown by the fetch wrapper. `message` is the backend's `.detail`. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage unavailable (private mode, etc.) - ignore, session just won't persist.
  }
}

function extractDetail(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as Record<string, unknown>).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      // FastAPI/pydantic validation error shape: [{msg: string, ...}, ...]
      const msgs = detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as Record<string, unknown>).msg) : String(d)))
        .filter(Boolean);
      if (msgs.length) return msgs.join(" / ");
    }
  }
  return fallback;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Extra status codes (besides 2xx) that should be treated as success. */
  extraOkStatuses?: number[];
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "서버에 연결할 수 없어요. 잠시 후 다시 시도해주세요.");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  const okStatuses = options.extraOkStatuses || [];
  const isOk = res.ok || okStatuses.includes(res.status);

  if (!isOk) {
    if (res.status === 401 && token) {
      // We *had* a token and the server rejected it -> session is invalid/expired.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("cb:unauthorized"));
      }
    }
    throw new ApiError(res.status, extractDetail(data, "요청 중 오류가 발생했어요."));
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function signup(name: string, email: string, password: string): Promise<User> {
  return request<User>("/auth/signup", { method: "POST", body: { name, email, password } });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", { method: "POST", body: { email, password } });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function getDashboardSummary(): Promise<DashboardSummary> {
  return request<DashboardSummary>("/dashboard/summary");
}

// ---------------------------------------------------------------------------
// Timelines
// ---------------------------------------------------------------------------

export function getTimelines(): Promise<TimelineEntry[]> {
  return request<TimelineEntry[]>("/timelines");
}

export interface TimelineInput {
  category: string;
  title: string;
  start_date: string;
  end_date: string | null;
}

export function createTimeline(body: TimelineInput): Promise<TimelineEntry> {
  return request<TimelineEntry>("/timelines", { method: "POST", body });
}

export function updateTimeline(id: number, body: TimelineInput): Promise<TimelineEntry> {
  return request<TimelineEntry>(`/timelines/${id}`, { method: "PUT", body });
}

export function deleteTimeline(id: number): Promise<void> {
  return request<void>(`/timelines/${id}`, { method: "DELETE" });
}

export function getTimelineItems(timelineId: number): Promise<TimelineItem[]> {
  return request<TimelineItem[]>(`/timelines/${timelineId}/items`);
}

export function createTimelineItem(timelineId: number, title: string): Promise<TimelineItem> {
  return request<TimelineItem>(`/timelines/${timelineId}/items`, {
    method: "POST",
    body: { title },
  });
}

export function updateTimelineItem(
  timelineId: number,
  itemId: number,
  title: string
): Promise<TimelineItem> {
  return request<TimelineItem>(`/timelines/${timelineId}/items/${itemId}`, {
    method: "PUT",
    body: { title },
  });
}

export function deleteTimelineItem(timelineId: number, itemId: number): Promise<void> {
  return request<void>(`/timelines/${timelineId}/items/${itemId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Interview
// ---------------------------------------------------------------------------

export function getInterviewQuestion(
  timelineId: number,
  itemId?: number | null,
  /** Categories skipped in this session; the server won't pick them again. */
  skipCategories?: ExperienceCategory[]
): Promise<InterviewQuestion> {
  const params = new URLSearchParams();
  params.set("timeline_id", String(timelineId));
  if (itemId !== undefined && itemId !== null) params.set("item_id", String(itemId));
  if (skipCategories && skipCategories.length) {
    params.set("skip_categories", skipCategories.join(","));
  }
  return request<InterviewQuestion>(`/interview/question?${params.toString()}`);
}

export interface InterviewAnswerInput {
  timeline_id: number;
  item_id: number | null;
  category: ExperienceCategory;
  trigger_question: string;
  answer: string;
}

export function postInterviewAnswer(body: InterviewAnswerInput): Promise<InterviewAnswerResponse> {
  return request<InterviewAnswerResponse>("/interview/answer", { method: "POST", body });
}

// ---------------------------------------------------------------------------
// Experiences
// ---------------------------------------------------------------------------

export function getExperiences(
  category?: ExperienceCategory | "",
  timelineEntryId?: number | null
): Promise<SubExperience[]> {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (timelineEntryId != null) params.set("timeline_entry_id", String(timelineEntryId));
  const qs = params.toString();
  return request<SubExperience[]>(`/experiences${qs ? `?${qs}` : ""}`);
}

export interface ExperienceUpdateInput {
  category: ExperienceCategory;
  situation: string;
  action: string;
  result: string;
  /** The original interview answer; omit to leave it unchanged. */
  answer?: string;
}

export function updateExperience(id: number, body: ExperienceUpdateInput): Promise<SubExperience> {
  return request<SubExperience>(`/experiences/${id}`, { method: "PUT", body });
}

export function deleteExperience(id: number): Promise<void> {
  return request<void>(`/experiences/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export function getApplications(): Promise<Application[]> {
  return request<Application[]>("/applications");
}

export function getApplication(id: number): Promise<ApplicationDetail> {
  return request<ApplicationDetail>(`/applications/${id}`);
}

export interface ApplicationInput {
  company: string;
  position: string | null;
  job_description: string | null;
}

export function createApplication(body: ApplicationInput): Promise<Application> {
  return request<Application>("/applications", { method: "POST", body });
}

/** Changing job_description resets the matches of every question in the application. */
export function updateApplication(id: number, body: ApplicationInput): Promise<Application> {
  return request<Application>(`/applications/${id}`, { method: "PUT", body });
}

/** Also deletes the application's essay questions, their matches and drafts. */
export function deleteApplication(id: number): Promise<void> {
  return request<void>(`/applications/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Essay questions
// ---------------------------------------------------------------------------

export function getEssayQuestions(): Promise<EssayQuestion[]> {
  return request<EssayQuestion[]>("/essay-questions");
}

export interface EssayQuestionInput {
  question_text: string;
  char_limit: number | null;
}

export function createEssayQuestion(
  body: EssayQuestionInput & { application_id: number }
): Promise<EssayQuestion> {
  // Per spec: a duplicate question_text is only a *soft* warning (still created).
  // The backend may signal this either with 201 + a `warning` field, or with a
  // 409 status that still carries the created resource - accept both as success.
  return request<EssayQuestion>("/essay-questions", {
    method: "POST",
    body,
    extraOkStatuses: [409],
  });
}

export function updateEssayQuestion(id: number, body: EssayQuestionInput): Promise<EssayQuestion> {
  return request<EssayQuestion>(`/essay-questions/${id}`, { method: "PUT", body });
}

export function deleteEssayQuestion(id: number): Promise<void> {
  return request<void>(`/essay-questions/${id}`, { method: "DELETE" });
}

export function getEssayQuestionMatches(id: number): Promise<MatchItem[]> {
  return request<MatchItem[]>(`/essay-questions/${id}/matches`);
}

/** Deletes this question's matches and scores every experience again. */
export function rematchEssayQuestion(id: number): Promise<MatchItem[]> {
  return request<MatchItem[]>(`/essay-questions/${id}/rematch`, { method: "POST" });
}

export function confirmMatch(id: number): Promise<MatchRecord> {
  return request<MatchRecord>(`/matches/${id}/confirm`, { method: "PUT" });
}

export function generateDraft(id: number): Promise<EssayQuestion> {
  return request<EssayQuestion>(`/essay-questions/${id}/draft`, { method: "POST" });
}

export function saveDraft(id: number, draft_text: string): Promise<EssayQuestion> {
  return request<EssayQuestion>(`/essay-questions/${id}/draft`, {
    method: "PUT",
    body: { draft_text },
  });
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

export function getResume(): Promise<Resume> {
  return request<Resume>("/resume");
}

export interface ResumeInput {
  name: string;
  email: string;
  phone: string | null;
  birth_date: string | null;
  photo_url: string | null;
  content: ResumeContent;
}

export function saveResume(body: ResumeInput): Promise<Resume> {
  return request<Resume>("/resume", { method: "PUT", body });
}

/**
 * The PDF endpoint returns binary, not JSON, so it can't go through `request`.
 * Mirrors its auth header / error handling and resolves to the raw Blob.
 */
export async function downloadResumePdf(): Promise<Blob> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/resume/pdf`, { headers });
  } catch {
    throw new ApiError(0, "서버에 연결할 수 없어요. 잠시 후 다시 시도해주세요.");
  }

  if (!res.ok) {
    if (res.status === 401 && token && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cb:unauthorized"));
    }
    let data: unknown = undefined;
    try {
      data = JSON.parse(await res.text());
    } catch {
      data = undefined;
    }
    throw new ApiError(res.status, extractDetail(data, "PDF를 내려받지 못했어요."));
  }

  return res.blob();
}

/**
 * Uploads a resume file (PDF/DOCX) and gets back an unsaved draft for the form.
 * Multipart, so it can't go through `request` (which JSON-encodes bodies).
 */
export async function importResume(file: File): Promise<ResumeImport> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const form = new FormData();
  form.append("file", file);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/resume/import`, { method: "POST", headers, body: form });
  } catch {
    throw new ApiError(0, "서버에 연결할 수 없어요. 잠시 후 다시 시도해주세요.");
  }

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && token && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cb:unauthorized"));
    }
    throw new ApiError(res.status, extractDetail(data, "이력서 파일을 불러오지 못했어요."));
  }

  return data as ResumeImport;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export interface FeedbackInput {
  category: FeedbackCategory;
  content: string;
  page_path: string | null;
}

export function submitFeedback(body: FeedbackInput): Promise<Feedback> {
  return request<Feedback>("/feedback", { method: "POST", body });
}

/** Admin only - the server returns 403 for anyone else. */
export function getFeedbackList(): Promise<Feedback[]> {
  return request<Feedback[]>("/feedback");
}

/** Admin only. */
export function updateFeedbackStatus(id: number, status: FeedbackStatus): Promise<Feedback> {
  return request<Feedback>(`/feedback/${id}`, { method: "PUT", body: { status } });
}

/** Admin only - everyone who signed up, most recent login first. */
export function getAdminUsers(): Promise<AdminUser[]> {
  return request<AdminUser[]>("/admin/users");
}

// ---------------------------------------------------------------------------
// Free essays
// ---------------------------------------------------------------------------

export interface FreeEssayInput {
  company: string;
  position: string | null;
  job_description: string | null;
  char_limit: number | null;
}

export function getFreeEssays(): Promise<FreeEssay[]> {
  return request<FreeEssay[]>("/free-essays");
}

export function getFreeEssay(id: number): Promise<FreeEssayDetail> {
  return request<FreeEssayDetail>(`/free-essays/${id}`);
}

/** Picks experiences and writes the draft in the same call, so it can take a minute. */
export function createFreeEssay(body: FreeEssayInput): Promise<FreeEssayDetail> {
  return request<FreeEssayDetail>("/free-essays", { method: "POST", body });
}

/** Inputs only; the draft is rewritten by regenerateFreeEssay. */
export function updateFreeEssay(id: number, body: FreeEssayInput): Promise<FreeEssayDetail> {
  return request<FreeEssayDetail>(`/free-essays/${id}`, { method: "PUT", body });
}

export function deleteFreeEssay(id: number): Promise<void> {
  return request<void>(`/free-essays/${id}`, { method: "DELETE" });
}

export function regenerateFreeEssay(id: number): Promise<FreeEssayDetail> {
  return request<FreeEssayDetail>(`/free-essays/${id}/regenerate`, { method: "POST" });
}
