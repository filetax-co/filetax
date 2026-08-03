import { useEffect } from "react";
import { useLocation } from "react-router";
import { useAuth } from "../context/AuthContext";

const MEASUREMENT_ID = "G-ZH4VJXS3GW";
const SCRIPT_ID = "google-analytics";
const DISABLE_KEY = `ga-disable-${MEASUREMENT_ID}`;
let analyticsWasStopped = false;

declare global {
  interface Window {
    dataLayer?: unknown[][];
    gtag?: (...args: unknown[]) => void;
  }
}

function stopGoogleAnalytics() {
  // Google's disable flag prevents this property from sending measurement data,
  // including through handlers that were registered before authentication.
  (window as unknown as Record<string, unknown>)[DISABLE_KEY] = true;
  document.getElementById(SCRIPT_ID)?.remove();
  analyticsWasStopped = true;
}

function startGoogleAnalytics() {
  if (analyticsWasStopped || document.getElementById(SCRIPT_ID)) return;

  (window as unknown as Record<string, unknown>)[DISABLE_KEY] = false;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = (...args: unknown[]) => {
    window.dataLayer?.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID);

  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

export function GoogleAnalytics() {
  const { pathname } = useLocation();
  const { session, loading } = useAuth();
  const isPrivateRoute = pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  useEffect(() => {
    // Do not initialize analytics until a persisted login has been ruled out.
    if (loading) return;

    if (session || isPrivateRoute) {
      stopGoogleAnalytics();
      return;
    }

    startGoogleAnalytics();
  }, [isPrivateRoute, loading, session]);

  return null;
}
