import { useEffect } from "react";

/**
 * Injects a JSON-LD <script> into <head> and removes it on unmount.
 *
 * Head-only: nothing is rendered into the page, so this cannot affect layout.
 * The tag is keyed by `id` so re-runs replace rather than accumulate, and so
 * a page can emit several independent blocks (Article + BreadcrumbList, say).
 *
 * Prerendering captures document.documentElement after the app has settled,
 * so these tags end up in the static HTML too.
 */
export function useJsonLd(id: string, data: unknown | null) {
  useEffect(() => {
    if (!data) return;

    const elementId = `ld-${id}`;
    let el = document.getElementById(elementId) as HTMLScriptElement | null;
    if (!el) {
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = elementId;
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);

    return () => {
      document.getElementById(elementId)?.remove();
    };
  }, [id, JSON.stringify(data)]);
}
