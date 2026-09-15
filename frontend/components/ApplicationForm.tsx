"use client";

import { useState, type FormEvent } from "react";
import { ApiError, type ApplicationInput } from "@/lib/api";
import ErrorBanner from "@/components/ErrorBanner";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

/** Shared by the create (/applications/new) and edit ([id]/edit) screens. */
export default function ApplicationForm({
  initial,
  questionCount,
  submitLabel,
  submittingLabel,
  submitErrorMessage,
  onSubmit,
  onCancel,
}: {
  /** When set (edit), a notice shows while the job description differs from it. */
  initial?: ApplicationInput;
  /** Questions whose matches a job description change would reset. */
  questionCount?: number;
  submitLabel: string;
  submittingLabel: string;
  /** Fallback message when the request fails without an API detail. */
  submitErrorMessage: string;
  onSubmit: (values: ApplicationInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [company, setCompany] = useState(initial?.company ?? "");
  const [position, setPosition] = useState(initial?.position ?? "");
  const [jobDescription, setJobDescription] = useState(initial?.job_description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!company.trim()) {
      setError("회사명을 입력해주세요.");
      return;
    }
    if (company.trim().length > 200) {
      setError("회사명은 200자 이하로 입력해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        company: company.trim(),
        position: position.trim() || null,
        job_description: jobDescription.trim() || null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : submitErrorMessage);
    } finally {
      setSubmitting(false);
    }
  }

  const jobDescriptionChanged =
    initial !== undefined && (jobDescription.trim() || null) !== (initial.job_description || null);

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">회사명</label>
          <input
            type="text"
            value={company}
            maxLength={200}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="필수 입력"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">직무</label>
          <input
            type="text"
            value={position}
            maxLength={200}
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
          rows={8}
          placeholder="지원하는 채용공고의 담당 업무·자격 요건·우대 사항을 복사해서 붙여넣으세요. 이 지원의 모든 문항 매칭 점수와 초안에 반영돼요."
          className={inputClass}
        />
        {jobDescriptionChanged && (questionCount ?? 0) > 0 && (
          <p className="mt-1 text-xs text-amber-600">
            채용공고를 바꾸면 이 지원의 문항 {questionCount}개 관련도 점수가 저장 후 다시 계산되고, 확정한 경험 표시도
            초기화돼요. 저장된 초안은 그대로 남아요.
          </p>
        )}
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
