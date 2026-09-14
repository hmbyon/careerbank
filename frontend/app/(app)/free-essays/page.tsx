"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, deleteFreeEssay, getFreeEssays } from "@/lib/api";
import type { FreeEssay, FreeEssayStatus } from "@/lib/types";
import { FREE_ESSAY_STATUS_LABELS } from "@/lib/constants";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import SelectionToolbar from "@/components/SelectionToolbar";
import { useSelection } from "@/lib/useSelection";

const STATUS_STYLE: Record<FreeEssayStatus, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700",
};

export default function FreeEssaysPage() {
  const [essays, setEssays] = useState<FreeEssay[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ids = (essays ?? []).map((e) => e.id);
  const selection = useSelection(ids);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getFreeEssays();
        if (!cancelled) setEssays(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "자유형식 자소서를 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reload() {
    try {
      setEssays(await getFreeEssays());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "자유형식 자소서를 불러오지 못했어요.");
    }
  }

  async function handleBulkDelete(targetIds: number[]) {
    setError(null);
    try {
      for (const id of targetIds) {
        await deleteFreeEssay(id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "삭제 중 오류가 발생했어요.");
    }
    selection.exitSelectMode();
    await reload();
  }

  const toolbarProps = {
    selectMode: selection.selectMode,
    onEnterSelectMode: selection.enterSelectMode,
    onExitSelectMode: selection.exitSelectMode,
    allIds: ids,
    selectedIds: selection.selectedIds,
    allSelected: selection.allSelected,
    onToggleAll: selection.toggleAll,
    onDelete: handleBulkDelete,
    itemNoun: "자유형식 자소서",
    cascadeWarning: "생성된 초안도 함께 삭제됩니다. 저장된 경험은 그대로 남아요.",
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">자유형식 자소서</h1>
          <p className="mt-1 text-sm text-gray-500">
            문항 없이 회사 정보만으로 쓰는 자기소개서 초안을 만들어요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!selection.selectMode && <SelectionToolbar {...toolbarProps} />}
          <Link
            href="/free-essays/new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            새로 작성
          </Link>
        </div>
      </div>

      {selection.selectMode && <SelectionToolbar {...toolbarProps} />}

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="자유형식 자소서를 불러오는 중이에요..." />
      ) : !essays || essays.length === 0 ? (
        <EmptyState
          message={"아직 작성한 자유형식 자소서가 없어요. 회사 정보를 넣고 초안을 만들어보세요."}
          action={
            <Link
              href="/free-essays/new"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              새로 작성하기
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {essays.map((fe) => {
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-base font-semibold text-gray-900">{fe.company}</span>
                    {fe.position && <span className="text-xs text-gray-400">{fe.position}</span>}
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[fe.status]}`}
                  >
                    {FREE_ESSAY_STATUS_LABELS[fe.status]}
                  </span>
                </div>
                <p className="line-clamp-2 text-sm text-gray-600">
                  {fe.draft_text || "아직 생성된 초안이 없어요."}
                </p>
                <div className="flex flex-wrap gap-x-3 text-xs text-gray-400">
                  <span>반영된 경험 {fe.used_experience_count}개</span>
                  {fe.char_limit && <span>글자수 제한 {fe.char_limit}자</span>}
                  <span>{new Date(fe.created_at).toLocaleDateString("ko-KR")}</span>
                </div>
              </>
            );
            const cardClass = `flex flex-col gap-2 rounded-xl border bg-white p-4 shadow-sm ${
              selection.selectMode
                ? selection.selected.has(fe.id)
                  ? "cursor-pointer border-blue-400 ring-1 ring-blue-200"
                  : "cursor-pointer border-gray-200"
                : "border-gray-200 hover:shadow-md"
            }`;

            // Outside select mode the card keeps navigating to the detail screen.
            if (!selection.selectMode) {
              return (
                <Link key={fe.id} href={`/free-essays/${fe.id}`} className={cardClass}>
                  {body}
                </Link>
              );
            }
            return (
              <div
                key={fe.id}
                role="button"
                tabIndex={0}
                onClick={() => selection.toggle(fe.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selection.toggle(fe.id);
                  }
                }}
                className={cardClass}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selection.selected.has(fe.id)}
                    readOnly
                    className="mt-1"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">{body}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
