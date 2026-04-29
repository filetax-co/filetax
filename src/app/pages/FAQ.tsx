import { useState } from "react";
import { usePageMeta } from "../hooks/usePageMeta";

const faqs = [
  {
    q: "What is Form 5472 and who needs to file it?",
    a: "Form 5472 is an IRS information return required for any U.S. corporation or foreign-owned disregarded entity that had reportable transactions with a foreign related party. Any single-member LLC owned 25% or more by a non-U.S. person must file Form 5472 annually, even if the LLC had no revenue. The act of forming the LLC and making a capital contribution is itself a reportable transaction.",
  },
  {
    q: "Does a dormant LLC with no revenue need to file Form 5472?",
    a: "Yes. The filing requirement is based on ownership and the existence of reportable transactions, not on revenue. The initial capital contribution used to form the LLC is considered a reportable transaction. A dormant LLC with a foreign owner and no other activity still needs to file Form 5472 and a Pro Forma 1120 for every year it is open.",
  },
  {
    q: "What counts as a reportable transaction for Form 5472?",
    a: "Reportable transactions include any monetary or non-monetary exchange between the foreign-owned LLC and a foreign related party. This includes capital contributions, distributions, loans, payments for services, rents, royalties, and the LLC formation itself. Even a $1 contribution at formation is reportable.",
  },
  {
    q: "What is the penalty for not filing Form 5472?",
    a: "The IRS imposes an automatic $25,000 penalty for each failure to file or maintain required records for Form 5472. This penalty applies per form, per tax year. A company with two reportable foreign relationships missing three years of filings could face $150,000 in penalties. The penalty is automatic. There is no minimum revenue threshold.",
  },
  {
    q: "What is a Pro Forma 1120 and why is it always filed with Form 5472?",
    a: "A Pro Forma 1120 is a corporate tax return that a foreign-owned single-member LLC uses solely as a transmittal document for Form 5472. The LLC is a disregarded entity not otherwise required to file a corporate return, so the Pro Forma 1120 exists only to give Form 5472 a vehicle for submission. The IRS requires them to be attached together. Form 5472 cannot be filed on its own.",
  },
  {
    q: "What is the filing deadline for Form 5472?",
    a: "The standard deadline for Form 5472 (with the Pro Forma 1120) is April 15 of the year following the tax year being reported. If April 15 falls on a weekend or holiday, the deadline shifts to the next business day. If the April 15 deadline has already passed, filing as soon as possible with a Reasonable Cause Letter gives you the best chance of penalty abatement. A 6-month extension is available with Form 7004 if filed before the original deadline.",
  },
  {
    q: "Can I get an extension for Form 5472?",
    a: "Yes. Filing Form 7004 grants an automatic 6-month extension, moving the deadline to October 15. The extension must be filed before the original April 15 deadline. Note that this is an extension to file, not an extension to pay. Form 5472 itself does not have a tax payment component.",
  },
  {
    q: "What happens if I missed filing Form 5472 in prior years?",
    a: "File the past-year Form 5472 and Pro Forma 1120 as soon as possible, along with a reasonable cause letter requesting penalty abatement. The IRS processes late filings and may waive penalties if the filing is accompanied by a credible explanation. Waiting longer weakens your reasonable cause argument and increases your exposure.",
  },
  {
    q: "What is a reasonable cause letter and does it actually work?",
    a: "A reasonable cause letter is a written argument submitted to the IRS alongside a late filing, requesting that the automatic $25,000 penalty be waived. The IRS may grant relief if the failure was due to reasonable cause and not willful neglect. The most common successful argument for foreign founders is a genuine lack of knowledge of the requirement. A CPA-prepared letter is significantly more effective than a self-written one because it addresses the correct legal standards and is structured as a professional submission.",
  },
  {
    q: "What is Form 8832 and when do I need it?",
    a: "Form 8832 is an entity classification election that changes how the IRS treats your LLC for tax purposes. By default, a single-member LLC is treated as a disregarded entity. If you want to be taxed as a C-Corporation, you file Form 8832 to elect that status. Form 2553 is used specifically to elect S-Corporation status. Both are separate from the Form 5472 filing requirement.",
  },
  {
    q: "Is my transaction data safe?",
    a: "FileTax.co does not store your bank credentials. You enter transactions manually. No bank connection is required. Data is encrypted and stored securely on Supabase. No form data is retained after your session ends.",
  },
  {
    q: "Do I need to create an account to use FileTax.co?",
    a: "You can start the eligibility check without an account. An account is required to save your progress and generate your final forms. Account creation is free. You only pay when you are ready to download your completed filing.",
  },
];

export function FAQ() {
  usePageMeta({
    title: "Frequently Asked Questions | FileTax.co",
    description:
      "Common questions about Form 5472, Pro Forma 1120, IRS penalties, Reasonable Cause Letters, and how FileTax.co works. Clear answers for foreign LLC owners.",
  });

  const [open, setOpen] = useState<number | null>(null);

  return (
    <>
      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 2rem" }}>
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(1.625rem, 4vw, 2.375rem)", marginBottom: "0.5rem" }}>
            Frequently Asked Questions
          </h1>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400 }}>
            Answers about Form 5472, IRS penalties, and how FileTax.co works.
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "1rem 1rem 4rem" }}>
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <div className="flex flex-col gap-3">
            {faqs.map((faq, i) => (
              <details
                key={i}
                open={open === i}
                onToggle={(e) => {
                  if ((e.target as HTMLDetailsElement).open) setOpen(i);
                  else if (open === i) setOpen(null);
                }}
                style={{
                  background: "var(--tf-surface)",
                  border: "1px solid var(--tf-border)",
                  borderRadius: "0.75rem",
                  overflow: "hidden",
                }}
              >
                <summary
                  style={{
                    padding: "1.125rem 1.5rem",
                    fontWeight: 600,
                    fontSize: "0.9375rem",
                    cursor: "pointer",
                    listStyle: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    color: "var(--tf-text)",
                    minHeight: "44px",
                  }}
                >
                  {faq.q}
                  <span style={{ color: "#0284C7", fontSize: "1.25rem", lineHeight: 1, flexShrink: 0, marginLeft: "1rem" }}>
                    {open === i ? "+" : "+"}
                  </span>
                </summary>
                <div
                  style={{
                    padding: "0 1.5rem 1.25rem",
                    borderLeft: "3px solid #0284C7",
                    marginLeft: "1.5rem",
                    marginRight: "1.5rem",
                    borderTop: "1px solid var(--tf-border)",
                    paddingTop: "1rem",
                    marginBottom: "0",
                  }}
                >
                  <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, fontWeight: 400 }}>
                    {faq.a}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
