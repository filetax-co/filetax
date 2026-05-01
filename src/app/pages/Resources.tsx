import { useEffect, useState } from "react";
import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";
import { sanity } from "../lib/sanity";

// Types matching the Sanity schema
interface Category {
  _id: string;
  title: string;
  slug: { current: string };
  description?: string;
  displayOrder?: number;
}

interface Post {
  _id: string;
  title: string;
  slug: { current: string };
  publishedAt: string;
  excerpt?: string;
  featured?: boolean;
  categories?: Category[];
  seoDescription?: string;
}

// Color map for categories. Keys are category titles as stored in Sanity.
// If a category title doesn't match a key here, it falls back to the default neutral color.
const CATEGORY_COLORS: Record<string, string> = {
  "Form 5472 Essentials": "#0284C7",
  "The $25,000 Penalty": "#B31D1D",
  "Catching Up on Missed Years": "#7C3AED",
  "Responding to an IRS Notice": "#DC2626",
  "LLC Formation for Foreign Founders": "#059669",
  "Filing on Time": "#0891B2",
};

const DEFAULT_CATEGORY_COLOR = "#64748B";

function getCategoryColor(title: string): string {
  return CATEGORY_COLORS[title] ?? DEFAULT_CATEGORY_COLOR;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function Resources() {
  usePageMeta({
    title: "Resources | FileTax.co",
    description:
      "Guides and articles about Form 5472 filing requirements, IRS penalties, Reasonable Cause Letters, LLC formation, and U.S. tax compliance for foreign founders.",
  });

  const [posts, setPosts] = useState<Post[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch posts and categories from Sanity on mount.
  // Posts are sorted by featured first, then by publishedAt descending.
  // Categories are sorted by displayOrder, with title as tiebreaker.
  useEffect(() => {
    const fetchContent = async () => {
      try {
        const postsQuery = `*[_type == "post" && defined(publishedAt)] | order(featured desc, publishedAt desc) {
          _id,
          title,
          slug,
          publishedAt,
          excerpt,
          featured,
          seoDescription,
          "categories": categories[]->{ _id, title, slug }
        }`;

        const categoriesQuery = `*[_type == "category"] | order(displayOrder asc, title asc) {
          _id,
          title,
          slug,
          description,
          displayOrder
        }`;

        const [postsResult, categoriesResult] = await Promise.all([
          sanity.fetch<Post[]>(postsQuery),
          sanity.fetch<Category[]>(categoriesQuery),
        ]);

        setPosts(postsResult ?? []);
        setCategories(categoriesResult ?? []);
        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch resources content from Sanity:", err);
        setError("Could not load articles. Please try again in a moment.");
        setLoading(false);
      }
    };

    fetchContent();
  }, []);

  // Filter posts by selected category
  const filteredPosts =
    activeCategory === "All"
      ? posts
      : posts.filter((post) =>
          (post.categories ?? []).some((cat) => cat.title === activeCategory)
        );

  return (
    <>
      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 2rem" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(1.625rem, 4vw, 2.375rem)", marginBottom: "0.5rem" }}>Resources</h1>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400 }}>
            Guides for foreign-owned U.S. LLCs, Form 5472 filing, and IRS compliance.
          </p>
        </div>
      </section>

      {/* Category filter */}
      {!loading && categories.length > 0 && (
        <section style={{ background: "var(--tf-surface)", padding: "1rem 1rem 0", borderBottom: "1px solid var(--tf-border)" }}>
          <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <div className="flex flex-wrap gap-2 pb-0">
              {(["All", ...categories.map((c) => c.title)]).map((catTitle) => (
                <button
                  key={catTitle}
                  onClick={() => setActiveCategory(catTitle)}
                  style={{
                    padding: "0.375rem 1rem",
                    borderRadius: "9999px",
                    border: activeCategory === catTitle ? "1px solid #0284C7" : "1px solid var(--tf-border)",
                    background: activeCategory === catTitle ? "#0284C7" : "transparent",
                    color: activeCategory === catTitle ? "white" : "var(--tf-text)",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    cursor: "pointer",
                    minHeight: "36px",
                    marginBottom: "0.5rem",
                  }}
                >
                  {catTitle}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Post grid */}
      <section style={{ background: "var(--tf-bg)", padding: "2.5rem 1rem 4rem" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          {loading && (
            <div style={{ textAlign: "center", padding: "3rem 0", color: "var(--tf-muted)", fontSize: "0.9375rem" }}>
              Loading articles...
            </div>
          )}

          {error && !loading && (
            <div style={{ textAlign: "center", padding: "3rem 0", color: "#B31D1D", fontSize: "0.9375rem" }}>
              {error}
            </div>
          )}

          {!loading && !error && filteredPosts.length === 0 && (
            <div style={{ textAlign: "center", padding: "3rem 0", color: "var(--tf-muted)", fontSize: "0.9375rem" }}>
              {activeCategory === "All"
                ? "No articles published yet. Check back soon."
                : `No articles in this category yet. Try another category or view all.`}
            </div>
          )}

          {!loading && !error && filteredPosts.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {filteredPosts.map((post) => {
                // Use the first category for the badge color and label
                const primaryCategory = post.categories?.[0];
                const categoryTitle = primaryCategory?.title ?? "";
                const categoryColor = getCategoryColor(categoryTitle);
                const displayDate = formatDate(post.publishedAt);
                const displayExcerpt = post.excerpt ?? post.seoDescription ?? "";

                return (
                  <article
                    key={post._id}
                    style={{
                      background: "var(--tf-surface)",
                      border: "1px solid var(--tf-border)",
                      borderRadius: "0.75rem",
                      padding: "1.5rem",
                      boxShadow: "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      {categoryTitle && (
                        <span
                          style={{
                            background: categoryColor + "18",
                            color: categoryColor,
                            borderRadius: "9999px",
                            padding: "0.2rem 0.75rem",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                          }}
                        >
                          {categoryTitle}
                        </span>
                      )}
                      {displayDate && (
                        <span style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400 }}>
                          {displayDate}
                        </span>
                      )}
                    </div>
                    <h2 style={{ fontSize: "1rem", lineHeight: 1.4, marginBottom: "0.625rem" }}>{post.title}</h2>
                    {displayExcerpt && (
                      <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.6, flex: 1, marginBottom: "1rem" }}>
                        {displayExcerpt}
                      </p>
                    )}
                    <Link
                      to={`/resources/${post.slug.current}`}
                      style={{ color: "#0284C7", fontWeight: 600, fontSize: "0.875rem", textDecoration: "none" }}
                    >
                      Read More &#8594;
                    </Link>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
