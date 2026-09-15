"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, createEssayQuestion, getApplications, type EssayQuestionInput } from "@/lib/api";
import type { Application } from "@/lib/types";
import EssayQuestionForm from "@/components/EssayQuestionForm";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

/**
 * "문항 추가" on /applications/[id] links here with ?application_id=, which fixes
 * the application. Without it (e.g. from the all-questions list) the user picks one.
 */
export default function NewEssayQuestionClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedId = Number(searchParams.get("application_id")) || null;

  const [applications, setApplications] = useState<Application[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getApplications();
        if (!cancelled) setApplications(data);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "지원 목록을 불러오지 못했어요.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fixed = applications?.find((a) => a.id === requestedId) ?? null;
  const selected = fixed ?? applications?.find((a) => a.id === pickedId) ?? null;

  async function handleSubmit(values: EssayQuestionInput) {
    if (!selected) return;
    const created = await createEssayQuestion({ ...values, application_id: selected.id });
    if (created.warning) {
      window.alert(created.warning);
    }
    router.push(`/essay-questions/${created.id}/matches`);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-gray-900">자소서 문항 등록</h1>

      <ErrorBanner message={loadError} />

      {applications === null && !loadError ? (
        <Spinner label="지원 목록을 불러오는 중이에요..." />
      ) : applications !== null && applications.length === 0 ? (
        <EmptyState
          message={"문항은 지원(회사·직무) 아래에 등록돼요.\n먼저 지원을 등록해주세요."}
          action={
            <Link
              href="/applications/new"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              지원 등록하기
            </Link>
          }
        />
      ) : applications !== null ? (
        <>
          {fixed ? (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm">
              <span className="text-gray-500">지원</span>{" "}
              <span className="font-semibold text-gray-900">{fixed.company}</span>
              {fixed.position && <span className="text-gray-500"> · {fixed.position}</span>}
              {fixed.job_description && (
                <span className="ml-2 text-xs text-gray-400">채용공고가 매칭과 초안에 반영돼요</span>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <label className="mb-1 block text-sm font-medium text-gray-700">어느 지원의 문항인가요?</label>
              <select
                value={pickedId ?? ""}
                onChange={(e) => setPickedId(e.target.value ? Number(e.target.value) : null)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">지원을 선택해주세요</option>
                {applications.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.company}
                    {a.position ? ` · ${a.position}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selected && (
            <EssayQuestionForm
              key={selected.id}
              submitLabel="등록하고 매칭 보기"
              submittingLabel="등록 중..."
              submitErrorMessage="문항 등록 중 오류가 발생했어요."
              onSubmit={handleSubmit}
              onCancel={() => router.push(fixed ? `/applications/${fixed.id}` : "/essay-questions")}
            />
          )}
        </>
      ) : null}
    </div>
  );
}
