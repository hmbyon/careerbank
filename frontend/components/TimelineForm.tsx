"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, createTimeline, updateTimeline } from "@/lib/api";
import type { ActivityCategory, TimelineEntry } from "@/lib/types";
import { ACTIVITY_CATEGORIES } from "@/lib/constants";
import { monthInputToDate, toMonthInput } from "@/lib/date";
import ErrorBanner from "@/components/ErrorBanner";

export default function TimelineForm({ existing }: { existing?: TimelineEntry }) {
  const router = useRouter();
  const [category, setCategory] = useState<ActivityCategory>(existing?.category ?? "EDUCATION");
  const [title, setTitle] = useState(existing?.title ?? "");
  // Year-month only ("2021-03"); the day is pinned to the 1st when submitting.
  const [startDate, setStartDate] = useState(toMonthInput(existing?.start_date));
  const [endDate, setEndDate] = useState(toMonthInput(existing?.end_date));
  const [inProgress, setInProgress] = useState(!existing || existing.end_date === null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("제목을 입력해주세요.");
      return;
    }
    if (title.length > 50) {
      setError("제목은 50자 이하로 입력해주세요.");
      return;
    }
    if (!startDate) {
      setError("시작 연월을 입력해주세요.");
      return;
    }
    const effectiveEndDate = inProgress ? null : endDate || null;
    if (effectiveEndDate && startDate > effectiveEndDate) {
      setError("종료 연월은 시작 연월보다 빠를 수 없어요.");
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        category,
        title: title.trim(),
        start_date: monthInputToDate(startDate) as string,
        end_date: monthInputToDate(effectiveEndDate),
      };
      if (existing) {
        await updateTimeline(existing.id, body);
      } else {
        await createTimeline(body);
      }
      router.push("/timelines");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "저장 중 오류가 발생했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <ErrorBanner message={error} />

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">카테고리</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ActivityCategory)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {ACTIVITY_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">제목</label>
        <input
          type="text"
          value={title}
          maxLength={50}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예) SKALA, OO대학교 경영학과"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1 text-right text-xs text-gray-400">{title.length}/50</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">시작 연월</label>
          <input
            type="month"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">종료 연월</label>
          <input
            type="month"
            value={endDate}
            disabled={inProgress}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={inProgress}
              onChange={(e) => setInProgress(e.target.checked)}
            />
            진행중 (종료 연월 없음)
          </label>
        </div>
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push("/timelines")}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}
