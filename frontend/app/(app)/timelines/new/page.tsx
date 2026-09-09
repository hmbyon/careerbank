"use client";

import TimelineForm from "@/components/TimelineForm";

export default function NewTimelinePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-gray-900">타임라인 등록</h1>
      <TimelineForm />
    </div>
  );
}
