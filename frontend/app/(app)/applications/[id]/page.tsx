"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, deleteApplication, getApplication } from "@/lib/api";
import type { ApplicationDetail } from "@/lib/types";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getApplication(id);
        if (!cancelled) setApplication(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "지원 정보를 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteApplication(id);
      router.push("/applications");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "삭제 중 오류가 발생했어요.");
      setDeleteConfirmOpen(false);
      setDeleting(false);
    }
  }

  if (loading) return <Spinner label="지원 정보를 불러오는 중이에요..." />;
  if (!application) return <ErrorBanner message={error ?? "지원을 찾을 수 없어요."} />;

  const questionCount = application.questions.length;
  const draftCount = application.questions.filter((q) => q.draft_text).length;
  const addHref = `/essay-questions/new?application_id=${application.id}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">지원</p>
          <h1 className="text-xl font-bold text-gray-900">
            {application.company}
            {application.position && (
              <span className="ml-2 text-base font-medium text-gray-500">{application.position}</span>
            )}
          </h1>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/applications/${id}/edit`}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            수정
          </Link>
          <button
            type="button"
            onClick={() => setDeleteConfirmOpen(true)}
            className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            삭제
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {application.job_description ? (
        <details className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">채용공고 보기</summary>
          <p className="mt-3 whitespace-pre-line text-sm text-gray-600">{application.job_description}</p>
        </details>
      ) : (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-500">
          채용공고가 없어요. &apos;수정&apos;에서 붙여넣으면 이 지원의 모든 문항 매칭과 초안에 반영돼요.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">
            자소서 문항 <span className="text-sm font-normal text-gray-400">{questionCount}개</span>
          </h2>
          <Link
            href={addHref}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            문항 추가
          </Link>
        </div>

        {questionCount === 0 ? (
          <EmptyState
            message={"아직 이 지원에 등록된 자소서 문항이 없어요.\n문항을 추가하면 저장된 경험과 바로 매칭해드려요."}
          />
        ) : (
          application.questions.map((q, index) => (
            <Link
              key={q.id}
              href={`/essay-questions/${q.id}/matches`}
              className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-gray-400">문항 {index + 1}</span>
                <span
                  className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                    q.status === "매칭완료" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {q.status ?? "매칭대기"}
                </span>
              </div>
              <p className="line-clamp-2 text-sm font-medium text-gray-900">{q.question_text}</p>
              {q.char_limit && <p className="text-xs text-gray-400">글자수 제한 {q.char_limit}자</p>}
            </Link>
          ))
        )}
      </section>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="지원 삭제"
        message={
          `"${application.company}" 지원을 삭제할까요? 되돌릴 수 없어요.\n` +
          (questionCount > 0
            ? `이 지원의 자소서 문항 ${questionCount}개와 매칭 결과, 저장된 초안 ${draftCount}개가 함께 삭제됩니다.`
            : "이 지원에 등록된 자소서 문항은 없어요.")
        }
        confirmLabel={deleting ? "삭제 중..." : "삭제"}
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}
