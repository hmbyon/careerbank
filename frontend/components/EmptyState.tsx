import type { ReactNode } from "react";

export default function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
      <p className="whitespace-pre-line text-sm text-gray-500">{message}</p>
      {action}
    </div>
  );
}
