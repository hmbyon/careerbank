"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError, getFeedbackList, updateFeedbackStatus } from "@/lib/api";
import type { Feedback, FeedbackStatus } from "@/lib/types";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, isAdminEmail } from "@/lib/constants";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

const CATEGORY_STYLE: Record<string, string> = {
  BUG: "bg-red-50 text-red-700",
  SUGGESTION: "bg-blue-50 text-blue-700",
  OTHER: "bg-gray-100 text-gray-600",
};

const STATUS_STYLE: Record<FeedbackStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  RESOLVED: "bg-emerald-50 text-emerald-700",
};

function categoryLabel(value: string): string {
  return FEEDBACK_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export default function AdminFeedbackPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [items, setItems] = useState<Feedback[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const isAdmin = isAdminEmail(user?.email);

  useEffect(() => {
    // UX guard only - the API enforces this with a 403 regardless.
    if (!authLoading && user && !isAdmin) {
      router.replace("/dashboard");
    }
  }, [authLoading, user, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getFeedbackList();
        if (!cancelled) setItems(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "피드백을 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  async function handleStatusChange(id: number, status: FeedbackStatus) {
    setSavingId(id);
    setError(null);
    try {
      const updated = await updateFeedbackStatus(id, status);
      setItems((prev) => prev?.map((f) => (f.id === id ? { ...f, ...updated } : f)) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "상태 변경 중 오류가 발생했어요.");
    } finally {
      setSavingId(null);
    }
  }

  if (authLoading || !isAdmin) return <Spinner label="확인 중이에요..." />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">피드백 관리</h1>
        <p className="mt-1 text-sm text-gray-500">
          사용자가 보낸 피드백을 확인하고 처리 상태를 바꿀 수 있어요.
        </p>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="피드백을 불러오는 중이에요..." />
      ) : !items || items.length === 0 ? (
        <EmptyState message={"아직 접수된 피드백이 없어요."} />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((f) => (
            <div key={f.id} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                      CATEGORY_STYLE[f.category] ?? CATEGORY_STYLE.OTHER
                    }`}
                  >
                    {categoryLabel(f.category)}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                      STATUS_STYLE[f.status]
                    }`}
                  >
                    {FEEDBACK_STATUSES.find((s) => s.value === f.status)?.label ?? f.status}
                  </span>
                </div>
                <select
                  value={f.status}
                  disabled={savingId === f.id}
                  onChange={(e) => handleStatusChange(f.id, e.target.value as FeedbackStatus)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                >
                  {FEEDBACK_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <p className="whitespace-pre-line text-sm text-gray-800">{f.content}</p>

              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
                <span>{f.user_email ?? `사용자 #${f.user_id}`}</span>
                <span>{new Date(f.created_at).toLocaleString("ko-KR")}</span>
                {f.page_path && <span>경로: {f.page_path}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
