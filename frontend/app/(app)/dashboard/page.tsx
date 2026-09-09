"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError, getDashboardSummary } from "@/lib/api";
import type { DashboardSummary } from "@/lib/types";
import Spinner from "@/components/Spinner";
import ErrorBanner from "@/components/ErrorBanner";

const CARDS: {
  key: keyof DashboardSummary;
  title: string;
  unit: string;
  href: string;
  cta: string;
  accent: string;
}[] = [
  {
    key: "timeline_count",
    title: "타임라인",
    unit: "개",
    href: "/timelines",
    cta: "타임라인 보러가기",
    accent: "text-blue-600",
  },
  {
    key: "experience_count",
    title: "저장된 경험",
    unit: "개",
    href: "/experiences",
    cta: "경험 저장소 보러가기",
    accent: "text-emerald-600",
  },
  {
    key: "essay_question_count",
    title: "자소서 문항",
    unit: "개",
    href: "/essay-questions",
    cta: "자소서 문항 보러가기",
    accent: "text-purple-600",
  },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getDashboardSummary();
        if (!cancelled) setSummary(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "요약 정보를 불러오지 못했어요.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          안녕하세요{user ? `, ${user.name}님` : ""}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          경험은행에서 활동을 기록하고, AI와 함께 자기소개서를 완성해보세요.
        </p>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="요약 정보를 불러오는 중이에요..." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {CARDS.map((card) => (
            <Link
              key={card.key}
              href={card.href}
              className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div>
                <p className="text-sm font-medium text-gray-500">{card.title}</p>
                <p className={`mt-2 text-3xl font-bold ${card.accent}`}>
                  {summary ? summary[card.key] : 0}
                  <span className="ml-1 text-base font-medium text-gray-400">{card.unit}</span>
                </p>
              </div>
              <span className="mt-4 text-sm font-medium text-blue-600">{card.cta} →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
