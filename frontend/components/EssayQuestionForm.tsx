"use client";

import { useState, type FormEvent } from "react";
import { ApiError, type EssayQuestionInput } from "@/lib/api";
import ErrorBanner from "@/components/ErrorBanner";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

/** Shared by the register (/new) and edit ([id]/edit) screens. */
export default function EssayQuestionForm({
  initial,
  originalQuestionText,
  submitLabel,
  submittingLabel,
  submitErrorMessage,
  onSubmit,
  onCancel,
}: {
  initial?: EssayQuestionInput;
  /** When set, a notice shows while the question text differs from it. */
  originalQuestionText?: string;
  submitLabel: string;
  submittingLabel: string;
  /** Fallback message when the request fails without an API detail. */
  submitErrorMessage: string;
  onSubmit: (values: EssayQuestionInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [questionText, setQuestionText] = useState(initial?.question_text ?? "");
  const [charLimit, setCharLimit] = useState(
    initial?.char_limit != null ? String(initial.char_limit) : ""
  );
  const [company, setCompany] = useState(initial?.company ?? "");
  const [position, setPosition] = useState(initial?.position ?? "");
  const [jobDescription, setJobDescription] = useState(initial?.job_description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      await onSubmit({
        question_text: questionText.trim(),
        char_limit: charLimit ? Number(charLimit) : null,
        company: company.trim() || null,
        position: position.trim() || null,
        job_description: jobDescription.trim() || null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : submitErrorMessage);
    } finally {
      setSubmitting(false);
    }
  }

  const questionChanged =
    originalQuestionText !== undefined && questionText.trim() !== originalQuestionText;

  return (
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

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          채용공고(JD) 붙여넣기 (선택)
        </label>
        <textarea
          value={jobDescription}
          maxLength={20000}
          onChange={(e) => setJobDescription(e.target.value)}
          rows={6}
          placeholder="지원하는 채용공고의 담당 업무·자격 요건·우대 사항을 복사해서 붙여넣으세요. 매칭 점수와 초안에 반영돼요."
          className={inputClass}
        />
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
