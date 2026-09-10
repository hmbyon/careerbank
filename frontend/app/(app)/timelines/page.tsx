"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ApiError,
  deleteTimeline,
  getExperiences,
  getTimelineItems,
  getTimelines,
} from "@/lib/api";
import type { TimelineEntry } from "@/lib/types";
import { ACTIVITY_CATEGORIES, activityCategoryLabel } from "@/lib/constants";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import ConfirmDialog from "@/components/ConfirmDialog";
import SelectionToolbar from "@/components/SelectionToolbar";
import { useSelection } from "@/lib/useSelection";
import { formatPeriod } from "@/lib/date";

export default function TimelinesPage() {
  const [timelines, setTimelines] = useState<TimelineEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Single-card delete: the confirmation needs the real cascade counts.
  const [pendingDelete, setPendingDelete] = useState<TimelineEntry | null>(null);
  const [pendingCounts, setPendingCounts] = useState<{ items: number; experiences: number } | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  const ids = (timelines ?? []).map((t) => t.id);
  const selection = useSelection(ids);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getTimelines();
        if (!cancelled) setTimelines(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "타임라인을 불러오지 못했어요.");
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
      setTimelines(await getTimelines());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "타임라인을 불러오지 못했어요.");
    }
  }

  /** Counts what the cascade will take with this timeline, then opens the dialog. */
  async function askDelete(entry: TimelineEntry) {
    setError(null);
    setPendingDelete(entry);
    setPendingCounts(null);
    try {
      const [items, experiences] = await Promise.all([
        getTimelineItems(entry.id),
        getExperiences(undefined, entry.id),
      ]);
      setPendingCounts({ items: items.length, experiences: experiences.length });
    } catch {
      // Counting is best-effort; the dialog still warns without exact numbers.
      setPendingCounts({ items: -1, experiences: -1 });
    }
  }

  async function handleDeleteOne() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteTimeline(pendingDelete.id);
      setPendingDelete(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "삭제 중 오류가 발생했어요.");
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkDelete(targetIds: number[]) {
    setError(null);
    try {
      for (const id of targetIds) {
        await deleteTimeline(id);
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
    itemNoun: "타임라인",
    cascadeWarning: "각 타임라인의 세부항목과 저장된 경험, 매칭 결과도 함께 삭제됩니다.",
  };

  const groups = ACTIVITY_CATEGORIES.map((c) => ({
    ...c,
    entries: (timelines ?? []).filter((t) => t.category === c.value),
  })).filter((g) => g.entries.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">타임라인</h1>
        {!selection.selectMode && (
          <div className="flex items-center gap-2">
            <SelectionToolbar {...toolbarProps} />
            <Link
              href="/timelines/new"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              등록
            </Link>
          </div>
        )}
      </div>

      {selection.selectMode && <SelectionToolbar {...toolbarProps} />}

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="타임라인을 불러오는 중이에요..." />
      ) : groups.length === 0 ? (
        <EmptyState
          message={"아직 등록된 타임라인이 없어요. 첫 활동을 등록해보세요."}
          action={
            <Link
              href="/timelines/new"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              첫 활동 등록하기
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.value}>
              <h2 className="mb-3 text-sm font-semibold text-gray-500">
                {activityCategoryLabel(group.value)}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {group.entries.map((entry) => {
                  const body = (
                    <>
                      <p className="font-semibold text-gray-900">{entry.title}</p>
                      <p className="mt-1 text-sm text-gray-500">
                        {formatPeriod(entry.start_date, entry.end_date)}
                      </p>
                    </>
                  );
                  return (
                    <div
                      key={entry.id}
                      className={`flex flex-col justify-between gap-3 rounded-xl border bg-white p-4 shadow-sm ${
                        selection.selectMode && selection.selected.has(entry.id)
                          ? "border-blue-400 ring-1 ring-blue-200"
                          : "border-gray-200"
                      }`}
                    >
                      {selection.selectMode ? (
                        // In select mode the whole card toggles instead of navigating.
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => selection.toggle(entry.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selection.toggle(entry.id);
                            }
                          }}
                          className="flex flex-1 cursor-pointer items-start gap-3"
                        >
                          <input
                            type="checkbox"
                            checked={selection.selected.has(entry.id)}
                            readOnly
                            className="mt-1"
                          />
                          <div className="flex-1">{body}</div>
                        </div>
                      ) : (
                        <Link href={`/timelines/${entry.id}/edit`} className="flex-1">
                          {body}
                        </Link>
                      )}
                      {!selection.selectMode && (
                        <div className="flex gap-2">
                          <Link
                            href={`/timelines/${entry.id}/items`}
                            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            세부항목
                          </Link>
                          <button
                            type="button"
                            onClick={() => askDelete(entry)}
                            className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="타임라인 삭제"
        message={
          pendingCounts === null
            ? `"${pendingDelete?.title ?? ""}"에 연결된 데이터를 확인하는 중이에요...`
            : pendingCounts.items < 0
              ? `"${pendingDelete?.title ?? ""}"을(를) 삭제할까요?\n이 타임라인의 세부항목과 저장된 경험, 매칭 결과도 함께 삭제됩니다.`
              : `"${pendingDelete?.title ?? ""}"을(를) 삭제할까요? 되돌릴 수 없어요.\n이 타임라인의 세부항목 ${pendingCounts.items}개, 저장된 경험 ${pendingCounts.experiences}개가 함께 삭제됩니다.`
        }
        confirmLabel={deleting ? "삭제 중..." : "삭제"}
        danger
        onConfirm={handleDeleteOne}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
