import { useEffect } from "react";
import { useLocation } from "react-router";
import { useAuth } from "../context/AuthContext";

const CLARITY_PROJECT_ID = "xwphlkave7";
const CLARITY_SCRIPT_ID = "microsoft-clarity";
let clarityWasStopped = false;

type ClarityCommand = (...args: unknown[]) => void;

declare global {
  interface Window {
    clarity?: ClarityCommand & { q?: unknown[][] };
  }
}

function stopClarity() {
  // End the current Clarity session and prevent further tracking. Removing the
  // script alone is insufficient because its event handlers are already active.
  window.clarity?.("consent", false);
  document.getElementById(CLARITY_SCRIPT_ID)?.remove();
  clarityWasStopped = true;
}

function startClarity() {
  // Once a visitor has entered the authenticated experience, keep this browser
  // page untracked even if they sign out again. A reload starts a fresh visit.
  if (clarityWasStopped || document.getElementById(CLARITY_SCRIPT_ID)) return;

  const clarity: ClarityCommand & { q?: unknown[][] } =
    window.clarity ??
    Object.assign(
      (...args: unknown[]) => {
        clarity.q = clarity.q ?? [];
        clarity.q.push(args);
      },
      { q: [] as unknown[][] },
    );

  window.clarity = clarity;

  const script = document.createElement("script");
  script.id = CLARITY_SCRIPT_ID;
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`;
  document.head.appendChild(script);
}

export function MicrosoftClarity() {
  const { pathname } = useLocation();
  const { session, loading } = useAuth();
  const isPrivateRoute = pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  useEffect(() => {
    // Wait for Supabase before loading Clarity so returning signed-in users are
    // never briefly recorded while their persisted session is being restored.
    if (loading) return;

    if (session || isPrivateRoute) {
      stopClarity();
      return;
    }

    startClarity();
  }, [isPrivateRoute, loading, session]);

  return null;
}
