"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, downloadResumePdf, getResume, getTimelines, saveResume } from "@/lib/api";
import type { ActivityCategory, Resume, ResumeItem, ResumeSectionKey } from "@/lib/types";
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

function toEditable(items: ResumeItem[]): EditableItem[] {
  return items.map((item) => ({
    key: nextKey(),
    title: item.title,
    start_date: item.start_date ?? "",
    end_date: item.end_date ?? "",
  }));
}

export default function ResumePage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sections, setSections] = useState<SectionState>(EMPTY_SECTIONS);
  const [isDraft, setIsDraft] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const applyResume = useCallback((data: Resume) => {
    setName(data.name);
    setEmail(data.email);
    setPhone(data.phone ?? "");
    setSections({
      education: toEditable(data.content.education),
      career: toEditable(data.content.career),
      activity: toEditable(data.content.activity),
      certificate: toEditable(data.content.certificate),
    });
    setIsDraft(data.draft);
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
          start_date: entry.start_date,
          end_date: entry.end_date ?? "",
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
      [section]: [...prev[section], { key: nextKey(), title: "", start_date: "", end_date: "" }],
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
          setFormError(`${label} "${item.title.trim()}"의 시작일을 입력해주세요.`);
          return;
        }
        if (item.end_date && item.end_date < item.start_date) {
          setFormError(`${label} "${item.title.trim()}"의 종료일은 시작일보다 빠를 수 없어요.`);
          return;
        }
      }
    }

    const content = SECTIONS.reduce(
      (acc, { key }) => {
        acc[key] = sections[key].map((item) => ({
          title: item.title.trim(),
          start_date: item.start_date,
          end_date: item.end_date || null,
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
        content,
      });
      applyResume(saved);
      setNotice("이력서를 저장했어요.");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "저장 중 오류가 발생했어요.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    setFormError(null);
    setNotice(null);
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

  if (loading) return <Spinner label="이력서를 불러오는 중이에요..." />;
  if (loadError) return <ErrorBanner message={loadError} />;

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">이력서</h1>
        <div className="flex gap-2">
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
            {notice}
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
        </div>

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
                    <label className="mb-1 block text-xs font-medium text-gray-500">시작일</label>
                    <input
                      type="date"
                      value={item.start_date}
                      onChange={(e) => updateItem(key, item.key, { start_date: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">종료일</label>
                    <input
                      type="date"
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
    </div>
  );
}
