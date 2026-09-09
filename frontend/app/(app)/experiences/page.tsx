"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, getExperiences, getTimelines } from "@/lib/api";
import type { ExperienceCategory, SubExperience, TimelineEntry } from "@/lib/types";
import { EXPERIENCE_CATEGORIES, experienceCategoryLabel } from "@/lib/constants";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

export default function ExperiencesPage() {
  const [experiences, setExperiences] = useState<SubExperience[] | null>(null);
  const [timelines, setTimelines] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<ExperienceCategory | "">("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [exp, tls] = await Promise.all([
          getExperiences(category || undefined),
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
  }, [category]);

  const timelineTitleById = useMemo(() => {
    const map = new Map<number, string>();
    timelines.forEach((t) => map.set(t.id, t.title));
    return map;
  }, [timelines]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">경험 저장소</h1>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ExperienceCategory | "")}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">전체</option>
          {EXPERIENCE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="경험을 불러오는 중이에요..." />
      ) : !experiences || experiences.length === 0 ? (
        <EmptyState
          message={
            category
              ? "선택한 카테고리에 해당하는 경험이 없어요."
              : "아직 저장된 경험이 없어요. 인터뷰를 통해 첫 경험을 기록해보세요."
          }
          action={
            !category && (
              <Link
                href="/timelines"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                타임라인에서 인터뷰 시작하기
              </Link>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {experiences.map((exp) => (
            <Link
              key={exp.id}
              href={`/experiences/${exp.id}`}
              className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex w-fit items-center rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
                  {experienceCategoryLabel(exp.category)}
                </span>
                <span className="text-xs text-gray-400">
                  {timelineTitleById.get(exp.timeline_entry_id) ?? `타임라인 #${exp.timeline_entry_id}`}
                </span>
              </div>
              <p className="line-clamp-2 text-sm font-medium text-gray-900">
                Q. {exp.trigger_question}
              </p>
              <p className="line-clamp-2 text-sm text-gray-500">A. {exp.answer}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
