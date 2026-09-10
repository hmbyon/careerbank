"use client";

import { useRouter } from "next/navigation";
import { createEssayQuestion, type EssayQuestionInput } from "@/lib/api";
import EssayQuestionForm from "@/components/EssayQuestionForm";

export default function NewEssayQuestionPage() {
  const router = useRouter();

  async function handleSubmit(values: EssayQuestionInput) {
    const created = await createEssayQuestion(values);
    if (created.warning) {
      window.alert(created.warning);
    }
    router.push(`/essay-questions/${created.id}/matches`);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-gray-900">자소서 문항 등록</h1>

      <EssayQuestionForm
        submitLabel="등록하고 매칭 보기"
        submittingLabel="등록 중..."
        submitErrorMessage="문항 등록 중 오류가 발생했어요."
        onSubmit={handleSubmit}
        onCancel={() => router.push("/essay-questions")}
      />
    </div>
  );
}
