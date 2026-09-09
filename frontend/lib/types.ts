// Shared types matching the backend API contract (SPEC.md section 1 & 2).

export type ActivityCategory = "EDUCATION" | "CAREER" | "ACTIVITY" | "CERTIFICATE";

export type ExperienceCategory =
  | "COLLABORATION"
  | "LEADERSHIP"
  | "COMMUNICATION"
  | "INITIATIVE"
  | "RESPONSIBILITY"
  | "PROBLEM_SOLVING"
  | "RESILIENCE"
  | "GOAL_MANAGEMENT"
  | "VALUES_ETHICS"
  | "SELF_INITIATIVE"
  | "CREATIVITY"
  | "TECHNICAL_SKILL"
  | "PERFORMANCE"
  | "PROJECT_MANAGEMENT"
  | "DATA_DRIVEN"
  | "STAKEHOLDER";

export interface User {
  id: number;
  email: string;
  name: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  user: User;
}

export interface DashboardSummary {
  timeline_count: number;
  experience_count: number;
  essay_question_count: number;
}

export interface TimelineEntry {
  id: number;
  user_id: number;
  category: ActivityCategory;
  title: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface TimelineItem {
  id: number;
  timeline_entry_id: number;
  title: string;
  created_at: string;
}

export interface SubExperience {
  id: number;
  timeline_entry_id: number;
  timeline_item_id: number | null;
  category: ExperienceCategory;
  trigger_question: string;
  answer: string;
  situation: string | null;
  action: string | null;
  result: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface InterviewQuestion {
  category: ExperienceCategory | null;
  question: string | null;
}

export interface InterviewAnswerResponse {
  saved: SubExperience;
  next_question: InterviewQuestion | null;
}

export type EssayQuestionStatus = "매칭완료" | "매칭대기";

export interface EssayQuestion {
  id: number;
  user_id: number;
  question_text: string;
  char_limit: number | null;
  company: string | null;
  position: string | null;
  draft_text: string | null;
  created_at: string;
  updated_at: string | null;
  // Only present on GET /essay-questions (list)
  status?: EssayQuestionStatus;
  // Only present (soft, informational) on POST /essay-questions when a
  // duplicate question_text already exists for the user.
  warning?: string;
}

export interface MatchItem {
  match_id: number;
  sub_experience: SubExperience;
  relevance_score: number;
  confirmed: boolean;
}

export interface MatchRecord {
  id: number;
  sub_experience_id: number;
  essay_question_id: number;
  relevance_score: number;
  confirmed: boolean;
  created_at: string;
}

export interface ResumeItem {
  title: string;
  start_date: string;
  end_date: string | null;
  // The timeline_entries row this item is mirrored into. Filled in by the
  // server on save; null/absent means it hasn't been linked yet.
  timeline_entry_id?: number | null;
}

export interface ResumeContent {
  education: ResumeItem[];
  career: ResumeItem[];
  activity: ResumeItem[];
  certificate: ResumeItem[];
}

export type ResumeSectionKey = keyof ResumeContent;

export interface Resume {
  // A resume that has never been saved comes back as an in-memory draft built
  // from the user's timeline entries: `draft` is true and the row-only fields
  // (id / timestamps) are null.
  id: number | null;
  user_id: number;
  name: string;
  email: string;
  phone: string | null;
  content: ResumeContent;
  created_at: string | null;
  updated_at: string | null;
  draft: boolean;
}
