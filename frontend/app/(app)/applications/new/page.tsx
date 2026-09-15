"use client";

import { useRouter } from "next/navigation";
import { createApplication, type ApplicationInput } from "@/lib/api";
import ApplicationForm from "@/components/ApplicationForm";

export default function NewApplicationPage() {
  const router = useRouter();

  async function handleSubmit(values: ApplicationInput) {
    const created = await createApplication(values);
    router.push(`/applications/${created.id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">지원 등록</h1>
        <p className="mt-1 text-sm text-gray-500">
          회사·직무와 채용공고를 입력하면, 이 지원에 추가하는 모든 자소서 문항에 함께 반영돼요.
        </p>
      </div>

      <ApplicationForm
        submitLabel="등록"
        submittingLabel="등록 중..."
        submitErrorMessage="지원 등록 중 오류가 발생했어요."
        onSubmit={handleSubmit}
        onCancel={() => router.push("/applications")}
      />
    </div>
  );
}
