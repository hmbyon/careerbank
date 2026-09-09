"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, getTimelines } from "@/lib/api";
import type { TimelineEntry } from "@/lib/types";
import { ACTIVITY_CATEGORIES, activityCategoryLabel } from "@/lib/constants";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

function formatPeriod(entry: TimelineEntry): string {
  const start = entry.start_date;
  const end = entry.end_date;
  return end ? `${start} ~ ${end}` : `${start} ~ 진행중`;
}

export default function TimelinesPage() {
  const [timelines, setTimelines] = useState<TimelineEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getTimelines();
        if (!cancelled) setTimelines(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "타임라인을 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = ACTIVITY_CATEGORIES.map((c) => ({
    ...c,
    entries: (timelines ?? []).filter((t) => t.category === c.value),
  })).filter((g) => g.entries.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">타임라인</h1>
        <Link
          href="/timelines/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          등록
        </Link>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="타임라인을 불러오는 중이에요..." />
      ) : groups.length === 0 ? (
        <EmptyState
          message={"아직 등록된 타임라인이 없어요. 첫 활동을 등록해보세요."}
          action={
            <Link
              href="/timelines/new"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              첫 활동 등록하기
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.value}>
              <h2 className="mb-3 text-sm font-semibold text-gray-500">
                {activityCategoryLabel(group.value)}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {group.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <Link href={`/timelines/${entry.id}/edit`} className="flex-1">
                      <p className="font-semibold text-gray-900">{entry.title}</p>
                      <p className="mt-1 text-sm text-gray-500">{formatPeriod(entry)}</p>
                    </Link>
                    <Link
                      href={`/timelines/${entry.id}/items`}
                      className="self-start rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      세부항목
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
