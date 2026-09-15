"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, deleteExperience, getExperiences, getTimelines } from "@/lib/api";
import type { ExperienceCategory, SubExperience, TimelineEntry } from "@/lib/types";
import { EXPERIENCE_CATEGORIES, experienceCategoryLabel } from "@/lib/constants";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import SelectionToolbar from "@/components/SelectionToolbar";
import { useSelection } from "@/lib/useSelection";

function ExperienceCard({
  exp,
  timelineTitle,
  selectMode = false,
  selected = false,
  onToggle,
}: {
  exp: SubExperience;
  timelineTitle: string;
  selectMode?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex w-fit items-center rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
          {experienceCategoryLabel(exp.category)}
        </span>
        <span className="text-xs text-gray-400">{timelineTitle}</span>
      </div>
      <p className="line-clamp-2 text-sm font-medium text-gray-900">Q. {exp.trigger_question}</p>
      <p className="line-clamp-2 text-sm text-gray-500">A. {exp.answer}</p>
    </>
  );

  const cardClass = `flex flex-col gap-2 rounded-xl border bg-white p-4 shadow-sm ${
    selectMode
      ? selected
        ? "cursor-pointer border-blue-400 ring-1 ring-blue-200"
        : "cursor-pointer border-gray-200"
      : "border-gray-200 hover:shadow-md"
  }`;

  // Outside select mode the card keeps navigating to the detail screen.
  if (!selectMode) {
    return (
      <Link href={`/experiences/${exp.id}`} className={cardClass}>
        {body}
      </Link>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle?.();
        }
      }}
      className={cardClass}
    >
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={selected} readOnly className="mt-1" />
        <div className="flex flex-1 flex-col gap-2">{body}</div>
      </div>
    </div>
  );
}

export default function ExperiencesPage() {
  const [experiences, setExperiences] = useState<SubExperience[] | null>(null);
  const [timelines, setTimelines] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<ExperienceCategory | "">("");
  // "category" keeps the original behaviour; "timeline" swaps the filter for a
  // timeline picker and groups the results by timeline when none is picked.
  const [viewMode, setViewMode] = useState<"category" | "timeline">("category");
  const [timelineId, setTimelineId] = useState<number | "">("");

  const ids = (experiences ?? []).map((e) => e.id);
  const selection = useSelection(ids);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [exp, tls] = await Promise.all([
          getExperiences(
            viewMode === "category" ? category || undefined : undefined,
            viewMode === "timeline" && timelineId !== "" ? timelineId : undefined
          ),
          timelines.length ? Promise.resolve(timelines) : getTimelines(),
        ]);
        if (!cancelled) {
          setExperiences(exp);
          if (!timelines.length) setTimelines(tls);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "경험 목록을 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, viewMode, timelineId]);

  async function reload() {
    try {
      setExperiences(
        await getExperiences(
          viewMode === "category" ? category || undefined : undefined,
          viewMode === "timeline" && timelineId !== "" ? timelineId : undefined
        )
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "경험 목록을 불러오지 못했어요.");
    }
  }

  async function handleBulkDelete(targetIds: number[]) {
    setError(null);
    try {
      for (const id of targetIds) {
        await deleteExperience(id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "삭제 중 오류가 발생했어요.");
    }
    selection.exitSelectMode();
    await reload();
  }

  const toolbarProps = {
    selectMode: selection.selectMode,
    onEnterSelectMode: selection.enterSelectMode,
    onExitSelectMode: selection.exitSelectMode,
    allIds: ids,
    selectedIds: selection.selectedIds,
    allSelected: selection.allSelected,
    onToggleAll: selection.toggleAll,
    onDelete: handleBulkDelete,
    itemNoun: "경험",
    cascadeWarning: "삭제한 경험에 연결된 자소서 매칭 결과도 함께 사라집니다.",
  };

  const timelineTitleById = useMemo(() => {
    const map = new Map<number, string>();
    timelines.forEach((t) => map.set(t.id, t.title));
    return map;
  }, [timelines]);

  // Timeline view with no specific timeline picked: one section per timeline,
  // ordered the way the timeline list itself is.
  const timelineGroups = useMemo(() => {
    if (viewMode !== "timeline" || timelineId !== "" || !experiences) return [];
    return timelines
      .map((t) => ({ timeline: t, items: experiences.filter((e) => e.timeline_entry_id === t.id) }))
      .filter((g) => g.items.length > 0);
  }, [viewMode, timelineId, experiences, timelines]);

  const selectClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">경험 저장소</h1>
        <div className="flex flex-wrap items-center gap-2">
          {!selection.selectMode && (
            <Link
              href="/experiences/import"
              className="rounded-md border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
            >
              문서에서 경험 가져오기
            </Link>
          )}
          <SelectionToolbar {...toolbarProps} />
          <div className="flex rounded-md border border-gray-300 p-0.5">
            {(
              [
                ["category", "카테고리별 보기"],
                ["timeline", "타임라인별 보기"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === mode
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {viewMode === "category" ? (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExperienceCategory | "")}
              className={selectClass}
            >
              <option value="">전체</option>
              {EXPERIENCE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={timelineId}
              onChange={(e) => setTimelineId(e.target.value === "" ? "" : Number(e.target.value))}
              className={selectClass}
            >
              <option value="">전체 타임라인</option>
              {timelines.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {selection.selectMode && <SelectionToolbar {...toolbarProps} />}

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="경험을 불러오는 중이에요..." />
      ) : !experiences || experiences.length === 0 ? (
        <EmptyState
          message={
            viewMode === "timeline" && timelineId !== ""
              ? "선택한 타임라인에 해당하는 경험이 없어요."
              : category
                ? "선택한 카테고리에 해당하는 경험이 없어요."
                : "아직 저장된 경험이 없어요. 인터뷰를 통해 첫 경험을 기록해보세요."
          }
          action={
            !category && timelineId === "" && (
              <div className="flex flex-wrap justify-center gap-2">
                <Link
                  href="/timelines"
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  타임라인에서 인터뷰 시작하기
                </Link>
                <Link
                  href="/experiences/import"
                  className="rounded-md border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                >
                  문서에서 경험 가져오기
                </Link>
              </div>
            )
          }
        />
      ) : timelineGroups.length > 0 ? (
        <div className="flex flex-col gap-6">
          {timelineGroups.map(({ timeline, items }) => (
            <section key={timeline.id} className="flex flex-col gap-3">
              <h2 className="flex items-baseline gap-2 border-b border-gray-200 pb-2">
                <span className="text-base font-semibold text-gray-900">{timeline.title}</span>
                <span className="text-xs text-gray-400">{items.length}개</span>
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {items.map((exp) => (
                  <ExperienceCard
                    key={exp.id}
                    exp={exp}
                    timelineTitle={timeline.title}
                    selectMode={selection.selectMode}
                    selected={selection.selected.has(exp.id)}
                    onToggle={() => selection.toggle(exp.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {experiences.map((exp) => (
            <ExperienceCard
              key={exp.id}
              exp={exp}
              timelineTitle={
                timelineTitleById.get(exp.timeline_entry_id) ?? `타임라인 #${exp.timeline_entry_id}`
              }
              selectMode={selection.selectMode}
              selected={selection.selected.has(exp.id)}
              onToggle={() => selection.toggle(exp.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
