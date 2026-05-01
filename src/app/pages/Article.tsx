import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { PortableText, type PortableTextComponents } from "@portabletext/react";
import { usePageMeta } from "@/app/hooks/usePageMeta";
import { sanity } from "@/lib/sanity";

// Types matching the Sanity schema
interface Category {
  _id: string;
  title: string;
  slug: { current: string };
}

interface ImageAsset {
  asset?: {
    _ref?: string;
    url?: string;
  };
  alt?: string;
  caption?: string;
}

interface RelatedPost {
  _id: string;
  title: string;
  slug: { current: string };
  excerpt?: string;
}

interface Post {
  _id: string;
  title: string;
  slug: { current: string };
  publishedAt: string;
  excerpt?: string;
  author?: string;
  body: any[]; // Portable Text array
  categories?: Category[];
  mainImage?: ImageAsset;
  relatedPosts?: RelatedPost[];
  seoTitle?: string;
  seoDescription?: string;
}

const TOC_THRESHOLD = 4; // Show table of contents only when article has 4+ H2 sections

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// Convert a heading string to a URL-safe anchor slug.
// Used both for the H2 id attribute and the matching TOC link.
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// Extract plain text from a Portable Text block (used for heading slugs and TOC display)
function extractBlockText(block: any): string {
  if (!block?.children) return "";
  return block.children
    .filter((child: any) => child._type === "span")
    .map((child: any) => child.text)
    .join("");
}

// Build the table-of-contents entries from the body Portable Text array.
// Returns an array of { text, anchor } for each H2 block in document order.
function buildTOC(body: any[]): { text: string; anchor: string }[] {
  if (!Array.isArray(body)) return [];
  return body
    .filter((block) => block._type === "block" && block.style === "h2")
    .map((block) => {
      const text = extractBlockText(block);
      return { text, anchor: slugifyHeading(text) };
    })
    .filter((entry) => entry.text.length > 0);
}

// Sanity image URL builder. For full feature support, consider @sanity/image-url package.
// This minimal version handles the common case of an asset reference with a CDN URL.
function getImageUrl(image: ImageAsset | undefined): string | null {
  if (!image?.asset) return null;
  if (image.asset.url) return image.asset.url;
  // If only _ref is provided, construct CDN URL from the reference
  if (image.asset._ref) {
    const ref = image.asset._ref;
    // Format: image-{hash}-{dimensions}-{format}
    const parts = ref.replace("image-", "").split("-");
    if (parts.length >= 3) {
      const format = parts[parts.length - 1];
      const dimensions = parts[parts.length - 2];
      const hash = parts.slice(0, -2).join("-");
      return `https://cdn.sanity.io/images/alh0fv7m/production/${hash}-${dimensions}.${format}`;
    }
  }
  return null;
}

// Custom Portable Text serializers.
// Each block type gets a renderer that matches the existing site's typography.
const portableTextComponents: PortableTextComponents = {
  block: {
    h2: ({ children, value }) => {
      const text = extractBlockText(value);
      const anchor = slugifyHeading(text);
      return (
        <h2
          id={anchor}
          style={{
            fontSize: "1.25rem",
            fontWeight: 600,
            lineHeight: 1.35,
            color: "var(--tf-text)",
            marginTop: "2rem",
            marginBottom: "0.875rem",
            scrollMarginTop: "1rem",
          }}
        >
          {children}
        </h2>
      );
    },
    h3: ({ children }) => (
      <h3
        style={{
          fontSize: "1.0625rem",
          fontWeight: 600,
          lineHeight: 1.4,
          color: "var(--tf-text)",
          marginTop: "1.5rem",
          marginBottom: "0.625rem",
        }}
      >
        {children}
      </h3>
    ),
    normal: ({ children }) => (
      <p
        style={{
          color: "var(--tf-text)",
          fontSize: "0.9375rem",
          lineHeight: 1.75,
          marginBottom: "1.125rem",
          fontWeight: 400,
        }}
      >
        {children}
      </p>
    ),
    blockquote: ({ children }) => (
      <blockquote
        style={{
          borderLeft: "3px solid #0284C7",
          paddingLeft: "1rem",
          marginLeft: 0,
          marginBottom: "1.125rem",
          fontStyle: "italic",
          color: "var(--tf-muted)",
        }}
      >
        {children}
      </blockquote>
    ),
  },
  list: {
    bullet: ({ children }) => (
      <ul
        style={{
          listStyleType: "disc",
          paddingLeft: "1.5rem",
          marginBottom: "1.125rem",
          color: "var(--tf-text)",
          fontSize: "0.9375rem",
          lineHeight: 1.75,
        }}
      >
        {children}
      </ul>
    ),
    number: ({ children }) => (
      <ol
        style={{
          listStyleType: "decimal",
          paddingLeft: "1.5rem",
          marginBottom: "1.125rem",
          color: "var(--tf-text)",
          fontSize: "0.9375rem",
          lineHeight: 1.75,
        }}
      >
        {children}
      </ol>
    ),
  },
  listItem: {
    bullet: ({ children }) => <li style={{ marginBottom: "0.375rem" }}>{children}</li>,
    number: ({ children }) => <li style={{ marginBottom: "0.375rem" }}>{children}</li>,
  },
  marks: {
    strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    link: ({ children, value }) => {
      const href = value?.href ?? "";
      const isExternal = /^https?:\/\//.test(href);
      const isInternal = href.startsWith("/");

      if (isInternal) {
        return (
          <Link to={href} style={{ color: "#0284C7", textDecoration: "underline", textUnderlineOffset: "2px" }}>
            {children}
          </Link>
        );
      }

      return (
        <a
          href={href}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
          style={{ color: "#0284C7", textDecoration: "underline", textUnderlineOffset: "2px" }}
        >
          {children}
        </a>
      );
    },
  },
  types: {
    image: ({ value }) => {
      const url = getImageUrl(value);
      if (!url) return null;
      return (
        <figure style={{ margin: "1.75rem 0" }}>
          <img
            src={url}
            alt={value?.alt ?? ""}
            style={{ width: "100%", height: "auto", borderRadius: "0.5rem", display: "block" }}
          />
          {value?.caption && (
            <figcaption
              style={{
                color: "var(--tf-muted)",
                fontSize: "0.8125rem",
                textAlign: "center",
                marginTop: "0.5rem",
                fontWeight: 400,
              }}
            >
              {value.caption}
            </figcaption>
          )}
        </figure>
      );
    },
  },
};

