import { useEffect } from "react";

function setOrCreate(attr: string, name: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
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
  canonical: string;
}

export function usePageMeta({ title, description, canonical }: PageMeta) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;

    setOrCreate("name", "description", description);
    setOrCreate("property", "og:title", title);
    setOrCreate("property", "og:description", description);
    setOrCreate("property", "og:type", "website");
    setOrCreate("property", "og:site_name", "FileTax.co");
    setOrCreate("name", "twitter:card", "summary");
    setOrCreate("name", "twitter:title", title);
    setOrCreate("name", "twitter:description", description);
    setCanonical(canonical);

    return () => {
      document.title = prev;
    };
  }, [title, description, canonical]);
}
