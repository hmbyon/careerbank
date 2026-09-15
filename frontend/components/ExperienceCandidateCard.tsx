"use client";

import Link from "next/link";
import type { ExperienceSaveItemInput } from "@/lib/api";
import type {
  ActivityCategory,
  ExperienceCandidate,
  ExperienceCategory,
  ExperienceSaveResult,
  ExtractionTargetTimeline,
} from "@/lib/types";
import { ACTIVITY_CATEGORIES, EXPERIENCE_CATEGORIES } from "@/lib/constants";
import { monthInputToDate, toMonthInput } from "@/lib/date";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400";

/** "new" = new (or same-named) timeline, "entry:<id>" = new item there, "item:<id>" = that item. */
export type SaveTarget = "new" | `entry:${number}` | `item:${number}`;

/** An editable candidate on the preview screen. */
export interface CandidateDraft {
  key: number;
  selected: boolean;
  item_title: string;
  timeline_title: string;
  activity_category: ActivityCategory;
  experience_category: ExperienceCategory | "";
  situation: string;
  action: string;
  result: string;
  start_month: string;
  end_month: string;
  target: SaveTarget;
  /** Set once this candidate has been stored; the card becomes read-only. */
  saved: ExperienceSaveResult | null;
  /** Validation or server message from the last save attempt. */
  error: string | null;
}

export function draftFromCandidate(candidate: ExperienceCandidate, key: number): CandidateDraft {
  return {
    key,
    selected: false,
    item_title: candidate.item_title,
    timeline_title: candidate.timeline_title,
    activity_category: candidate.activity_category,
    experience_category: candidate.experience_category ?? "",
    situation: candidate.situation,
    action: candidate.action,
    result: candidate.result,
    start_month: toMonthInput(candidate.start_date),
    end_month: toMonthInput(candidate.end_date),
    target: "new",
    saved: null,
    error: null,
  };
}

function targetId(target: SaveTarget): number | null {
  const id = Number(target.split(":")[1]);
  return Number.isFinite(id) ? id : null;
}

/** First problem that would stop this draft from saving, or null. */
export function validateDraft(draft: CandidateDraft): string | null {
  if (!draft.target.startsWith("item:") && !draft.item_title.trim()) return "세부항목명을 입력해주세요.";
  if (!draft.experience_category) return "역량 카테고리를 선택해주세요.";
  if (!draft.situation.trim() && !draft.action.trim() && !draft.result.trim()) {
    return "상황·행동·결과 중 하나 이상 입력해주세요.";
  }
  if (draft.target === "new") {
    if (!draft.timeline_title.trim()) return "타임라인 제목을 입력해주세요.";
    if (draft.start_month && draft.end_month && draft.end_month < draft.start_month) {
      return "종료 월이 시작 월보다 빨라요.";
    }
  }
  return null;
}

export function toSaveItem(draft: CandidateDraft): ExperienceSaveItemInput {
  const isNew = draft.target === "new";
  return {
    // Ignored for an existing item (its own name is kept), but the API still requires one.
    item_title: draft.item_title.trim() || "문서에서 가져온 경험",
    timeline_title: isNew ? draft.timeline_title.trim() : null,
    activity_category: draft.activity_category,
    experience_category: draft.experience_category as ExperienceCategory,
    situation: draft.situation.trim() || null,
    action: draft.action.trim() || null,
    result: draft.result.trim() || null,
    start_date: isNew ? monthInputToDate(draft.start_month) : null,
    end_date: isNew ? monthInputToDate(draft.end_month) : null,
    timeline_item_id: draft.target.startsWith("item:") ? targetId(draft.target) : null,
    timeline_entry_id: draft.target.startsWith("entry:") ? targetId(draft.target) : null,
  };
}

