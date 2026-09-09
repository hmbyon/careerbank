"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { upload } from "@vercel/blob/client";
import {
  ApiError,
  downloadResumePdf,
  getResume,
  getTimelines,
  importResume,
  saveResume,
} from "@/lib/api";
import type {
  ActivityCategory,
  Resume,
  ResumeImport,
  ResumeImportItem,
  ResumeItem,
  ResumeSectionKey,
} from "@/lib/types";
import { monthInputToDate, toMonthInput } from "@/lib/date";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";
import ConfirmDialog from "@/components/ConfirmDialog";

const SECTIONS: { key: ResumeSectionKey; label: string }[] = [
  { key: "education", label: "학력" },
  { key: "career", label: "경력" },
  { key: "activity", label: "대외활동" },
  { key: "certificate", label: "자격증" },
];

/** Same grouping the backend uses when it builds the draft. */
const CATEGORY_TO_SECTION: Record<ActivityCategory, ResumeSectionKey> = {
  EDUCATION: "education",
  CAREER: "career",
  ACTIVITY: "activity",
  CERTIFICATE: "certificate",
};

/** A row being edited. `key` is a stable React key; empty dates are "" (not null). */
interface EditableItem {
  key: number;
  title: string;
  start_date: string;
  end_date: string;
  /** timeline_entries row this row is linked to; null until the first save creates it. */
  timelineEntryId: number | null;
  /** Custom PDF heading; blank falls back to the category label. */
  sectionLabel: string;
  /** One bullet per non-empty line. */
  description: string;
}

type SectionState = Record<ResumeSectionKey, EditableItem[]>;

const EMPTY_SECTIONS: SectionState = {
  education: [],
  career: [],
  activity: [],
  certificate: [],
};

let keySeq = 0;
function nextKey(): number {
  keySeq += 1;
  return keySeq;
}

/** Accepts both saved items and the looser shape an import produces. */
type SourceItem = ResumeImportItem & { timeline_entry_id?: number | null };

function toEditable(items: SourceItem[]): EditableItem[] {
  return items.map((item) => ({
    key: nextKey(),
    title: item.title,
    start_date: toMonthInput(item.start_date),
    end_date: toMonthInput(item.end_date),
    timelineEntryId: item.timeline_entry_id ?? null,
    sectionLabel: item.section_label ?? "",
    description: item.description ?? "",
  }));
}

