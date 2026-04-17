import { useState } from "react";
import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";

type Category = "All" | "Form 5472 Basics" | "Penalty and Compliance" | "Entity Formation" | "Past Filing Help";

const categories: Category[] = ["All", "Form 5472 Basics", "Penalty and Compliance", "Entity Formation", "Past Filing Help"];

const posts = [
  {
    title: "What Is Form 5472 and Who Needs to File It?",
    date: "April 3, 2026",
    category: "Form 5472 Basics" as Category,
    excerpt: "Form 5472 is an IRS information return required for any foreign-owned U.S. LLC. Here is who must file, when, and what counts as a reportable transaction.",
    slug: "what-is-form-5472",
  },
  {
    title: "The $25,000 Penalty for Missing Form 5472: What Foreign LLC Owners Must Know",
    date: "April 6, 2026",
    category: "Penalty and Compliance" as Category,
    excerpt: "The IRS imposes an automatic $25,000 penalty per missed filing, per year. It applies even if your LLC had no revenue.",
    slug: "25000-penalty-form-5472",
  },
  {
    title: "Form 5472 and Pro Forma 1120: Why They Are Always Filed Together",
    date: "April 10, 2026",
    category: "Form 5472 Basics" as Category,
    excerpt: "The IRS requires Form 5472 to be attached to a Pro Forma 1120. They cannot be filed separately, and this is one of the most common filing mistakes.",
    slug: "form-5472-pro-forma-1120-together",
  },
  {
    title: "Delaware vs Wyoming vs New Mexico: Which State Is Best for a Foreign-Owned LLC?",
    date: "April 13, 2026",
    category: "Entity Formation" as Category,
    excerpt: "Each state has different fees, privacy rules, and annual requirements. Here is how they compare for non-U.S. founders.",
    slug: "delaware-wyoming-new-mexico-llc",
  },
  {
    title: "What Is a Reasonable Cause Letter and Can It Waive My IRS Penalty?",
    date: "April 17, 2026",
    category: "Past Filing Help" as Category,
    excerpt: "A reasonable cause letter requests that the IRS waive the $25,000 penalty for a late Form 5472 filing. Here is how it works and what makes one effective.",
    slug: "reasonable-cause-letter-irs-penalty",
  },
  {
    title: "How to File Form 5472 If You Missed Prior Years",
    date: "April 20, 2026",
    category: "Past Filing Help" as Category,
    excerpt: "If you missed one or more years of Form 5472, you can still file retroactively. The sooner you do, the stronger your penalty abatement argument.",
    slug: "file-form-5472-missed-prior-years",
  },
  {
    title: "Form 8832 vs Form 2553: Which LLC Classification Change Is Right for You?",
    date: "April 24, 2026",
    category: "Entity Formation" as Category,
    excerpt: "Form 8832 changes your LLC's default tax classification; Form 2553 elects S-Corporation status. They serve different purposes and have different eligibility rules.",
    slug: "form-8832-vs-form-2553",
  },
  {
    title: "What Foreign Founders Get Wrong About U.S. Tax Compliance in Their First Year",
    date: "April 27, 2026",
    category: "Penalty and Compliance" as Category,
    excerpt: "The most common mistake is assuming a no-revenue LLC has no filing obligations. Many founders discover this only after penalties have accumulated.",
    slug: "foreign-founders-us-tax-mistakes",
  },
];

const categoryColors: Record<Category, string> = {
  "All": "#64748B",
  "Form 5472 Basics": "#0284C7",
  "Penalty and Compliance": "#B31D1D",
  "Entity Formation": "#059669",
  "Past Filing Help": "#7C3AED",
};

export function Resources() {
  usePageMeta({
    title: "Resources | FileTax.co",
    description:
      "Guides and articles about Form 5472 filing requirements, IRS penalties, Reasonable Cause Letters, LLC formation, and U.S. tax compliance for foreign founders.",
  });

  const [activeCategory, setActiveCategory] = useState<Category>("All");

  const filtered = activeCategory === "All" ? posts : posts.filter((p) => p.category === activeCategory);

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
      <section style={{ background: "var(--tf-surface)", padding: "1rem 1rem 0", borderBottom: "1px solid var(--tf-border)" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <div className="flex flex-wrap gap-2 pb-0">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  padding: "0.375rem 1rem",
                  borderRadius: "9999px",
                  border: activeCategory === cat ? "1px solid #0284C7" : "1px solid var(--tf-border)",
                  background: activeCategory === cat ? "#0284C7" : "transparent",
                  color: activeCategory === cat ? "white" : "var(--tf-text)",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  cursor: "pointer",
                  minHeight: "36px",
                  marginBottom: "0.5rem",
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Post grid */}
      <section style={{ background: "var(--tf-bg)", padding: "2.5rem 1rem 4rem" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filtered.map((post) => (
              <article
                key={post.slug}
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
                  <span
                    style={{
                      background: categoryColors[post.category] + "18",
                      color: categoryColors[post.category],
                      borderRadius: "9999px",
                      padding: "0.2rem 0.75rem",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                    }}
                  >
                    {post.category}
                  </span>
                  <span style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400 }}>{post.date}</span>
                </div>
                <h2 style={{ fontSize: "1rem", lineHeight: 1.4, marginBottom: "0.625rem" }}>{post.title}</h2>
                <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.6, flex: 1, marginBottom: "1rem" }}>
                  {post.excerpt}
                </p>
                <Link
                  to={`/resources/${post.slug}`}
                  style={{ color: "#0284C7", fontWeight: 600, fontSize: "0.875rem", textDecoration: "none" }}
                >
                  Read More &#8594;
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}