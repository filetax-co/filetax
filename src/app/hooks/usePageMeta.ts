import { useEffect } from "react";

const SITE_URL = "https://filetax.co";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

function setOrCreate(attr: string, name: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function removeMeta(attr: string, name: string) {
  document.querySelector(`meta[${attr}="${name}"]`)?.remove();
}

function setCanonical(url: string) {
  let el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link") as HTMLLinkElement;
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", url);
}

interface PageMeta {
  title: string;
  description: string;
  /**
   * Optional. When omitted, the canonical is left to <CanonicalTag> in
   * Layout.tsx, which derives it from the current pathname. Layout is a parent
   * of every page and parent effects flush after child effects, so Layout's
   * value wins either way — passing one here only matters when the canonical
   * must differ from the pathname.
   */
  canonical?: string;
  /** Absolute URL of the social share image. Falls back to the site default. */
  image?: string;
  /** "website" (default) or "article". */
  type?: "website" | "article";
  /** Set true on pages that should stay out of the index. */
  noindex?: boolean;
}

export function usePageMeta({
  title,
  description,
  canonical,
  image,
  type = "website",
  noindex = false,
}: PageMeta) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;

    const ogImage = image ?? DEFAULT_OG_IMAGE;
    const ogUrl = canonical ?? `${SITE_URL}${window.location.pathname}`;

    setOrCreate("name", "description", description);
    setOrCreate("property", "og:title", title);
    setOrCreate("property", "og:description", description);
    setOrCreate("property", "og:type", type);
    setOrCreate("property", "og:site_name", "FileTax.co");
    setOrCreate("property", "og:url", ogUrl);
    setOrCreate("property", "og:image", ogImage);
    setOrCreate("name", "twitter:card", "summary_large_image");
    setOrCreate("name", "twitter:title", title);
    setOrCreate("name", "twitter:description", description);
    setOrCreate("name", "twitter:image", ogImage);

    // robots.txt Disallow stops crawling but not indexing — a disallowed URL
    // with inbound links can still be indexed as a bare result. A noindex meta
    // is the only reliable signal, so it has to be emitted per page.
    if (noindex) {
      setOrCreate("name", "robots", "noindex, nofollow");
    } else {
      removeMeta("name", "robots");
    }

    if (canonical) {
      setCanonical(canonical);
    }

    return () => {
      document.title = prev;
    };
  }, [title, description, canonical, image, type, noindex]);
}
