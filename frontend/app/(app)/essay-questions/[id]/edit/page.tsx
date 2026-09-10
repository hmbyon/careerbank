"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, getEssayQuestions, updateEssayQuestion } from "@/lib/api";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";

export default function EditEssayQuestionPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [questionText, setQuestionText] = useState("");
  const [charLimit, setCharLimit] = useState("");
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // No single-question GET endpoint exists; fetch the list and find by id
        // (same approach the experience detail page uses).
        const found = (await getEssayQuestions()).find((q) => q.id === id) ?? null;
        if (!cancelled) {
          if (found) {
            setQuestionText(found.question_text);
            setOriginalText(found.question_text);
            setCharLimit(found.char_limit != null ? String(found.char_limit) : "");
            setCompany(found.company ?? "");
            setPosition(found.position ?? "");
          } else {
            setLoadError("자소서 문항을 찾을 수 없어요.");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "문항을 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!questionText.trim()) {
      setError("자소서 문항을 입력해주세요.");
      return;
    }
    if (questionText.length > 1000) {
      setError("자소서 문항은 1000자 이하로 입력해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      await updateEssayQuestion(id, {
        question_text: questionText.trim(),
        char_limit: charLimit ? Number(charLimit) : null,
        company: company.trim() || null,
        position: position.trim() || null,
      });
      router.push(`/essay-questions/${id}/matches`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "문항 수정 중 오류가 발생했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Spinner label="문항을 불러오는 중이에요..." />;
  if (loadError) return <ErrorBanner message={loadError} />;

  const questionChanged = questionText.trim() !== originalText;
  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-gray-900">자소서 문항 수정</h1>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <ErrorBanner message={error} />

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">문항 내용</label>
          <textarea
            value={questionText}
            maxLength={1000}
            onChange={(e) => setQuestionText(e.target.value)}
            rows={5}
            placeholder="예) 팀 프로젝트에서 갈등을 해결했던 경험에 대해 서술하세요."
            className={inputClass}
          />
          <p className="mt-1 text-right text-xs text-gray-400">{questionText.length}/1000</p>
          {questionChanged && (
            <p className="mt-1 text-xs text-amber-600">
              문항 내용을 바꾸면 기존 관련도 점수가 더 이상 맞지 않아, 저장 후 매칭이 다시 계산돼요.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">글자수 제한</label>
            <input
              type="number"
              min={1}
              value={charLimit}
              onChange={(e) => setCharLimit(e.target.value)}
              placeholder="예) 1000"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">기업명</label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="선택 입력"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">직무</label>
            <input
              type="text"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="선택 입력"
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => router.push(`/essay-questions/${id}/matches`)}
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
    </div>
  );
}
