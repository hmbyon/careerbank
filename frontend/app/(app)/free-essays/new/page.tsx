"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createFreeEssay, getExperiences, type FreeEssayInput } from "@/lib/api";
import FreeEssayForm from "@/components/FreeEssayForm";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";

export default function NewFreeEssayPage() {
  const router = useRouter();
  const [experienceCount, setExperienceCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const experiences = await getExperiences();
        if (!cancelled) setExperienceCount(experiences.length);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "경험 목록을 불러오지 못했어요.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(values: FreeEssayInput) {
    const created = await createFreeEssay(values);
    if (created.warning) {
      window.alert(created.warning);
    }
    router.push(`/free-essays/${created.id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">자유형식 자소서 작성</h1>
        <p className="mt-1 text-sm text-gray-500">
          회사 정보를 넣으면 저장된 경험 중 잘 맞는 것을 골라 하나의 자기소개서 초안으로 써드려요.
        </p>
      </div>

      <ErrorBanner message={loadError} />

      {experienceCount === null && !loadError ? (
        <Spinner label="경험을 확인하는 중이에요..." />
      ) : experienceCount === 0 ? (
        <EmptyState
          message={"저장된 경험이 없어요.\n타임라인에서 인터뷰로 경험을 먼저 등록해주세요."}
          action={
            <Link
              href="/timelines"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              타임라인으로 가기
            </Link>
          }
        />
      ) : (
        <FreeEssayForm
          submitLabel="초안 생성하기"
          submittingLabel="생성 중..."
          submitErrorMessage="초안 생성 중 오류가 발생했어요."
          busyNotice="AI가 경험을 고르고 초안을 쓰는 중이에요. 1~2분 정도 걸릴 수 있으니 창을 닫지 말아주세요."
          onSubmit={handleSubmit}
          onCancel={() => router.push("/free-essays")}
        />
      )}
    </div>
  );
}
