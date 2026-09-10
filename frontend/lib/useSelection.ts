"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Bulk-selection state for a list screen: a mode toggle plus the checked ids.
 * The exposed selection is derived, filtered against the ids currently listed,
 * so entries that were just deleted (or filtered away) never linger in it.
 */
export function useSelection(allIds: number[]) {
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<number[]>([]);

  const selectedIds = useMemo(
    () => checked.filter((id) => allIds.includes(id)),
    [checked, allIds]
  );
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = useCallback((id: number) => {
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const allSelected = allIds.length > 0 && selectedIds.length === allIds.length;

  const toggleAll = useCallback(() => {
    setChecked((prev) => {
      const live = prev.filter((id) => allIds.includes(id));
      return live.length === allIds.length ? [] : [...allIds];
    });
  }, [allIds]);

  const enterSelectMode = useCallback(() => setSelectMode(true), []);
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setChecked([]);
  }, []);

  return {
    selectMode,
    selectedIds,
    selected,
    allSelected,
    toggle,
    toggleAll,
    enterSelectMode,
    exitSelectMode,
  };
}
