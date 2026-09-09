"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ApiError,
  generateDraft,
  getEssayQuestions,
  saveDraft,
} from "@/lib/api";
import type { EssayQuestion } from "@/lib/types";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function EssayQuestionDraftPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [question, setQuestion] = useState<EssayQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draftText, setDraftText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await getEssayQuestions();
        const found = list.find((q) => q.id === id) ?? null;
        if (!cancelled) {
          setQuestion(found);
          const text = found?.draft_text ?? "";
          setDraftText(text);
          setSavedText(text);
          if (!found) setError("자소서 문항을 찾을 수 없어요.");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "초안을 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const hasUnsavedEdits = draftText !== savedText;
  const charLimit = question?.char_limit ?? null;
  const overLimit = charLimit !== null && draftText.length > charLimit;

  async function runRegenerate() {
    setRegenConfirmOpen(false);
    setRegenerating(true);
    setActionError(null);
    setSaveSuccess(false);
    try {
      const updated = await generateDraft(id);
      const text = updated.draft_text ?? "";
      setQuestion(updated);
      setDraftText(text);
      setSavedText(text);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "초안 재생성 중 오류가 발생했어요.");
    } finally {
      setRegenerating(false);
    }
  }

  function handleRegenerateClick() {
    if (hasUnsavedEdits) {
      setRegenConfirmOpen(true);
    } else {
      runRegenerate();
    }
  }

  async function handleSave() {
    setSaving(true);
    setActionError(null);
    setSaveSuccess(false);
    try {
      const updated = await saveDraft(id, draftText);
      setQuestion(updated);
      setSavedText(draftText);
      setSaveSuccess(true);
      router.push("/essay-questions");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "저장 중 오류가 발생했어요.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="초안을 불러오는 중이에요..." />;
  if (!question) return <ErrorBanner message={error ?? "자소서 문항을 찾을 수 없어요."} />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-gray-500">자소서 초안</p>
        <h1 className="text-xl font-bold text-gray-900">{question.question_text}</h1>
      </div>

      <ErrorBanner message={actionError} />
      {saveSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          저장됐어요.
        </div>
      )}

      {!savedText && !draftText ? (
        <EmptyState message={"아직 생성된 초안이 없어요."} />
      ) : null}

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <textarea
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          rows={14}
          placeholder="초안이 여기에 표시돼요."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className={overLimit ? "font-semibold text-red-600" : "text-gray-400"}>
            {draftText.length}
            {charLimit !== null ? ` / ${charLimit}자` : "자"}
            {overLimit && " - 글자수 제한을 초과했어요"}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={handleRegenerateClick}
          disabled={regenerating}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {regenerating ? "다시 생성하는 중..." : "다시 생성"}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !draftText.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>

      <ConfirmDialog
        open={regenConfirmOpen}
        title="초안 다시 생성"
        message={"저장하지 않은 수정 내용이 사라져요. 그래도 다시 생성할까요?"}
        confirmLabel="다시 생성"
        danger
        onConfirm={runRegenerate}
        onCancel={() => setRegenConfirmOpen(false)}
      />
    </div>
  );
}
