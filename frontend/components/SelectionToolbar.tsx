"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

/**
 * The "선택 삭제" bar shared by every list screen: mode toggle, select-all,
 * and the two bulk actions. Both actions confirm with the exact count first.
 * Deleting itself is the caller's job - it owns the per-item API call.
 */
export default function SelectionToolbar({
  selectMode,
  onEnterSelectMode,
  onExitSelectMode,
  allIds,
  selectedIds,
  allSelected,
  onToggleAll,
  onDelete,
  itemNoun,
  cascadeWarning,
  disabled = false,
}: {
  selectMode: boolean;
  onEnterSelectMode: () => void;
  onExitSelectMode: () => void;
  /** Every id currently listed - the target of "전체 삭제". */
  allIds: number[];
  selectedIds: number[];
  allSelected: boolean;
  onToggleAll: () => void;
  /** Deletes exactly these ids; the toolbar handles confirmation and busy state. */
  onDelete: (ids: number[]) => Promise<void>;
  /** e.g. "타임라인", "경험" - used in the confirmation copy. */
  itemNoun: string;
  /** Extra line about what else gets removed by cascade. */
  cascadeWarning?: string;
  disabled?: boolean;
}) {
  const [pendingIds, setPendingIds] = useState<number[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    if (!pendingIds) return;
    setDeleting(true);
    try {
      await onDelete(pendingIds);
      setPendingIds(null);
    } finally {
      setDeleting(false);
    }
  }

  if (!selectMode) {
    return (
      <button
        type="button"
        onClick={onEnterSelectMode}
        disabled={disabled || allIds.length === 0}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        선택 삭제
      </button>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
          전체 선택
        </label>
        <span className="text-xs text-gray-500">
          {selectedIds.length}개 선택 / 전체 {allIds.length}개
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPendingIds(selectedIds)}
            disabled={selectedIds.length === 0}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            선택 삭제
          </button>
          <button
            type="button"
            onClick={() => setPendingIds(allIds)}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            전체 삭제
          </button>
          <button
            type="button"
            onClick={onExitSelectMode}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            취소
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={pendingIds !== null}
        title={`${itemNoun} 삭제`}
        message={
          `${itemNoun} ${pendingIds?.length ?? 0}개를 삭제할까요? 되돌릴 수 없어요.` +
          (cascadeWarning ? `\n${cascadeWarning}` : "")
        }
        confirmLabel={deleting ? "삭제 중..." : "삭제"}
        danger
        onConfirm={handleConfirm}
        onCancel={() => setPendingIds(null)}
      />
    </>
  );
}
