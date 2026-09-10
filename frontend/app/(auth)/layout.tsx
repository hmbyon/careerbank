"use client";

import { useEffect, useState, type ReactNode } from "react";
import TutorialModal, {
  GUEST_SCOPE,
  hasSeenTutorial,
  markTutorialSeen,
} from "@/components/TutorialModal";

/**
 * Wraps the login / signup screens so a first-time visitor sees what the service
 * does before being asked to sign up. Purely additive - the screens themselves
 * render exactly as before underneath.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    // localStorage is client-only, so this can't be decided during render.
    if (!hasSeenTutorial(GUEST_SCOPE)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowTutorial(true);
    }
  }, []);

  function closeTutorial() {
    markTutorialSeen(GUEST_SCOPE);
    setShowTutorial(false);
  }

  return (
    <>
      {children}
      {showTutorial && <TutorialModal onClose={closeTutorial} />}
    </>
  );
}
