"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, deleteEssayQuestion, getEssayQuestions } from "@/lib/api";
import type { EssayQuestion } from "@/lib/types";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import SelectionToolbar from "@/components/SelectionToolbar";
import { useSelection } from "@/lib/useSelection";

/** Questions saved without a company are still worth listing, under one heading. */
const NO_COMPANY = "회사 미지정";
const ALL = "__all__";

function companyOf(q: EssayQuestion): string {
  return q.company?.trim() || NO_COMPANY;
}

export default function EssayQuestionsPage() {
  const [questions, setQuestions] = useState<EssayQuestion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string>(ALL);

  const ids = (questions ?? []).map((q) => q.id);
  const selection = useSelection(ids);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getEssayQuestions();
        if (!cancelled) setQuestions(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "자소서 문항을 불러오지 못했어요.");
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
      setQuestions(await getEssayQuestions());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "자소서 문항을 불러오지 못했어요.");
    }
  }

  async function handleBulkDelete(targetIds: number[]) {
    setError(null);
    try {
      for (const id of targetIds) {
        await deleteEssayQuestion(id);
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
    itemNoun: "자소서 문항",
    cascadeWarning: "각 문항의 매칭 결과와 저장된 초안도 함께 삭제됩니다.",
  };

  // Companies in the order they first appear (list is newest-first), with the
  // "no company" bucket last so it never pushes real companies down.
  const companies = useMemo(() => {
    const names: string[] = [];
    for (const q of questions ?? []) {
      const name = companyOf(q);
      if (name !== NO_COMPANY && !names.includes(name)) names.push(name);
    }
    if ((questions ?? []).some((q) => companyOf(q) === NO_COMPANY)) names.push(NO_COMPANY);
    return names;
  }, [questions]);

  const groups = useMemo(() => {
    const visible = companyFilter === ALL ? companies : companies.filter((c) => c === companyFilter);
    return visible
      .map((name) => ({
        name,
        items: (questions ?? []).filter((q) => companyOf(q) === name),
      }))
      .filter((g) => g.items.length > 0);
  }, [companies, companyFilter, questions]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">자소서 문항</h1>
        <div className="flex items-center gap-2">
          {!selection.selectMode && <SelectionToolbar {...toolbarProps} />}
        <Link
          href="/essay-questions/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          등록
        </Link>
        </div>
      </div>

      {selection.selectMode && <SelectionToolbar {...toolbarProps} />}

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="자소서 문항을 불러오는 중이에요..." />
      ) : !questions || questions.length === 0 ? (
        <EmptyState
          message={"아직 등록된 자소서 문항이 없어요. 새 문항을 등록해보세요."}
          action={
            <Link
              href="/essay-questions/new"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              문항 등록하기
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {companies.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCompanyFilter(ALL)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  companyFilter === ALL
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                전체 ({questions.length})
              </button>
              {companies.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setCompanyFilter(name)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    companyFilter === name
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  {name} ({questions.filter((q) => companyOf(q) === name).length})
                </button>
              ))}
            </div>
          )}

          {groups.map((group) => (
            <section key={group.name} className="flex flex-col gap-3">
              <h2 className="flex items-baseline gap-2 border-b border-gray-200 pb-2">
                <span
                  className={`text-base font-semibold ${
                    group.name === NO_COMPANY ? "text-gray-500" : "text-gray-900"
                  }`}
                >
                  {group.name}
                </span>
                <span className="text-xs text-gray-400">{group.items.length}개</span>
              </h2>
              {group.items.map((q) => {
                const body = (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                          q.status === "매칭완료"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {q.status ?? "매칭대기"}
                      </span>
                      {q.position && <span className="text-xs text-gray-400">{q.position}</span>}
                    </div>
                    <p className="line-clamp-2 text-sm font-medium text-gray-900">
                      {q.question_text}
                    </p>
                  </>
                );
                const cardClass = `flex flex-col gap-2 rounded-xl border bg-white p-4 shadow-sm ${
                  selection.selectMode
                    ? selection.selected.has(q.id)
                      ? "cursor-pointer border-blue-400 ring-1 ring-blue-200"
                      : "cursor-pointer border-gray-200"
                    : "border-gray-200 hover:shadow-md"
                }`;

                // Outside select mode the card keeps navigating to the matches screen.
                if (!selection.selectMode) {
                  return (
                    <Link key={q.id} href={`/essay-questions/${q.id}/matches`} className={cardClass}>
                      {body}
                    </Link>
                  );
                }
                return (
                  <div
                    key={q.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selection.toggle(q.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selection.toggle(q.id);
                      }
                    }}
                    className={cardClass}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selection.selected.has(q.id)}
                        readOnly
                        className="mt-1"
                      />
                      <div className="flex flex-1 flex-col gap-2">{body}</div>
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
