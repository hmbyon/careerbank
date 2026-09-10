"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  getInterviewQuestion,
  getTimelineItems,
  getTimelines,
  postInterviewAnswer,
} from "@/lib/api";
import type { ExperienceCategory, InterviewQuestion } from "@/lib/types";
import { activityCategoryLabel, experienceCategoryLabel } from "@/lib/constants";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";

export default function InterviewClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const timelineIdRaw = searchParams.get("timelineId");
  const itemIdRaw = searchParams.get("itemId");
  const timelineId = timelineIdRaw ? Number(timelineIdRaw) : NaN;
  const itemId = itemIdRaw ? Number(itemIdRaw) : null;

  const [contextLabel, setContextLabel] = useState<string | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);

  const [question, setQuestion] = useState<InterviewQuestion | null>(null);
  const [loadingQuestion, setLoadingQuestion] = useState(true);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  // Categories skipped in this sitting. Session-only: nothing is saved, and
  // remounting (re-entering the interview) starts from an empty list again.
  const [skipped, setSkipped] = useState<ExperienceCategory[]>([]);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    if (!timelineIdRaw || Number.isNaN(timelineId)) return;
    let cancelled = false;
    (async () => {
      setLoadingContext(true);
      try {
        const timelines = await getTimelines();
        const timeline = timelines.find((t) => t.id === timelineId);
        let label = timeline
          ? `${activityCategoryLabel(timeline.category)} · ${timeline.title}`
          : `타임라인 #${timelineId}`;
        if (itemId) {
          try {
            const items = await getTimelineItems(timelineId);
            const item = items.find((i) => i.id === itemId);
            if (item) label += ` > ${item.title}`;
          } catch {
            // Context label is a nice-to-have; ignore failures here.
          }
        }
        if (!cancelled) setContextLabel(label);
      } catch {
        if (!cancelled) setContextLabel(`타임라인 #${timelineId}`);
      } finally {
        if (!cancelled) setLoadingContext(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [timelineId, timelineIdRaw, itemId]);

  useEffect(() => {
    if (!timelineIdRaw || Number.isNaN(timelineId)) return;
    let cancelled = false;
    (async () => {
      setLoadingQuestion(true);
      setError(null);
      try {
        const q = await getInterviewQuestion(timelineId, itemId ?? undefined);
        if (cancelled) return;
        setQuestion(q);
        setFinished(!q.question);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "질문을 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoadingQuestion(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [timelineId, timelineIdRaw, itemId]);

  async function handleSkip() {
    if (!question?.category) return;
    // Pass the new list explicitly - state updates don't apply until re-render.
    const nextSkipped: ExperienceCategory[] = [
      ...skipped,
      question.category as ExperienceCategory,
    ];
    setSkipping(true);
    setError(null);
    try {
      const q = await getInterviewQuestion(timelineId, itemId ?? undefined, nextSkipped);
      setSkipped(nextSkipped);
      setAnswer("");
      if (q.question) {
        setQuestion(q);
      } else {
        // Everything is either answered or skipped.
        setQuestion(null);
        setFinished(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "다음 질문을 불러오지 못했어요.");
    } finally {
      setSkipping(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!question?.question || !question.category) return;
    if (!answer.trim()) {
      setError("답변을 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await postInterviewAnswer({
        timeline_id: timelineId,
        item_id: itemId,
        category: question.category as ExperienceCategory,
        trigger_question: question.question,
        answer: answer.trim(),
      });
      setAnswer("");

      // POST /answer picks the next question from the DB only, so it can hand
      // back a category this session already skipped. Ask again with the skip
      // list when that happens; if that second call fails we just keep what the
      // answer response gave us.
      let next = res.next_question;
      if (next?.category && skipped.includes(next.category as ExperienceCategory)) {
        try {
          next = await getInterviewQuestion(timelineId, itemId ?? undefined, skipped);
        } catch {
          // Keep `next` as-is - the answer is already saved either way.
        }
      }

      if (next && next.question) {
        setQuestion(next);
      } else {
        setQuestion(null);
        setFinished(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "답변 저장 중 오류가 발생했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!timelineIdRaw || Number.isNaN(timelineId)) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorBanner message="타임라인 정보가 없어요. 타임라인 목록에서 다시 시도해주세요." />
        <Link href="/timelines" className="text-sm font-medium text-blue-600 hover:underline">
          타임라인으로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-gray-500">AI 인터뷰</p>
        <h1 className="text-2xl font-bold text-gray-900">경험을 들려주세요</h1>
      </div>

      <div className="inline-flex w-fit items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-700">
        {loadingContext ? "불러오는 중..." : contextLabel}
      </div>

      <ErrorBanner message={error} />

      {loadingQuestion ? (
        <Spinner label="질문을 준비하는 중이에요..." />
      ) : finished ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
          <p className="text-lg font-medium text-gray-700">더 물어볼 게 없어요</p>
          <p className="text-sm text-gray-500">
            이 활동에 대해 다룰 수 있는 질문을 모두 마쳤어요. 저장된 경험을 확인해보세요.
          </p>
          <Link
            href="/experiences"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            경험 저장소로 이동
          </Link>
        </div>
      ) : question && question.question ? (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          {question.category && (
            <span className="inline-flex w-fit items-center rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
              {experienceCategoryLabel(question.category)}
            </span>
          )}
          <p className="text-lg font-medium text-gray-900">{question.question}</p>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={6}
            placeholder="구체적인 상황, 행동, 결과를 떠올리며 편하게 적어주세요."
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="flex flex-wrap justify-between gap-2">
            <button
              type="button"
              onClick={() => router.push("/experiences")}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              인터뷰 종료
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSkip}
                disabled={skipping || submitting}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {skipping ? "다음 질문 준비 중..." : "건너뛰기"}
              </button>
              <button
                type="submit"
                disabled={submitting || skipping || !answer.trim()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "저장 중..." : "답변 제출"}
              </button>
            </div>
          </div>
          {skipped.length > 0 && (
            <p className="text-xs text-gray-400">
              이번 인터뷰에서 {skipped.length}개 질문을 건너뛰었어요. (저장되지 않아요)
            </p>
          )}
        </form>
      ) : null}
    </div>
  );
}
