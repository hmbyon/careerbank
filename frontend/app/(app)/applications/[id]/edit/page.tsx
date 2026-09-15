"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, getApplication, updateApplication, type ApplicationInput } from "@/lib/api";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import ApplicationForm from "@/components/ApplicationForm";

export default function EditApplicationPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initial, setInitial] = useState<ApplicationInput | null>(null);
  const [questionCount, setQuestionCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const found = await getApplication(id);
        if (!cancelled) {
          setInitial({
            company: found.company,
            position: found.position,
            job_description: found.job_description,
          });
          setQuestionCount(found.question_count);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "지원 정보를 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(values: ApplicationInput) {
    await updateApplication(id, values);
    router.push(`/applications/${id}`);
  }

  if (loading) return <Spinner label="지원 정보를 불러오는 중이에요..." />;
  if (loadError || !initial) return <ErrorBanner message={loadError ?? "지원을 찾을 수 없어요."} />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-gray-900">지원 수정</h1>

      <ApplicationForm
        initial={initial}
        questionCount={questionCount}
        submitLabel="저장"
        submittingLabel="저장 중..."
        submitErrorMessage="지원 수정 중 오류가 발생했어요."
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/applications/${id}`)}
      />
    </div>
  );
}