export default function ExperienceCandidateCard({
  draft,
  targets,
  disabled = false,
  onChange,
}: {
  draft: CandidateDraft;
  targets: ExtractionTargetTimeline[];
  disabled?: boolean;
  onChange: (patch: Partial<CandidateDraft>) => void;
}) {
  if (draft.saved) {
    const r = draft.saved;
    return (
      <div className="flex flex-col gap-1 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-emerald-800">저장됨 · {r.item_title}</span>
          {r.sub_experience_id && (
            <Link href={`/experiences/${r.sub_experience_id}`} className="text-xs font-medium text-emerald-700 hover:underline">
              경험 보기 →
            </Link>
          )}
        </div>
        <p className="text-xs text-emerald-700">
          {r.timeline_title}
          {r.created_timeline ? " (새 타임라인)" : ""} › {r.item_title}
          {r.created_item ? " (새 세부항목)" : ""}
        </p>
      </div>
    );
  }

  const isNew = draft.target === "new";
  const toItem = draft.target.startsWith("item:");

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm ${
        draft.error
          ? "border-red-300 ring-1 ring-red-100"
          : draft.selected
            ? "border-blue-400 ring-1 ring-blue-200"
            : "border-gray-200"
      }`}
    >
      <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
        <input
          type="checkbox"
          checked={draft.selected}
          disabled={disabled}
          onChange={(e) => onChange({ selected: e.target.checked, error: null })}
        />
        이 경험 저장하기
      </label>
      {draft.error && <p className="text-xs font-medium text-red-600">{draft.error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">세부항목명</label>
          <input
            type="text"
            value={draft.item_title}
            maxLength={30}
            disabled={disabled || toItem}
            onChange={(e) => onChange({ item_title: e.target.value })}
            className={inputClass}
          />
          {toItem && <p className="mt-1 text-xs text-gray-400">선택한 세부항목 이름을 그대로 사용해요.</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">역량 카테고리</label>
          <select
            value={draft.experience_category}
            disabled={disabled}
            onChange={(e) => onChange({ experience_category: e.target.value as ExperienceCategory | "" })}
            className={inputClass}
          >
            <option value="">역량을 선택해주세요</option>
            {EXPERIENCE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">저장 위치</label>
        <select
          value={draft.target}
          disabled={disabled}
          onChange={(e) => onChange({ target: e.target.value as SaveTarget })}
          className={inputClass}
        >
          <option value="new">새 타임라인에 추가</option>
          {targets.map((t) => (
            <optgroup key={t.id} label={t.title}>
              <option value={`entry:${t.id}`}>{t.title} › 새 세부항목으로 추가</option>
              {t.items.map((item) => (
                <option key={item.id} value={`item:${item.id}`}>
                  {t.title} › {item.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {isNew && (
        <div className="grid grid-cols-1 gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">타임라인 제목</label>
            <input
              type="text"
              value={draft.timeline_title}
              maxLength={50}
              disabled={disabled}
              onChange={(e) => onChange({ timeline_title: e.target.value })}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">활동 구분</label>
            <select
              value={draft.activity_category}
              disabled={disabled}
              onChange={(e) => onChange({ activity_category: e.target.value as ActivityCategory })}
              className={inputClass}
            >
              {ACTIVITY_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">시작 월</label>
            <input
              type="month"
              value={draft.start_month}
              disabled={disabled}
              onChange={(e) => onChange({ start_month: e.target.value })}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">종료 월 (선택)</label>
            <input
              type="month"
              value={draft.end_month}
              disabled={disabled}
              onChange={(e) => onChange({ end_month: e.target.value })}
              className={inputClass}
            />
          </div>
          <p className="text-xs text-gray-500 sm:col-span-4">
            같은 구분·제목의 타임라인이 이미 있으면 그 아래에 추가돼요. 시작 월을 비우면 이번 달로 저장돼요.
          </p>
        </div>
      )}

      {(
        [
          ["situation", "상황"],
          ["action", "행동"],
          ["result", "결과"],
        ] as const
      ).map(([field, label]) => (
        <div key={field}>
          <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
          <textarea
            value={draft[field]}
            maxLength={5000}
            rows={2}
            disabled={disabled}
            onChange={(e) => onChange({ [field]: e.target.value })}
            className={inputClass}
          />
        </div>
      ))}
    </div>
  );
}
