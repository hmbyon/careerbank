"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useParams } from "next/navigation";
import {
  ApiError,
  createTimelineItem,
  getTimelineItems,
  getTimelines,
} from "@/lib/api";
import type { TimelineEntry, TimelineItem } from "@/lib/types";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

export default function TimelineItemsPage() {
  const params = useParams<{ id: string }>();
  const timelineId = Number(params.id);

  const [timeline, setTimeline] = useState<TimelineEntry | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [entries, itemList] = await Promise.all([
          getTimelines(),
          getTimelineItems(timelineId),
        ]);
        if (!cancelled) {
          setTimeline(entries.find((t) => t.id === timelineId) ?? null);
          setItems(itemList);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "세부항목을 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [timelineId]);

  async function handleAddItem(e?: FormEvent) {
    e?.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    if (title.length > 30) {
      setAddError("세부항목 이름은 30자 이하로 입력해주세요.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const created = await createTimelineItem(timelineId, title);
      setItems((prev) => [...prev, created]);
      setNewTitle("");
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "세부항목 추가 중 오류가 발생했어요.");
    } finally {
      setAdding(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddItem();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/timelines" className="text-sm text-blue-600 hover:underline">
          ← 타임라인으로
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">
          {timeline ? timeline.title : "세부항목"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          이 활동 안의 세부 항목별로 인터뷰를 진행할 수 있어요.
        </p>
      </div>

      <ErrorBanner message={error} />

      <form
        onSubmit={handleAddItem}
        className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center"
      >
        <input
          type="text"
          value={newTitle}
          maxLength={30}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="세부항목 이름 (예: 데이터분석 수업, 팀 프로젝트) - Enter로 추가"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={adding || !newTitle.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          추가
        </button>
      </form>
      {addError && <ErrorBanner message={addError} />}

      {loading ? (
        <Spinner label="세부항목을 불러오는 중이에요..." />
      ) : items.length === 0 ? (
        <EmptyState message={"아직 등록된 세부항목이 없어요. 새로운 항목을 추가해보세요."} />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <p className="font-medium text-gray-900">{item.title}</p>
              <Link
                href={`/interview?timelineId=${timelineId}&itemId=${item.id}`}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                인터뷰
              </Link>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2">
        <Link
          href={`/interview?timelineId=${timelineId}`}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          세부항목 없이 인터뷰 진행하기 →
        </Link>
      </div>
    </div>
  );
}
