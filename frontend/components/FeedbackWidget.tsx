"use client";

import { useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { ApiError, submitFeedback } from "@/lib/api";
import type { FeedbackCategory } from "@/lib/types";
import { FEEDBACK_CATEGORIES } from "@/lib/constants";
import ErrorBanner from "@/components/ErrorBanner";

/** Floating button + modal, shown on every signed-in screen. */
export default function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("BUG");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function close() {
    setOpen(false);
    setError(null);
    setSent(false);
    setContent("");
    setCategory("BUG");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!content.trim()) {
      setError("내용을 입력해주세요.");
      return;
    }
    setSubmitting(true);
    try {
      await submitFeedback({
        category,
        content: content.trim(),
        // Where the user was when they wrote it.
        page_path: pathname || null,
      });
      setSent(true);
      setContent("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "피드백 전송 중 오류가 발생했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 rounded-full bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-blue-700"
      >
        피드백
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-4">
              <h3 className="text-base font-semibold text-gray-900">피드백 보내기</h3>
              <button
                type="button"
                onClick={close}
                aria-label="닫기"
                className="rounded-md px-2 py-1 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                닫기
              </button>
            </div>

            {sent ? (
              <div className="flex flex-col gap-4">
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  소중한 의견 감사해요! 잘 전달됐어요.
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSent(false)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    하나 더 보내기
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    확인
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <ErrorBanner message={error} />
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">분류</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
                    className={inputClass}
                  >
                    {FEEDBACK_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">내용</label>
                  <textarea
                    value={content}
                    maxLength={5000}
                    onChange={(e) => setContent(e.target.value)}
                    rows={5}
                    placeholder="불편했던 점이나 바라는 점을 자유롭게 적어주세요."
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    현재 화면 경로({pathname})가 함께 전송돼요.
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !content.trim()}
                    className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? "보내는 중..." : "보내기"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
