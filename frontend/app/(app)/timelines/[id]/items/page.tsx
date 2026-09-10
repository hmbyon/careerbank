"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useParams } from "next/navigation";
import {
  ApiError,
  createTimelineItem,
  deleteTimelineItem,
  getExperiences,
  getTimelineItems,
  getTimelines,
  updateTimelineItem,
} from "@/lib/api";
import type { TimelineEntry, TimelineItem } from "@/lib/types";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import ConfirmDialog from "@/components/ConfirmDialog";
import SelectionToolbar from "@/components/SelectionToolbar";
import { useSelection } from "@/lib/useSelection";

export default function TimelineItemsPage() {
  const params = useParams<{ id: string }>();
  const timelineId = Number(params.id);

  const [timeline, setTimeline] = useState<TimelineEntry | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Inline rename: which row is open, and its working title.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<TimelineItem | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const ids = items.map((i) => i.id);
  const selection = useSelection(ids);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [entries, itemList] = await Promise.all([
          getTimelines(),
          getTimelineItems(timelineId),
        ]);
        if (!cancelled) {
          setTimeline(entries.find((t) => t.id === timelineId) ?? null);
          setItems(itemList);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "세부항목을 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [timelineId]);

  async function handleAddItem(e?: FormEvent) {
    e?.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    if (title.length > 30) {
      setAddError("세부항목 이름은 30자 이하로 입력해주세요.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const created = await createTimelineItem(timelineId, title);
      setItems((prev) => [...prev, created]);
      setNewTitle("");
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "세부항목 추가 중 오류가 발생했어요.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(item: TimelineItem) {
    setEditingId(item.id);
    setEditTitle(item.title);
    setError(null);
  }

  async function saveEdit(itemId: number) {
    const title = editTitle.trim();
    if (!title) {
      setError("세부항목 이름을 입력해주세요.");
      return;
    }
    if (title.length > 30) {
      setError("세부항목 이름은 30자 이하로 입력해주세요.");
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      const updated = await updateTimelineItem(timelineId, itemId, title);
      setItems((prev) => prev.map((i) => (i.id === itemId ? updated : i)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "세부항목 수정 중 오류가 발생했어요.");
    } finally {
      setSavingEdit(false);
    }
  }

  /** Counts the experiences recorded under this item before confirming. */
  async function askDelete(item: TimelineItem) {
    setError(null);
    setPendingDelete(item);
    setPendingCount(null);
    try {
      const all = await getExperiences(undefined, timelineId);
      setPendingCount(all.filter((e) => e.timeline_item_id === item.id).length);
    } catch {
      setPendingCount(-1); // best-effort; warn without an exact number
    }
  }

  async function handleDeleteOne() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteTimelineItem(timelineId, pendingDelete.id);
      setItems((prev) => prev.filter((i) => i.id !== pendingDelete.id));
      setPendingDelete(null);
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
        await deleteTimelineItem(timelineId, id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "삭제 중 오류가 발생했어요.");
    }
    selection.exitSelectMode();
    try {
      setItems(await getTimelineItems(timelineId));
    } catch {
      // list refresh failure is non-fatal; the error banner above covers it
    }
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
    itemNoun: "세부항목",
    cascadeWarning: "각 세부항목으로 저장된 경험과 매칭 결과도 함께 삭제됩니다.",
  };

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddItem();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/timelines" className="text-sm text-blue-600 hover:underline">
          ← 타임라인으로
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">
          {timeline ? timeline.title : "세부항목"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          이 활동 안의 세부 항목별로 인터뷰를 진행할 수 있어요.
        </p>
      </div>

      <ErrorBanner message={error} />

      <form
        onSubmit={handleAddItem}
        className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center"
      >
        <input
          type="text"
          value={newTitle}
          maxLength={30}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="세부항목 이름 (예: 데이터분석 수업, 팀 프로젝트) - Enter로 추가"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={adding || !newTitle.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          추가
        </button>
      </form>
      {addError && <ErrorBanner message={addError} />}

      {items.length > 0 && (
        <div className="flex justify-end">
          {selection.selectMode ? null : <SelectionToolbar {...toolbarProps} />}
        </div>
      )}
      {selection.selectMode && <SelectionToolbar {...toolbarProps} />}

      {loading ? (
        <Spinner label="세부항목을 불러오는 중이에요..." />
      ) : items.length === 0 ? (
        <EmptyState message={"아직 등록된 세부항목이 없어요. 새로운 항목을 추가해보세요."} />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white p-4 shadow-sm ${
                selection.selectMode && selection.selected.has(item.id)
                  ? "border-blue-400 ring-1 ring-blue-200"
                  : "border-gray-200"
              }`}
            >
              {selection.selectMode ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => selection.toggle(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selection.toggle(item.id);
                    }
                  }}
                  className="flex flex-1 cursor-pointer items-center gap-3"
                >
                  <input type="checkbox" checked={selection.selected.has(item.id)} readOnly />
                  <p className="font-medium text-gray-900">{item.title}</p>
                </div>
              ) : editingId === item.id ? (
                <>
                  <input
                    type="text"
                    value={editTitle}
                    maxLength={30}
                    autoFocus
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveEdit(item.id);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveEdit(item.id)}
                      disabled={savingEdit}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingEdit ? "저장 중..." : "저장"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      취소
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => startEdit(item)}
                    title="클릭해서 이름 수정"
                    className="min-w-0 flex-1 text-left font-medium text-gray-900 hover:underline"
                  >
                    {item.title}
                  </button>
                  <div className="flex gap-2">
                    <Link
                      href={`/interview?timelineId=${timelineId}&itemId=${item.id}`}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      인터뷰
                    </Link>
                    <button
                      type="button"
                      onClick={() => askDelete(item)}
                      className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      삭제
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="세부항목 삭제"
        message={
          pendingCount === null
            ? `"${pendingDelete?.title ?? ""}"에 연결된 경험을 확인하는 중이에요...`
            : pendingCount < 0
              ? `"${pendingDelete?.title ?? ""}"을(를) 삭제할까요?\n이 세부항목으로 저장된 경험도 함께 삭제됩니다.`
              : `"${pendingDelete?.title ?? ""}"을(를) 삭제할까요? 되돌릴 수 없어요.\n이 세부항목으로 저장된 경험 ${pendingCount}개가 함께 삭제됩니다.`
        }
        confirmLabel={deleting ? "삭제 중..." : "삭제"}
        danger
        onConfirm={handleDeleteOne}
        onCancel={() => setPendingDelete(null)}
      />

      <div className="pt-2">
        <Link
          href={`/interview?timelineId=${timelineId}`}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          세부항목 없이 인터뷰 진행하기 →
        </Link>
      </div>
    </div>
  );
}
