"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import NavBar from "@/components/NavBar";
import Spinner from "@/components/Spinner";
import TutorialModal, { hasSeenTutorial, markTutorialSeen } from "@/components/TutorialModal";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    // localStorage is client-only, so this can't run during render. Keyed by user
    // id so a second account on the same browser still gets the walkthrough.
    if (!user) return;
    if (!hasSeenTutorial(user.id)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowTutorial(true);
    }
  }, [user]);

  function closeTutorial() {
    if (user) markTutorialSeen(user.id);
    setShowTutorial(false);
  }

  // Re-opened from the dashboard link; skips the "already seen" check.
  useEffect(() => {
    function handleOpen() {
      setShowTutorial(true);
    }
    window.addEventListener("cb:open-tutorial", handleOpen);
    return () => window.removeEventListener("cb:open-tutorial", handleOpen);
  }, []);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
      {showTutorial && <TutorialModal onClose={closeTutorial} />}
    </div>
  );
}
