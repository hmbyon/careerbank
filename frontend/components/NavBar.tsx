"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminEmail } from "@/lib/constants";

const LINKS = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/timelines", label: "타임라인" },
  { href: "/experiences", label: "경험 저장소" },
  { href: "/essay-questions", label: "자소서 문항" },
  { href: "/resume", label: "이력서" },
];

export default function NavBar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  // Existing links are untouched; the admin entry only appears for the admin.
  const links = isAdminEmail(user?.email)
    ? [...LINKS, { href: "/admin/feedback", label: "관리자" }]
    : LINKS;

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/dashboard" className="text-base font-bold text-gray-900">
          경험은행
        </Link>
        <nav className="flex flex-1 flex-wrap gap-1">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          {user && <span className="hidden sm:inline">{user.name}님</span>}
          <button
            type="button"
            onClick={logout}
            className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
          >
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}
