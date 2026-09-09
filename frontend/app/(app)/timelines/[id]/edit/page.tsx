"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, getTimelines } from "@/lib/api";
import type { TimelineEntry } from "@/lib/types";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import TimelineForm from "@/components/TimelineForm";

export default function EditTimelinePage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [entry, setEntry] = useState<TimelineEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const all = await getTimelines();
        const found = all.find((t) => t.id === id) ?? null;
        if (!cancelled) {
          setEntry(found);
          if (!found) setError("타임라인을 찾을 수 없어요.");
        }
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
  }, [id]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-gray-900">타임라인 수정</h1>
      {loading ? (
        <Spinner label="불러오는 중이에요..." />
      ) : entry ? (
        <TimelineForm existing={entry} />
      ) : (
        <ErrorBanner message={error ?? "타임라인을 찾을 수 없어요."} />
      )}
    </div>
  );
}
