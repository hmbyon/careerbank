import type { ActivityCategory, ExperienceCategory } from "./types";

export const ACTIVITY_CATEGORIES: { value: ActivityCategory; label: string }[] = [
  { value: "EDUCATION", label: "학력" },
  { value: "CAREER", label: "경력" },
  { value: "ACTIVITY", label: "대외활동" },
  { value: "CERTIFICATE", label: "자격증" },
];

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  EDUCATION: "학력",
  CAREER: "경력",
  ACTIVITY: "대외활동",
  CERTIFICATE: "자격증",
};

export const EXPERIENCE_CATEGORIES: { value: ExperienceCategory; label: string }[] = [
  { value: "COLLABORATION", label: "협력·팀워크" },
  { value: "LEADERSHIP", label: "리더십" },
  { value: "COMMUNICATION", label: "대인관계·소통" },
  { value: "INITIATIVE", label: "도전정신·실행력" },
  { value: "RESPONSIBILITY", label: "책임감·성실성" },
  { value: "PROBLEM_SOLVING", label: "문제해결력" },
  { value: "RESILIENCE", label: "실패극복·회복탄력성" },
  { value: "GOAL_MANAGEMENT", label: "목표관리·추진력" },
  { value: "VALUES_ETHICS", label: "가치관·윤리의식" },
  { value: "SELF_INITIATIVE", label: "자기주도성" },
  { value: "CREATIVITY", label: "창의성·문제인식" },
  { value: "TECHNICAL_SKILL", label: "직무 전문성/기술 습득" },
  { value: "PERFORMANCE", label: "성과·수치화된 결과" },
  { value: "PROJECT_MANAGEMENT", label: "프로젝트/일정 관리" },
  { value: "DATA_DRIVEN", label: "데이터·분석 기반 의사결정" },
  { value: "STAKEHOLDER", label: "고객/이해관계자 대응" },
];

export const EXPERIENCE_CATEGORY_LABELS: Record<ExperienceCategory, string> =
  EXPERIENCE_CATEGORIES.reduce((acc, c) => {
    acc[c.value] = c.label;
    return acc;
  }, {} as Record<ExperienceCategory, string>);

export function activityCategoryLabel(v: ActivityCategory): string {
  return ACTIVITY_CATEGORY_LABELS[v] ?? v;
}

export function experienceCategoryLabel(v: ExperienceCategory): string {
  return EXPERIENCE_CATEGORY_LABELS[v] ?? v;
}
