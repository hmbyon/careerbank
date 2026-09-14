"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, deleteFreeEssay, getFreeEssay, regenerateFreeEssay } from "@/lib/api";
import type { FreeEssayDetail, FreeEssayStatus } from "@/lib/types";
import { FREE_ESSAY_STATUS_LABELS, experienceCategoryLabel } from "@/lib/constants";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import ConfirmDialog from "@/components/ConfirmDialog";

const STATUS_STYLE: Record<FreeEssayStatus, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700",
};

export default function FreeEssayDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [essay, setEssay] = useState<FreeEssayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getFreeEssay(id);
        if (!cancelled) setEssay(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "자유형식 자소서를 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleRegenerate() {
    setRegenConfirmOpen(false);
    setError(null);
    setNotice(null);
    setRegenerating(true);
    try {
      const updated = await regenerateFreeEssay(id);
      setEssay(updated);
      if (updated.warning) setNotice(updated.warning);
      else setNotice("초안을 새로 생성했어요.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "초안을 다시 생성하지 못했어요.");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteFreeEssay(id);
      router.push("/free-essays");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "삭제 중 오류가 발생했어요.");
      setDeleteConfirmOpen(false);
      setDeleting(false);
    }
  }

  if (loading) return <Spinner label="자유형식 자소서를 불러오는 중이에요..." />;
  if (!essay) return <ErrorBanner message={error ?? "자유형식 자소서를 찾을 수 없어요."} />;

  const draftLength = essay.draft_text?.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">자유형식 자소서</p>
          <h1 className="text-xl font-bold text-gray-900">
            {essay.company}
            {essay.position && (
              <span className="ml-2 text-base font-medium text-gray-500">{essay.position}</span>
            )}
          </h1>
          <span
            className={`mt-2 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[essay.status]}`}
          >
            {FREE_ESSAY_STATUS_LABELS[essay.status]}
          </span>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/free-essays/${id}/edit`}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            수정
          </Link>
          <button
            type="button"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={regenerating}
            className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            삭제
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {notice}
        </div>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">초안</h2>
          <div className="flex items-center gap-3">
            {essay.draft_text && (
              <span className="text-xs text-gray-400">
                {draftLength}자{essay.char_limit ? ` / 제한 ${essay.char_limit}자` : ""}
              </span>
            )}
            <button
              type="button"
              onClick={() => setRegenConfirmOpen(true)}
              disabled={regenerating}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {regenerating ? "생성 중..." : "다시 생성"}
            </button>
          </div>
        </div>

        {regenerating ? (
          <Spinner label="AI가 경험을 다시 고르고 초안을 쓰는 중이에요. 1~2분 걸릴 수 있어요." />
        ) : essay.draft_text ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-800">{essay.draft_text}</p>
        ) : (
          <p className="text-sm text-gray-500">
            {essay.status === "FAILED"
              ? "초안 생성에 실패했어요. 잠시 후 '다시 생성'을 눌러주세요."
              : "아직 생성된 초안이 없어요."}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-gray-900">
          반영된 경험 <span className="text-sm font-normal text-gray-400">{essay.used_experiences.length}개</span>
        </h2>
        {essay.used_experiences.length === 0 ? (
          <EmptyState message={"이 초안에 반영된 경험이 없어요."} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {essay.used_experiences.map((exp) => (
              <Link
                key={exp.sub_experience_id}
                href={`/experiences/${exp.sub_experience_id}`}
                className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex w-fit items-center rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
                    {experienceCategoryLabel(exp.category)}
                  </span>
                  <span className="truncate text-xs text-gray-400">{exp.title}</span>
                </div>
                <p className="line-clamp-2 text-sm text-gray-700">Q. {exp.trigger_question}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {essay.job_description && (
        <details className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">채용공고 보기</summary>
          <p className="mt-3 whitespace-pre-line text-sm text-gray-600">{essay.job_description}</p>
        </details>
      )}

      <ConfirmDialog
        open={regenConfirmOpen}
        title="초안 다시 생성"
        message={"현재 초안을 새로 생성한 초안으로 바꿀까요?\n반영할 경험도 다시 선택돼요."}
        confirmLabel="다시 생성"
        onConfirm={handleRegenerate}
        onCancel={() => setRegenConfirmOpen(false)}
      />
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="자유형식 자소서 삭제"
        message={"이 자소서를 삭제하면 되돌릴 수 없어요.\n생성된 초안도 함께 사라집니다."}
        confirmLabel={deleting ? "삭제 중..." : "삭제"}
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}
