"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ApiError,
  confirmMatch,
  deleteEssayQuestion,
  generateDraft,
  getEssayQuestionMatches,
  getEssayQuestions,
  rematchEssayQuestion,
} from "@/lib/api";
import type { EssayQuestion, MatchItem } from "@/lib/types";
import { experienceCategoryLabel } from "@/lib/constants";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import ConfirmDialog from "@/components/ConfirmDialog";

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
  const [rematching, setRematching] = useState(false);
  const [rematchConfirmOpen, setRematchConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteEssayQuestion(id);
      router.push(question?.application ? `/applications/${question.application.id}` : "/essay-questions");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "삭제 중 오류가 발생했어요.");
      setDeleteConfirmOpen(false);
      setDeleting(false);
    }
  }

  async function handleRematch() {
    setRematchConfirmOpen(false);
    setError(null);
    setNotice(null);
    setRematching(true);
    try {
      // Server-side this drops the old Match rows, so confirmed flags reset too.
      const updated = await rematchEssayQuestion(id);
      setMatches(updated);
      setNotice("매칭을 다시 계산했어요. 확정 상태는 초기화됐어요.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "다시 매칭하는 중 오류가 발생했어요.");
    } finally {
      setRematching(false);
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
        {question?.application && (
          <Link
            href={`/applications/${question.application.id}`}
            className="mt-1 inline-block text-sm text-gray-500 hover:text-blue-600 hover:underline"
          >
            {[question.application.company, question.application.position].filter(Boolean).join(" · ")}
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setRematchConfirmOpen(true)}
          disabled={rematching}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {rematching ? "다시 매칭 중..." : "다시 매칭하기"}
        </button>
        {notice && <p className="flex-1 text-xs text-gray-500">{notice}</p>}
        <div className="flex gap-2">
          <Link
            href={`/essay-questions/${id}/edit`}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            수정
          </Link>
          <button
            type="button"
            onClick={() => setDeleteConfirmOpen(true)}
            className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            삭제
          </button>
        </div>
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

      <ConfirmDialog
        open={rematchConfirmOpen}
        title="다시 매칭하기"
        message={"이 문항의 매칭 결과를 모두 지우고 다시 계산할까요?\n지금까지 확정한 경험 표시가 초기화됩니다."}
        confirmLabel="다시 매칭"
        onConfirm={handleRematch}
        onCancel={() => setRematchConfirmOpen(false)}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="자소서 문항 삭제"
        message={"이 문항을 삭제하면 되돌릴 수 없어요.\n매칭 결과와 저장된 초안도 함께 사라집니다."}
        confirmLabel={deleting ? "삭제 중..." : "삭제"}
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}
