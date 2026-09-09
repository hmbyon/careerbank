"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ApiError,
  confirmMatch,
  generateDraft,
  getEssayQuestionMatches,
  getEssayQuestions,
} from "@/lib/api";
import type { EssayQuestion, MatchItem } from "@/lib/types";
import { experienceCategoryLabel } from "@/lib/constants";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

export default function EssayQuestionMatchesPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [question, setQuestion] = useState<EssayQuestion | null>(null);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [questions, matchList] = await Promise.all([
          getEssayQuestions(),
          getEssayQuestionMatches(id),
        ]);
        if (!cancelled) {
          setQuestion(questions.find((q) => q.id === id) ?? null);
          setMatches(matchList);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "매칭 결과를 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const confirmedCount = useMemo(() => matches.filter((m) => m.confirmed).length, [matches]);

  async function handleToggle(matchId: number) {
    setTogglingId(matchId);
    setError(null);
    try {
      const updated = await confirmMatch(matchId);
      setMatches((prev) =>
        prev.map((m) => (m.match_id === matchId ? { ...m, confirmed: updated.confirmed } : m))
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "확정 처리 중 오류가 발생했어요.");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleGenerateDraft() {
    setGenerating(true);
    setGenerateError(null);
    try {
      await generateDraft(id);
      router.push(`/essay-questions/${id}/draft`);
    } catch (err) {
      setGenerateError(err instanceof ApiError ? err.message : "초안 생성 중 오류가 발생했어요.");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <Spinner label="매칭 결과를 불러오는 중이에요..." />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-gray-500">자소서 문항</p>
        <h1 className="text-xl font-bold text-gray-900">
          {question ? question.question_text : `문항 #${id}`}
        </h1>
        {question && (question.company || question.position) && (
          <p className="mt-1 text-sm text-gray-500">
            {[question.company, question.position].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      <ErrorBanner message={error} />

      {matches.length === 0 ? (
        <EmptyState message={"아직 매칭할 경험이 없어요. 먼저 타임라인에서 경험을 등록해보세요."} />
      ) : (
        <div className="flex flex-col gap-3">
          {matches
            .slice()
            .sort((a, b) => b.relevance_score - a.relevance_score)
            .map((m) => (
              <div
                key={m.match_id}
                className={`flex flex-col gap-2 rounded-xl border bg-white p-4 shadow-sm ${
                  m.confirmed ? "border-blue-400 ring-1 ring-blue-200" : "border-gray-200"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
                      {experienceCategoryLabel(m.sub_experience.category)}
                    </span>
                    <span className="text-sm font-semibold text-blue-600">
                      관련도 {Math.round(m.relevance_score)}%
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggle(m.match_id)}
                    disabled={togglingId === m.match_id}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      m.confirmed
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {m.confirmed ? "확정됨 ✓" : "확정"}
                  </button>
                </div>
                <p className="line-clamp-2 text-sm text-gray-700">
                  {m.sub_experience.situation || m.sub_experience.answer}
                </p>
              </div>
            ))}
        </div>
      )}

      <ErrorBanner message={generateError} />

      <div className="flex flex-col items-end gap-2">
        <p className="text-xs text-gray-400">확정된 경험 {confirmedCount}개</p>
        <button
          type="button"
          onClick={handleGenerateDraft}
          disabled={confirmedCount === 0 || generating}
          className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating ? "초안 생성 중..." : "초안 생성"}
        </button>
      </div>
    </div>
  );
}
