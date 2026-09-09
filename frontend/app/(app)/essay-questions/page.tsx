"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, getEssayQuestions } from "@/lib/api";
import type { EssayQuestion } from "@/lib/types";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

export default function EssayQuestionsPage() {
  const [questions, setQuestions] = useState<EssayQuestion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getEssayQuestions();
        if (!cancelled) setQuestions(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "자소서 문항을 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">자소서 문항</h1>
        <Link
          href="/essay-questions/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          등록
        </Link>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="자소서 문항을 불러오는 중이에요..." />
      ) : !questions || questions.length === 0 ? (
        <EmptyState
          message={"아직 등록된 자소서 문항이 없어요. 새 문항을 등록해보세요."}
          action={
            <Link
              href="/essay-questions/new"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              문항 등록하기
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {questions.map((q) => (
            <Link
              key={q.id}
              href={`/essay-questions/${q.id}/matches`}
              className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                    q.status === "매칭완료"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {q.status ?? "매칭대기"}
                </span>
                {(q.company || q.position) && (
                  <span className="text-xs text-gray-400">
                    {[q.company, q.position].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
              <p className="line-clamp-2 text-sm font-medium text-gray-900">{q.question_text}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