export default function ResumePage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [sections, setSections] = useState<SectionState>(EMPTY_SECTIONS);
  const [isDraft, setIsDraft] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [syncedToTimeline, setSyncedToTimeline] = useState(false);

  const applyResume = useCallback((data: Resume | ResumeImport, updateDraftFlag = true) => {
    setName(data.name);
    setEmail(data.email);
    setPhone(data.phone ?? "");
    setBirthDate(data.birth_date ?? "");
    setPhotoUrl(data.photo_url ?? "");
    setSections({
      education: toEditable(data.content.education),
      career: toEditable(data.content.career),
      activity: toEditable(data.content.activity),
      certificate: toEditable(data.content.certificate),
    });
    // An import replaces the form contents but says nothing about whether a
    // resume row exists, so it leaves the draft banner alone.
    if (updateDraftFlag) setIsDraft(data.draft);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await getResume();
        if (!cancelled) applyResume(data);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "이력서를 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyResume]);

  /**
   * Re-fills the item sections from the user's timeline entries.
   * GET /api/resume returns the *saved* resume once one exists, so re-reading it
   * wouldn't pick up timeline changes - group the timeline here instead.
   * Contact fields are left alone: the timeline holds no name/email/phone.
   */
  async function handleReloadFromTimeline() {
    setConfirmOpen(false);
    setFormError(null);
    setNotice(null);
    setSyncedToTimeline(false);
    setReloading(true);
    try {
      const entries = await getTimelines();
      const next: SectionState = { education: [], career: [], activity: [], certificate: [] };
      for (const entry of [...entries].sort((a, b) => b.start_date.localeCompare(a.start_date))) {
        const section = CATEGORY_TO_SECTION[entry.category];
        if (!section) continue;
        next[section].push({
          key: nextKey(),
          title: entry.title,
          start_date: toMonthInput(entry.start_date),
          end_date: toMonthInput(entry.end_date),
          timelineEntryId: entry.id,
          sectionLabel: "",
          description: "",
        });
      }
      setSections(next);
      setNotice("최신 타임라인 데이터로 다시 채웠어요. 저장을 눌러야 반영돼요.");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "타임라인을 불러오지 못했어요.");
    } finally {
      setReloading(false);
    }
  }

  function updateItem(section: ResumeSectionKey, key: number, patch: Partial<EditableItem>) {
    setSections((prev) => ({
      ...prev,
      [section]: prev[section].map((item) => (item.key === key ? { ...item, ...patch } : item)),
    }));
  }

  function addItem(section: ResumeSectionKey) {
    setSections((prev) => ({
      ...prev,
      [section]: [
        ...prev[section],
        {
          key: nextKey(),
          title: "",
          start_date: "",
          end_date: "",
          timelineEntryId: null,
          sectionLabel: "",
          description: "",
        },
      ],
    }));
  }

  function removeItem(section: ResumeSectionKey, key: number) {
    setSections((prev) => ({
      ...prev,
      [section]: prev[section].filter((item) => item.key !== key),
    }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    setSyncedToTimeline(false);

    if (!name.trim() || !email.trim()) {
      setFormError("이름과 이메일을 입력해주세요.");
      return;
    }
    for (const { key, label } of SECTIONS) {
      for (const item of sections[key]) {
        if (!item.title.trim()) {
          setFormError(`${label}의 항목명을 입력해주세요.`);
          return;
        }
        if (!item.start_date) {
          setFormError(`${label} "${item.title.trim()}"의 시작 연월을 입력해주세요.`);
          return;
        }
        if (item.end_date && item.end_date < item.start_date) {
          setFormError(`${label} "${item.title.trim()}"의 종료 연월은 시작 연월보다 빠를 수 없어요.`);
          return;
        }
      }
    }

    const content = SECTIONS.reduce(
      (acc, { key }) => {
        acc[key] = sections[key].map((item) => ({
          title: item.title.trim(),
          start_date: monthInputToDate(item.start_date) as string,
          end_date: monthInputToDate(item.end_date),
          timeline_entry_id: item.timelineEntryId,
          section_label: item.sectionLabel.trim() || null,
          description: item.description.trim() || null,
        }));
        return acc;
      },
      {} as Record<ResumeSectionKey, ResumeItem[]>
    );

    setSaving(true);
    try {
      const saved = await saveResume({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        birth_date: birthDate || null,
        photo_url: photoUrl.trim() || null,
        content,
      });
      // The response carries the timeline_entry_id the server just assigned to
      // each item, so re-applying it keeps the form linked to those entries.
      applyResume(saved);
      setNotice("이력서를 저장했어요.");
      setSyncedToTimeline(true);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "저장 중 오류가 발생했어요.");
    } finally {
      setSaving(false);
    }
  }

  const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

  /**
   * Client upload: the file goes straight from the browser to Vercel Blob.
   * `/api/resume/photo-upload` only hands out the short-lived upload token.
   */
  async function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again after an error
    if (!file) return;

    setFormError(null);
    setNotice(null);
    if (!PHOTO_TYPES.includes(file.type)) {
      setFormError("사진은 JPG, PNG, WEBP 파일만 올릴 수 있어요.");
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setFormError("사진 용량은 5MB 이하여야 해요.");
      return;
    }

    setUploadingPhoto(true);
    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/resume/photo-upload",
      });
      setPhotoUrl(blob.url);
      setNotice("사진을 올렸어요. 저장을 눌러야 이력서에 반영돼요.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "사진 업로드에 실패했어요.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  const IMPORT_TYPES = ["pdf", "docx"];

  function handleImportChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setFormError(null);
    setNotice(null);
    const suffix = file.name.toLowerCase().split(".").pop() ?? "";
    if (!IMPORT_TYPES.includes(suffix)) {
      setFormError("PDF 또는 DOCX 파일만 올릴 수 있어요.");
      return;
    }
    // Importing replaces every row, so confirm first when there is work to lose.
    const hasItems = SECTIONS.some(({ key }) => sections[key].length > 0);
    if (hasItems) {
      setPendingImportFile(file);
      return;
    }
    runImport(file);
  }

  async function runImport(file: File) {
    setPendingImportFile(null);
    setFormError(null);
    setNotice(null);
    setSyncedToTimeline(false);
    setImporting(true);
    try {
      const imported = await importResume(file);
      // Pre-fill only: nothing is saved (and no timeline entry is created)
      // until the user reviews this and presses 저장.
      applyResume(imported, false);
      setNotice(
        imported.warning
          ? imported.warning
          : "이력서 파일에서 내용을 불러왔어요. 확인하고 수정한 뒤 저장을 눌러주세요."
      );
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "이력서 파일을 불러오지 못했어요.");
    } finally {
      setImporting(false);
    }
  }

  async function handleDownload() {
    setFormError(null);
    setNotice(null);
    setSyncedToTimeline(false);
    setDownloading(true);
    try {
      const blob = await downloadResumePdf();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "resume.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "PDF를 내려받지 못했어요.");
    } finally {
      setDownloading(false);
    }
  }

  /** Groups items by their effective heading, in first-appearance order - mirrors the PDF. */
  function sectionPreview(): { label: string; titles: string[] }[] {
    const groups: { label: string; titles: string[] }[] = [];
    for (const { key, label } of SECTIONS) {
      for (const item of sections[key]) {
        const heading = item.sectionLabel.trim() || label;
        const title = item.title.trim() || "(제목 없음)";
        const found = groups.find((g) => g.label === heading);
        if (found) found.titles.push(title);
        else groups.push({ label: heading, titles: [title] });
      }
    }
    return groups;
  }

  if (loading) return <Spinner label="이력서를 불러오는 중이에요..." />;
  if (loadError) return <ErrorBanner message={loadError} />;

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const preview = sectionPreview();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">이력서</h1>
        <div className="flex gap-2">
          <label
            className={`cursor-pointer rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 ${
              importing ? "cursor-not-allowed opacity-60" : ""
            }`}
          >
            {importing ? "불러오는 중..." : "기존 이력서 파일 첨부"}
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={importing}
              onChange={handleImportChange}
              className="hidden"
            />
          </label>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={reloading}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {reloading ? "불러오는 중..." : "타임라인에서 다시 불러오기"}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading ? "PDF 만드는 중..." : "PDF 다운로드"}
          </button>
        </div>
      </div>

      {isDraft && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          타임라인 데이터로 자동 채워진 초안이에요. 수정 후 저장해보세요.
        </div>
      )}

      <form
        onSubmit={handleSave}
        className="flex flex-col gap-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <ErrorBanner message={formError} />
        {notice && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            <p>{notice}</p>
            {syncedToTimeline && (
              <>
                <p className="mt-1">
                  타임라인에 반영되었어요. 이제 각 항목에서 세부항목을 추가하고 인터뷰를 진행해보세요.
                </p>
                <Link
                  href="/timelines"
                  className="mt-3 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  타임라인으로 이동
                </Link>
              </>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">이름</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">전화번호</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="010-0000-0000"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">생년월일</label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-500">PDF에 만 나이가 함께 표시돼요.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">프로필 사진</label>
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <label
                  className={`inline-block cursor-pointer rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 ${
                    uploadingPhoto ? "cursor-not-allowed opacity-60" : ""
                  }`}
                >
                  {uploadingPhoto ? "올리는 중..." : photoUrl ? "사진 변경" : "파일 선택"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploadingPhoto}
                    onChange={handlePhotoChange}
                    className="hidden"
                  />
                </label>
                {photoUrl && (
                  <button
                    type="button"
                    onClick={() => setPhotoUrl("")}
                    className="ml-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                  >
                    사진 삭제
                  </button>
                )}
                <p className="mt-1 text-xs text-gray-500">JPG · PNG · WEBP, 5MB 이하</p>
              </div>
              {photoUrl.trim() && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl.trim()}
                  alt="프로필 미리보기"
                  className="h-20 w-16 shrink-0 rounded border border-gray-200 object-cover"
                  onError={(e) => {
                    e.currentTarget.style.visibility = "hidden";
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {preview.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-semibold text-gray-800">PDF 섹션 구성 미리보기</p>
            <p className="mt-0.5 text-xs text-gray-500">
              같은 섹션 제목끼리 묶여서, 아래 순서대로 PDF에 표시돼요.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {preview.map((group) => (
                <li key={group.label} className="text-sm text-gray-700">
                  <span className="font-medium">{group.label}</span>{" "}
                  <span className="text-gray-500">— {group.titles.join(", ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {SECTIONS.map(({ key, label }) => (
          <section key={key} className="flex flex-col gap-3 border-t border-gray-100 pt-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">{label}</h2>
              <button
                type="button"
                onClick={() => addItem(key)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                항목 추가
              </button>
            </div>

            {sections[key].length === 0 ? (
              <p className="rounded-md border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500">
                아직 {label} 항목이 없어요.
              </p>
            ) : (
              sections[key].map((item) => (
                <div
                  key={item.key}
                  className="grid gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
                >
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">항목명</label>
                    <input
                      value={item.title}
                      onChange={(e) => updateItem(key, item.key, { title: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">시작 연월</label>
                    <input
                      type="month"
                      value={item.start_date}
                      onChange={(e) => updateItem(key, item.key, { start_date: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">종료 연월</label>
                    <input
                      type="month"
                      value={item.end_date}
                      onChange={(e) => updateItem(key, item.key, { end_date: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(key, item.key)}
                    className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    삭제
                  </button>
                  <div className="sm:col-span-4">
                    <label className="mb-1 block text-xs font-medium text-gray-500">
                      섹션 제목 (비우면 &quot;{label}&quot;)
                    </label>
                    <input
                      value={item.sectionLabel}
                      onChange={(e) => updateItem(key, item.key, { sectionLabel: e.target.value })}
                      placeholder={label}
                      className={inputClass}
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="mb-1 block text-xs font-medium text-gray-500">
                      세부 설명 (한 줄에 하나씩, PDF에서 &quot;- &quot; 항목으로 표시)
                    </label>
                    <textarea
                      value={item.description}
                      onChange={(e) => updateItem(key, item.key, { description: e.target.value })}
                      rows={3}
                      className={inputClass}
                    />
                  </div>
                </div>
              ))
            )}
          </section>
        ))}

        <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-5">
          <p className="text-xs text-gray-500">PDF는 저장된 이력서를 기준으로 만들어져요.</p>
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
        title="타임라인에서 다시 불러오기"
        message={"지금 편집 중인 학력/경력/대외활동/자격증 항목을 버리고 최신 타임라인 데이터로 다시 채울까요?\n저장하지 않은 수정 사항은 사라져요."}
        confirmLabel="다시 불러오기"
        onConfirm={handleReloadFromTimeline}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={pendingImportFile !== null}
        title="기존 이력서 파일에서 불러오기"
        message={"지금 작성 중인 항목을 파일에서 읽은 내용으로 교체할까요?\n저장하지 않은 수정 사항은 사라져요."}
        confirmLabel="불러오기"
        onConfirm={() => {
          if (pendingImportFile) runImport(pendingImportFile);
        }}
        onCancel={() => setPendingImportFile(null)}
      />
    </div>
  );
}
