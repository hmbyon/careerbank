"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, getFreeEssay, updateFreeEssay, type FreeEssayInput } from "@/lib/api";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import FreeEssayForm from "@/components/FreeEssayForm";

export default function EditFreeEssayPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initial, setInitial] = useState<FreeEssayInput | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const found = await getFreeEssay(id);
        if (!cancelled) {
          setInitial({
            company: found.company,
            position: found.position,
            job_description: found.job_description,
            char_limit: found.char_limit,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "자유형식 자소서를 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(values: FreeEssayInput) {
    await updateFreeEssay(id, values);
    router.push(`/free-essays/${id}`);
  }

  if (loading) return <Spinner label="불러오는 중이에요..." />;
  if (loadError || !initial) return <ErrorBanner message={loadError ?? "자유형식 자소서를 찾을 수 없어요."} />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">자유형식 자소서 수정</h1>
        <p className="mt-1 text-sm text-gray-500">
          입력값을 바꾼 뒤에는 상세 화면에서 &apos;다시 생성&apos;을 눌러야 초안에 반영돼요.
        </p>
      </div>
      <FreeEssayForm
        initial={initial}
        submitLabel="저장"
        submittingLabel="저장 중..."
        submitErrorMessage="수정 중 오류가 발생했어요."
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/free-essays/${id}`)}
      />
    </div>
  );
}
