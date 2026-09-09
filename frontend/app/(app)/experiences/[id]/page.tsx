"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ApiError,
  deleteExperience,
  getExperiences,
  updateExperience,
} from "@/lib/api";
import type { ExperienceCategory, SubExperience } from "@/lib/types";
import { EXPERIENCE_CATEGORIES } from "@/lib/constants";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function ExperienceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [experience, setExperience] = useState<SubExperience | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [category, setCategory] = useState<ExperienceCategory>("COLLABORATION");
  const [answer, setAnswer] = useState("");
  const [situation, setSituation] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // No single-experience GET endpoint exists; fetch the full list and find by id.
        const all = await getExperiences();
        const found = all.find((e) => e.id === id) ?? null;
        if (!cancelled) {
          setExperience(found);
          if (found) {
            setCategory(found.category);
            setAnswer(found.answer ?? "");
            setSituation(found.situation ?? "");
            setAction(found.action ?? "");
            setResult(found.result ?? "");
          } else {
            setLoadError("경험을 찾을 수 없어요.");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "경험을 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    if (!answer.trim()) {
      setSaveError("원본 답변을 입력해주세요.");
      return;
    }
    if (!situation.trim() || !action.trim() || !result.trim()) {
      setSaveError("상황(S), 행동(A), 결과(R)를 모두 입력해주세요.");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateExperience(id, {
        category,
        situation: situation.trim(),
        action: action.trim(),
        result: result.trim(),
        answer: answer.trim(),
      });
      setExperience(updated);
      setAnswer(updated.answer ?? "");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "저장 중 오류가 발생했어요.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteExperience(id);
      router.push("/experiences");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "삭제 중 오류가 발생했어요.");
      setConfirmOpen(false);
      setDeleting(false);
    }
  }

  if (loading) return <Spinner label="불러오는 중이에요..." />;
  if (!experience) return <ErrorBanner message={loadError ?? "경험을 찾을 수 없어요."} />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-gray-900">경험 상세</h1>

      <div className="rounded-xl border border-gray-200 bg-gray-100 p-4 text-sm text-gray-600">
        <p className="text-xs font-medium text-gray-500">인터뷰 질문</p>
        <p className="mt-1 font-medium text-gray-800">Q. {experience.trigger_question}</p>
      </div>

      <form
        onSubmit={handleSave}
        className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <ErrorBanner message={saveError} />

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">카테고리</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ExperienceCategory)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {EXPERIENCE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">원본 답변</label>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            인터뷰에서 답한 내용이에요. 고치면 아래 S·A·R과 함께 저장돼요.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">상황 (Situation)</label>
          <textarea
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">행동 (Action)</label>
          <textarea
            value={action}
            onChange={(e) => setAction(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">결과 (Result)</label>
          <textarea
            value={result}
            onChange={(e) => setResult(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="mt-2 flex justify-between">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            삭제
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="경험 삭제"
        message={"이 경험을 삭제하면 되돌릴 수 없어요. 정말 삭제할까요?"}
        confirmLabel={deleting ? "삭제 중..." : "삭제"}
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
