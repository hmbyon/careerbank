"use client";

import { useState } from "react";

/** Bumped when the steps change enough that returning users should see it again. */
export const TUTORIAL_VERSION = "v1";

export function tutorialStorageKey(userId: number): string {
  return `cb_tutorial_seen_${TUTORIAL_VERSION}_${userId}`;
}

export function hasSeenTutorial(userId: number): boolean {
  try {
    return localStorage.getItem(tutorialStorageKey(userId)) === "1";
  } catch {
    // Storage unavailable (private mode): treat as seen so we never nag on every load.
    return true;
  }
}

export function markTutorialSeen(userId: number) {
  try {
    localStorage.setItem(tutorialStorageKey(userId), "1");
  } catch {
    // ignore - the modal simply shows again next time
  }
}

const STEPS: { title: string; body: string; tip?: string }[] = [
  {
    title: "경험은행에 오신 걸 환영해요",
    body: "흩어져 있는 내 경험을 한곳에 모아두고, 자소서를 쓸 때 바로 꺼내 쓸 수 있게 도와주는 서비스예요.",
    tip: "1분만 둘러보면 전체 흐름이 잡혀요.",
  },
  {
    title: "1. 이력서로 큰 틀부터 잡아요",
    body: "이력서 화면에서 학력·경력·활동을 적으면 그대로 타임라인이 만들어져요. 기존 이력서 파일(PDF·DOCX)이 있다면 첨부해서 자동으로 채울 수도 있어요.",
    tip: "타임라인 화면에서 하나씩 등록하는 것보다 훨씬 빨라요.",
  },
  {
    title: "2. 타임라인을 세부항목으로 쪼개요",
    body: "각 활동 안에서 기억에 남는 장면을 세부항목으로 나눠두면, 더 구체적인 질문을 받을 수 있어요.",
    tip: "예: '학생회 활동' 안에 '축제 기획', '예산 관리'",
  },
  {
    title: "3. AI 인터뷰로 경험을 꺼내요",
    body: "질문에 답하기만 하면 상황·행동·결과(STAR)로 정리해서 경험 저장소에 쌓아둬요. 답하기 어려운 질문은 건너뛰어도 괜찮아요.",
    tip: "답변은 나중에 언제든 수정할 수 있어요.",
  },
  {
    title: "4. 자소서 문항에 연결해요",
    body: "자소서 문항을 등록하면 저장된 경험 중 어떤 게 잘 맞는지 관련도로 알려줘요. 쓸 경험을 확정하면 초안까지 만들어줘요.",
    tip: "이제 시작해볼까요?",
  },
];

export default function TutorialModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-gray-900">{current.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="가이드 닫기"
            className="shrink-0 rounded-md px-2 py-1 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            건너뛰기
          </button>
        </div>

        <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">{current.body}</p>
        {current.tip && (
          <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">{current.tip}</p>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? "w-5 bg-blue-600" : "w-1.5 bg-gray-300"
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                이전
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? onClose() : setStep((s) => s + 1))}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {isLast ? "시작하기" : "다음"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
