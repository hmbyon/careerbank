"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, getEssayQuestions } from "@/lib/api";
import type { EssayQuestion } from "@/lib/types";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

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
        <Link
          href="/essay-questions/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          등록
        </Link>
      </div>

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
              {group.items.map((q) => (
                <Link
                  key={q.id}
                  href={`/essay-questions/${q.id}/matches`}
                  className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md"
                >
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
                  <p className="line-clamp-2 text-sm font-medium text-gray-900">{q.question_text}</p>
                </Link>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
