"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, deleteApplication, getApplications } from "@/lib/api";
import type { Application } from "@/lib/types";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import SelectionToolbar from "@/components/SelectionToolbar";
import { useSelection } from "@/lib/useSelection";

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ids = (applications ?? []).map((a) => a.id);
  const selection = useSelection(ids);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getApplications();
        if (!cancelled) setApplications(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "지원 목록을 불러오지 못했어요.");
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
      setApplications(await getApplications());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "지원 목록을 불러오지 못했어요.");
    }
  }

  async function handleBulkDelete(targetIds: number[]) {
    setError(null);
    try {
      for (const id of targetIds) {
        await deleteApplication(id);
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
    itemNoun: "지원",
    cascadeWarning: (targetIds: number[]) => {
      const count = (applications ?? [])
        .filter((a) => targetIds.includes(a.id))
        .reduce((sum, a) => sum + a.question_count, 0);
      return count > 0
        ? `소속된 자소서 문항 ${count}개와 매칭 결과, 저장된 초안도 함께 삭제됩니다.`
        : "소속된 자소서 문항은 없어요.";
    },
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">지원 관리</h1>
          <p className="mt-1 text-sm text-gray-500">
            회사·직무와 채용공고를 한 번만 입력하고, 그 아래에 자소서 문항을 모아 관리해요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!selection.selectMode && (
            <Link
              href="/essay-questions"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              전체 문항 보기
            </Link>
          )}
          {!selection.selectMode && <SelectionToolbar {...toolbarProps} />}
          <Link
            href="/applications/new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            새 지원
          </Link>
        </div>
      </div>

      {selection.selectMode && <SelectionToolbar {...toolbarProps} />}

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="지원 목록을 불러오는 중이에요..." />
      ) : !applications || applications.length === 0 ? (
        <EmptyState
          message={"아직 등록된 지원이 없어요.\n지원할 회사와 직무를 등록하고 자소서 문항을 추가해보세요."}
          action={
            <Link
              href="/applications/new"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              지원 등록하기
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {applications.map((app) => {
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-base font-semibold text-gray-900">{app.company}</span>
                    {app.position && <span className="text-xs text-gray-400">{app.position}</span>}
                  </div>
                  <span className="inline-flex shrink-0 items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                    문항 {app.question_count}개
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs text-gray-400">
                  <span>{app.job_description ? "채용공고 입력됨" : "채용공고 없음"}</span>
                  <span>{new Date(app.created_at).toLocaleDateString("ko-KR")}</span>
                </div>
              </>
            );
            const cardClass = `flex flex-col gap-2 rounded-xl border bg-white p-4 shadow-sm ${
              selection.selectMode
                ? selection.selected.has(app.id)
                  ? "cursor-pointer border-blue-400 ring-1 ring-blue-200"
                  : "cursor-pointer border-gray-200"
                : "border-gray-200 hover:shadow-md"
            }`;

            // Outside select mode the card keeps navigating to the detail screen.
            if (!selection.selectMode) {
              return (
                <Link key={app.id} href={`/applications/${app.id}`} className={cardClass}>
                  {body}
                </Link>
              );
            }
            return (
              <div
                key={app.id}
                role="button"
                tabIndex={0}
                onClick={() => selection.toggle(app.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selection.toggle(app.id);
                  }
                }}
                className={cardClass}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selection.selected.has(app.id)}
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
