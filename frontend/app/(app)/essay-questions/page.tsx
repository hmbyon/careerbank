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

const ALL = "__all__";
/** Group key for a question that has no application (should not happen after migration). */
const NO_APPLICATION = 0;

function applicationIdOf(q: EssayQuestion): number {
  return q.application?.id ?? NO_APPLICATION;
}

function applicationLabel(q: EssayQuestion): string {
  if (!q.application) return "지원 미지정";
  return [q.application.company, q.application.position].filter(Boolean).join(" · ");
}

export default function EssayQuestionsPage() {
  const [questions, setQuestions] = useState<EssayQuestion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applicationFilter, setApplicationFilter] = useState<number | typeof ALL>(ALL);

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

  // Applications in the order they first appear (list is newest-first), with
  // questions lacking one last so they never push real applications down.
  const applications = useMemo(() => {
    const seen: { id: number; label: string; count: number }[] = [];
    for (const q of questions ?? []) {
      const id = applicationIdOf(q);
      const found = seen.find((a) => a.id === id);
      if (found) found.count += 1;
      else seen.push({ id, label: applicationLabel(q), count: 1 });
    }
    return [...seen.filter((a) => a.id !== NO_APPLICATION), ...seen.filter((a) => a.id === NO_APPLICATION)];
  }, [questions]);

  const groups = useMemo(() => {
    const visible = applicationFilter === ALL ? applications : applications.filter((a) => a.id === applicationFilter);
    return visible
      .map((a) => ({
        ...a,
        items: (questions ?? []).filter((q) => applicationIdOf(q) === a.id),
      }))
      .filter((g) => g.items.length > 0);
  }, [applications, applicationFilter, questions]);

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
          message={"아직 등록된 자소서 문항이 없어요.\n지원 관리에서 지원을 고르고 문항을 추가해보세요."}
          action={
            <Link
              href="/applications"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              지원 관리로 가기
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {applications.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setApplicationFilter(ALL)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  applicationFilter === ALL
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                전체 ({questions.length})
              </button>
              {applications.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setApplicationFilter(a.id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    applicationFilter === a.id
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  {a.label} ({a.count})
                </button>
              ))}
            </div>
          )}

          {groups.map((group) => (
            <section key={group.id} className="flex flex-col gap-3">
              <h2 className="flex items-baseline gap-2 border-b border-gray-200 pb-2">
                {group.id === NO_APPLICATION ? (
                  <span className="text-base font-semibold text-gray-500">{group.label}</span>
                ) : (
                  <Link
                    href={`/applications/${group.id}`}
                    className="text-base font-semibold text-gray-900 hover:text-blue-600 hover:underline"
                  >
                    {group.label}
                  </Link>
                )}
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
                      {q.char_limit && <span className="text-xs text-gray-400">{q.char_limit}자</span>}
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
