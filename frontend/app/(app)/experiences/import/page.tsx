"use client";

import Link from "next/link";
import { useEffect, useState, type ChangeEvent } from "react";
import {
  ApiError,
  analyzeExperienceDocument,
  getExtractionTargets,
  saveExtractedExperiences,
} from "@/lib/api";
import type { ExperienceSaveResponse, ExtractionTargetTimeline } from "@/lib/types";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import ExperienceCandidateCard, {
  draftFromCandidate,
  toSaveItem,
  validateDraft,
  type CandidateDraft,
} from "@/components/ExperienceCandidateCard";

const ACCEPT =
  ".pdf,.pptx,.docx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function checkFileType(name: string): string | null {
  const suffix = name.toLowerCase().split(".").pop() ?? "";
  if (suffix === "ppt" || suffix === "doc") {
    return "예전 형식(.ppt/.doc) 파일은 읽을 수 없어요. PPTX·DOCX 또는 PDF로 저장한 뒤 올려주세요.";
  }
  return ["pdf", "pptx", "docx"].includes(suffix) ? null : "PDF, PPTX, DOCX 파일만 올릴 수 있어요.";
}

export default function ImportExperiencesPage() {
  const [targets, setTargets] = useState<ExtractionTargetTimeline[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Null until a file has been analyzed.
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<CandidateDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<ExperienceSaveResponse | null>(null);

  async function loadTargets() {
    try {
      setTargets(await getExtractionTargets());
    } catch {
      // Only the picker's existing-timeline options are missing; "새 타임라인" still works.
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTargets();
  }, []);

  function reset() {
    setFile(null);
    setSourceFilename(null);
    setWarning(null);
    setFailureReason(null);
    setDrafts([]);
    setSaveResult(null);
    setError(null);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const problem = checkFileType(picked.name);
    if (problem) {
      setError(problem);
      return;
    }
    reset();
    setFile(picked);
    runAnalyze(picked);
  }

  async function runAnalyze(target: File) {
    setError(null);
    setAnalyzing(true);
    try {
      // Read-only on the server: candidates come back, nothing is stored.
      const result = await analyzeExperienceDocument(target);
      setSourceFilename(result.source_filename);
      setWarning(result.warning);
      setFailureReason(result.failure_reason);
      setDrafts(result.candidates.map((c, i) => draftFromCandidate(c, i)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "문서를 분석하지 못했어요.");
    } finally {
      setAnalyzing(false);
    }
  }

  function updateDraft(key: number, patch: Partial<CandidateDraft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  const pending = drafts.filter((d) => !d.saved);
  const selected = pending.filter((d) => d.selected);
  const allSelected = pending.length > 0 && selected.length === pending.length;

  async function handleSave() {
    setError(null);
    // Validate every selected card first, so all problems show at once.
    const problems = new Map(selected.map((d) => [d.key, validateDraft(d)]));
    setDrafts((prev) => prev.map((d) => (d.selected && !d.saved ? { ...d, error: problems.get(d.key) ?? null } : d)));
    const valid = selected.filter((d) => !problems.get(d.key));
    if (valid.length !== selected.length) {
      setError("선택한 항목 중 확인이 필요한 곳이 있어요. 빨간 표시를 확인해주세요.");
      return;
    }

    setSaving(true);
    try {
      const response = await saveExtractedExperiences({
        source_filename: sourceFilename,
        items: valid.map(toSaveItem),
      });
      setSaveResult(response);
      setDrafts((prev) =>
        prev.map((d) => {
          const position = valid.findIndex((v) => v.key === d.key);
          if (position === -1) return d;
          const result = response.results.find((r) => r.index === position);
          if (!result) return d;
          return result.saved
            ? { ...d, saved: result, selected: false, error: null }
            : { ...d, error: result.error ?? "저장하지 못했어요." };
        })
      );
      // New timelines / items become pickable for whatever is left.
      loadTargets();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "저장 중 오류가 발생했어요.");
    } finally {
      setSaving(false);
    }
  }

  const retryable = failureReason !== null && file !== null;
  const savedResults = drafts.flatMap((d) => (d.saved ? [d.saved] : []));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/experiences" className="text-sm text-blue-600 hover:underline">
          ← 경험 저장소로
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">문서에서 경험 가져오기</h1>
        <p className="mt-1 text-sm text-gray-500">
          보고서나 발표자료(PDF·PPTX·DOCX)를 올리면 AI가 구체적인 활동을 찾아 상황·행동·결과로 정리해요. 선택한
          항목만 경험 저장소에 저장돼요.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-white p-4">
        <label
          className={`cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 ${
            analyzing || saving ? "pointer-events-none opacity-60" : ""
          }`}
        >
          {file ? "다른 파일 올리기" : "파일 선택"}
          <input type="file" accept={ACCEPT} disabled={analyzing || saving} onChange={handleFileChange} className="hidden" />
        </label>
        <span className="text-sm text-gray-500">
          {file ? file.name : "PDF, PPTX, DOCX · 10MB 이하 · 스캔한 이미지 문서는 읽을 수 없어요"}
        </span>
      </div>

      <ErrorBanner message={error} />

      {analyzing ? (
        <Spinner label="문서를 읽고 경험을 찾는 중이에요. 1분 가까이 걸릴 수 있어요." />
      ) : sourceFilename === null ? null : (
        <>
          {warning && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</div>
          )}

          {saveResult && (
            <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-gray-900">
                경험 {saveResult.saved_count}개를 저장했어요.
                {saveResult.failed_count > 0 && (
                  <span className="text-red-600"> {saveResult.failed_count}개는 저장하지 못했어요 (카드의 안내 참고).</span>
                )}
              </p>
              {savedResults.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-gray-600">
                  {savedResults.map((r) => (
                    <li key={r.sub_experience_id}>
                      {r.timeline_title}
                      {r.created_timeline && <span className="text-xs text-emerald-600"> (새 타임라인)</span>} ›{" "}
                      {r.item_title}
                      {r.created_item && <span className="text-xs text-emerald-600"> (새 세부항목)</span>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Link
                  href="/experiences"
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  경험 저장소에서 보기
                </Link>
                <Link
                  href="/timelines"
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  타임라인에서 보기
                </Link>
              </div>
            </div>
          )}

          {drafts.length === 0 ? (
            <EmptyState
              message={`'${sourceFilename}'에서 저장할 만한 경험 후보를 찾지 못했어요.`}
              action={
                retryable && (
                  <button
                    type="button"
                    onClick={() => file && runAnalyze(file)}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    다시 분석하기
                  </button>
                )
              }
            />
          ) : (
            <>
              <div className="sticky top-14 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50/95 px-3 py-2 backdrop-blur">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={pending.length === 0 || saving}
                    onChange={() =>
                      setDrafts((prev) => prev.map((d) => (d.saved ? d : { ...d, selected: !allSelected, error: null })))
                    }
                  />
                  전체 선택
                </label>
                <span className="text-xs text-gray-500">
                  &apos;{sourceFilename}&apos;에서 찾은 후보 {drafts.length}개 · {selected.length}개 선택
                  {savedResults.length > 0 && ` · ${savedResults.length}개 저장됨`}
                </span>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={selected.length === 0 || saving}
                  className="ml-auto rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "저장 중..." : `선택한 항목 저장 (${selected.length})`}
                </button>
              </div>

              <div className="flex flex-col gap-4">
                {drafts.map((d) => (
                  <ExperienceCandidateCard
                    key={d.key}
                    draft={d}
                    targets={targets}
                    disabled={saving}
                    onChange={(patch) => updateDraft(d.key, patch)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