export function Article() {
  const { slug } = useParams<{ slug: string }>();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const fetchPost = async () => {
      try {
        const query = `*[_type == "post" && slug.current == $slug][0]{
          _id,
          title,
          slug,
          publishedAt,
          excerpt,
          author,
          body,
          mainImage{
            asset->{ _ref, url },
            alt,
            caption
          },
          "categories": categories[]->{ _id, title, slug },
          "relatedPosts": relatedPosts[]->{
            _id,
            title,
            slug,
            excerpt
          },
          seoTitle,
          seoDescription
        }`;

        const result = await sanity.fetch<Post | null>(query, { slug });

        if (!result) {
          setNotFound(true);
        } else {
          setPost(result);
        }
        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch article from Sanity:", err);
        setNotFound(true);
        setLoading(false);
      }
    };

    fetchPost();
  }, [slug]);

  // Build SEO metadata. Prefer seoTitle/seoDescription, fall back to title/excerpt.
  usePageMeta({
    title: post
      ? `${post.seoTitle ?? post.title} | FileTax.co`
      : loading
        ? "Loading... | FileTax.co"
        : "Article Not Found | FileTax.co",
    description: post
      ? (post.seoDescription ?? post.excerpt ?? "").slice(0, 160)
      : "This article could not be found.",
  });

  // Loading state
  if (loading) {
    return (
      <section style={{ background: "var(--tf-bg)", padding: "4rem 1rem", textAlign: "center" }}>
        <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem" }}>Loading article...</p>
      </section>
    );
  }

  // Not found state
  if (notFound || !post) {
    return (
      <section style={{ background: "var(--tf-bg)", padding: "4rem 1rem", textAlign: "center" }}>
        <h1 style={{ marginBottom: "1rem" }}>Article not found</h1>
        <Link to="/resources" style={{ color: "#0284C7", fontWeight: 600, textDecoration: "none" }}>
          Back to Resources
        </Link>
      </section>
    );
  }

  // Loaded post
  const primaryCategory = post.categories?.[0];
  const displayDate = formatDate(post.publishedAt);
  const tocEntries = buildTOC(post.body ?? []);
  const showTOC = tocEntries.length >= TOC_THRESHOLD;
  const heroImageUrl = getImageUrl(post.mainImage);

  return (
    <>
      <section style={{ background: "var(--tf-bg)", padding: "2.5rem 1rem 0" }}>
        <div style={{ maxWidth: "740px", margin: "0 auto" }}>
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" style={{ marginBottom: "1.5rem" }}>
            <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "0.25rem", alignItems: "center" }}>
              <li>
                <Link to="/" style={{ color: "var(--tf-muted)", fontSize: "0.875rem", textDecoration: "none" }}>
                  Home
                </Link>
              </li>
              <li style={{ color: "var(--tf-muted)", fontSize: "0.875rem" }}>/</li>
              <li>
                <Link to="/resources" style={{ color: "var(--tf-muted)", fontSize: "0.875rem", textDecoration: "none" }}>
                  Resources
                </Link>
              </li>
              <li style={{ color: "var(--tf-muted)", fontSize: "0.875rem" }}>/</li>
              <li style={{ color: "var(--tf-text)", fontSize: "0.875rem", fontWeight: 500 }}>{post.title}</li>
            </ol>
          </nav>

          {/* Category badge + date */}
          <div className="flex items-center gap-2 mb-3">
            {primaryCategory && (
              <span
                style={{
                  background: "#0284C718",
                  color: "#0284C7",
                  borderRadius: "9999px",
                  padding: "0.2rem 0.75rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                {primaryCategory.title}
              </span>
            )}
            {displayDate && (
              <span style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400 }}>
                {displayDate}
              </span>
            )}
          </div>

          {/* Title */}
          <h1 style={{ fontSize: "clamp(1.375rem, 3.5vw, 2rem)", lineHeight: 1.25, marginBottom: "1.5rem" }}>
            {post.title}
          </h1>

          {/* Hero image (optional) */}
          {heroImageUrl && (
            <figure style={{ margin: "0 0 2rem" }}>
              <img
                src={heroImageUrl}
                alt={post.mainImage?.alt ?? ""}
                style={{ width: "100%", height: "auto", borderRadius: "0.75rem", display: "block" }}
              />
              {post.mainImage?.caption && (
                <figcaption
                  style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", textAlign: "center", marginTop: "0.5rem", fontWeight: 400 }}
                >
                  {post.mainImage.caption}
                </figcaption>
              )}
            </figure>
          )}
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "0 1rem 4rem" }}>
        <div style={{ maxWidth: "740px", margin: "0 auto" }}>
          {/* Excerpt as the summary box (preserves the visual treatment from the original) */}
          {post.excerpt && (
            <div className="short-answer-box">
              <p style={{ fontWeight: 600, fontSize: "0.8125rem", color: "#0284C7", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Summary
              </p>
              <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.6, fontWeight: 400 }}>
                {post.excerpt}
              </p>
            </div>
          )}

          {/* Table of contents (auto-generated, only shown for articles with 4+ H2 sections) */}
          {showTOC && (
            <nav
              aria-label="Table of contents"
              style={{
                background: "var(--tf-surface)",
                border: "1px solid var(--tf-border)",
                borderRadius: "0.75rem",
                padding: "1.25rem 1.5rem",
                marginBottom: "2rem",
              }}
            >
              <p
                style={{
                  fontWeight: 700,
                  fontSize: "0.75rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--tf-muted)",
                  marginBottom: "0.75rem",
                }}
              >
                In this article
              </p>
              <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {tocEntries.map((entry, idx) => (
                  <li key={`${entry.anchor}-${idx}`}>
                    <a
                      href={`#${entry.anchor}`}
                      style={{
                        color: "#0284C7",
                        fontSize: "0.875rem",
                        fontWeight: 500,
                        textDecoration: "none",
                        lineHeight: 1.5,
                      }}
                    >
                      {entry.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          {/* Body (Portable Text) */}
          <div style={{ marginBottom: "2.5rem" }}>
            {post.body && post.body.length > 0 && (
              <PortableText value={post.body} components={portableTextComponents} />
            )}
          </div>

          {/* Static funnel links to conversion pages */}
          <div style={{ background: "var(--tf-surface)", border: "1px solid var(--tf-border)", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
            <p style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.75rem" }}>Related pages</p>
            <div className="flex flex-wrap gap-3">
              <Link to="/pricing" style={{ color: "#0284C7", fontWeight: 600, fontSize: "0.875rem", textDecoration: "none" }}>
                Pricing &#8594;
              </Link>
              <Link to="/services" style={{ color: "#0284C7", fontWeight: 600, fontSize: "0.875rem", textDecoration: "none" }}>
                Services &#8594;
              </Link>
              <Link to="/past-filings" style={{ color: "#0284C7", fontWeight: 600, fontSize: "0.875rem", textDecoration: "none" }}>
                Past Filings &#8594;
              </Link>
            </div>
          </div>

          {/* Related posts (from Sanity relatedPosts field, when populated) */}
          {post.relatedPosts && post.relatedPosts.length > 0 && (
            <div style={{ background: "var(--tf-surface)", border: "1px solid var(--tf-border)", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", marginBottom: "2rem" }}>
              <p style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.875rem" }}>Continue reading</p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                {post.relatedPosts.map((related) => (
                  <li key={related._id}>
                    <Link
                      to={`/resources/${related.slug.current}`}
                      style={{
                        textDecoration: "none",
                        color: "var(--tf-text)",
                        display: "block",
                      }}
                    >
                      <p style={{ color: "#0284C7", fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.25rem" }}>
                        {related.title} &#8594;
                      </p>
                      {related.excerpt && (
                        <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, lineHeight: 1.55 }}>
                          {related.excerpt}
                        </p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Link to="/resources" style={{ color: "var(--tf-muted)", fontWeight: 500, fontSize: "0.875rem", textDecoration: "none" }}>
            &#8592; Back to Resources
          </Link>
        </div>
      </section>
    </>
  );
}
