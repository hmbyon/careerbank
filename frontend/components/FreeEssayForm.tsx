"use client";

import { useState, type FormEvent } from "react";
import { ApiError, type FreeEssayInput } from "@/lib/api";
import ErrorBanner from "@/components/ErrorBanner";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

/** Shared by the create (/new) and edit ([id]/edit) free essay screens. */
export default function FreeEssayForm({
  initial,
  submitLabel,
  submittingLabel,
  submitErrorMessage,
  busyNotice,
  onSubmit,
  onCancel,
}: {
  initial?: FreeEssayInput;
  submitLabel: string;
  submittingLabel: string;
  /** Fallback message when the request fails without an API detail. */
  submitErrorMessage: string;
  /** Shown while submitting, e.g. that AI generation takes a while. */
  busyNotice?: string;
  onSubmit: (values: FreeEssayInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [company, setCompany] = useState(initial?.company ?? "");
  const [position, setPosition] = useState(initial?.position ?? "");
  const [charLimit, setCharLimit] = useState(
    initial?.char_limit != null ? String(initial.char_limit) : ""
  );
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
        char_limit: charLimit ? Number(charLimit) : null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : submitErrorMessage);
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">글자수 제한</label>
          <input
            type="number"
            min={1}
            value={charLimit}
            onChange={(e) => setCharLimit(e.target.value)}
            placeholder="예) 1500"
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
          placeholder="지원하는 채용공고의 담당 업무·자격 요건·우대 사항을 복사해서 붙여넣으세요. 경험 선택과 초안에 반영돼요."
          className={inputClass}
        />
      </div>

      {submitting && busyNotice && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {busyNotice}
        </div>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
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
