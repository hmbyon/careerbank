"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { ApplicationBrief } from "@/lib/types";
import {
  ApiError,
  getEssayQuestions,
  updateEssayQuestion,
  type EssayQuestionInput,
} from "@/lib/api";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EssayQuestionForm from "@/components/EssayQuestionForm";

export default function EditEssayQuestionPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initial, setInitial] = useState<EssayQuestionInput | null>(null);
  const [application, setApplication] = useState<ApplicationBrief | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // No single-question GET endpoint exists; fetch the list and find by id
        // (same approach the experience detail page uses).
        const found = (await getEssayQuestions()).find((q) => q.id === id) ?? null;
        if (!cancelled) {
          if (found) {
            setInitial({
              question_text: found.question_text,
              char_limit: found.char_limit,
            });
            setApplication(found.application);
          } else {
            setLoadError("자소서 문항을 찾을 수 없어요.");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "문항을 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(values: EssayQuestionInput) {
    await updateEssayQuestion(id, values);
    router.push(`/essay-questions/${id}/matches`);
  }

  if (loading) return <Spinner label="문항을 불러오는 중이에요..." />;
  if (loadError || !initial) return <ErrorBanner message={loadError ?? "자소서 문항을 찾을 수 없어요."} />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">자소서 문항 수정</h1>
        {application && (
          <p className="mt-1 text-sm text-gray-500">
            {[application.company, application.position].filter(Boolean).join(" · ")}
            <span className="ml-2 text-xs text-gray-400">
              회사·직무·채용공고는{" "}
              <Link href={`/applications/${application.id}/edit`} className="text-blue-600 hover:underline">
                지원 수정
              </Link>
              에서 바꿀 수 있어요.
            </span>
          </p>
        )}
      </div>

      <EssayQuestionForm
        initial={initial}
        originalQuestionText={initial.question_text}
        submitLabel="저장"
        submittingLabel="저장 중..."
        submitErrorMessage="문항 수정 중 오류가 발생했어요."
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/essay-questions/${id}/matches`)}
      />
    </div>
  );
}
