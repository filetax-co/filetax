import { useParams, Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";

const articles: Record<string, {
  title: string;
  date: string;
  category: string;
  shortAnswer: string;
  body: string[];
  ctaLink: string;
  ctaLabel: string;
}> = {
  "what-is-form-5472": {
    title: "What Is Form 5472 and Who Needs to File It?",
    date: "April 3, 2026",
    category: "Form 5472 Basics",
    shortAnswer: "Form 5472 is an IRS information return required for any U.S. LLC owned 25% or more by a non-U.S. person. It must be filed annually alongside a Pro Forma 1120, even if the LLC had no revenue. The penalty for missing it is $25,000 per form, per year.",
    body: [
      "Form 5472 is a U.S. tax information return that the IRS requires from any foreign-owned single-member LLC that had reportable transactions with a foreign related party during the tax year. The form is part of the IRS framework for tracking cross-border financial activity involving U.S. entities.",
      "The filing requirement applies to any single-member LLC where the owner is a non-U.S. person owning 25% or more of the entity. This includes citizens of other countries residing abroad, even if they have U.S. bank accounts or conduct business in the United States.",
      "The requirement is annual. A foreign-owned LLC must file Form 5472 every year the LLC is open, regardless of whether it earned any revenue. The act of forming the LLC and making the initial capital contribution is itself considered a reportable transaction, so most LLCs have a filing obligation from year one.",
      "Form 5472 must always be attached to a Pro Forma 1120, a simplified corporate tax return that serves as the transmittal document for the filing. The two cannot be filed separately. Many foreign founders make the mistake of filing only one of the two forms, which does not satisfy the requirement.",
      "The IRS imposes an automatic $25,000 penalty for each failure to file. There is no minimum revenue threshold and no grace period for first-time filers. If you own a foreign-owned U.S. LLC and have not filed Form 5472, you should act as soon as possible to limit your penalty exposure.",
    ],
    ctaLink: "/check",
    ctaLabel: "Start My Filing",
  },
  "25000-penalty-form-5472": {
    title: "The $25,000 Penalty for Missing Form 5472: What Foreign LLC Owners Must Know",
    date: "April 6, 2026",
    category: "Penalty and Compliance",
    shortAnswer: "The IRS imposes an automatic $25,000 penalty for each failure to file Form 5472, per form, per tax year. The penalty applies even if the LLC had no revenue and can compound rapidly across multiple years or entities.",
    body: [
      "The $25,000 penalty for missing Form 5472 is one of the steepest automatic penalties in the U.S. tax code. Unlike many IRS penalties that scale with the amount owed, this one is fixed and applies regardless of the LLC's revenue, profit, or level of activity.",
      "The penalty applies per form, per year. If you own two LLCs and failed to file for three years, you could face $150,000 in penalties before any IRS review. The IRS does not need to prove intent. The penalty is automatic upon detection of a missing filing.",
      "The penalty is compounded by the fact that many foreign founders are simply unaware of the requirement. The Form 5472 obligation is not disclosed by most LLC formation services, and there is no IRS notice sent when the deadline passes. Many founders only discover the requirement when they apply for a U.S. bank account, seek a visa, or prepare to sell their business.",
      "The IRS may waive the penalty if you can demonstrate reasonable cause, typically that you were genuinely unaware of the requirement and acted promptly once you discovered it. This argument is strongest when submitted alongside the late filing, supported by a written statement prepared by a CPA.",
      "If you have missed Form 5472 for one or more years, the best course of action is to file the past-year returns as soon as possible and include a reasonable cause letter. Waiting longer weakens your argument and increases the likelihood that penalties will accumulate further. See our pricing page for past-year filing options.",
    ],
    ctaLink: "/past-filings",
    ctaLabel: "Fix a Missed Year",
  },
  "form-5472-pro-forma-1120-together": {
    title: "Form 5472 and Pro Forma 1120: Why They Are Always Filed Together",
    date: "April 10, 2026",
    category: "Form 5472 Basics",
    shortAnswer: "A foreign-owned single-member LLC must file Form 5472 attached to a Pro Forma 1120. The Pro Forma 1120 serves as the transmittal document. Without it, the Form 5472 filing is incomplete. They cannot be submitted separately.",
    body: [
      "A foreign-owned single-member LLC is a disregarded entity for U.S. tax purposes. This means it is not normally required to file a corporate tax return. However, the IRS still requires it to file Form 5472 to report transactions with foreign related parties.",
      "To give Form 5472 a submission vehicle, the IRS created the Pro Forma 1120 requirement. The LLC files a simplified Form 1120 (the standard U.S. corporate tax return) that is marked as 'pro forma', meaning it exists only to carry Form 5472 as an attachment, not to report taxable income.",
      "Filing only Form 5472 without the Pro Forma 1120 does not satisfy the requirement. The IRS will treat the submission as incomplete and assess the $25,000 penalty as if nothing had been filed. This is one of the most common filing mistakes made by foreign founders who discover the obligation late and attempt to correct it on their own.",
      "The Pro Forma 1120 requires the LLC's EIN, basic identifying information, and the owner's details. It does not require the LLC to calculate or pay corporate income tax. It is purely administrative. FileTax.co generates both forms together as a single package, structured exactly as the IRS requires.",
      "Both forms are mailed together to the IRS address specified in the instructions (or faxed if you add the fax submission service). There is no electronic filing option for this particular combination. The IRS does not accept it through online systems. You can learn more about the overall process and pricing on our services and pricing pages.",
    ],
    ctaLink: "/check",
    ctaLabel: "Start My Filing",
  },
  "delaware-wyoming-new-mexico-llc": {
    title: "Delaware vs Wyoming vs New Mexico: Which State Is Best for a Foreign-Owned LLC?",
    date: "April 13, 2026",
    category: "Entity Formation",
    shortAnswer: "Delaware is best for founders planning to raise venture capital. Wyoming offers strong privacy protections and low fees. New Mexico is the most affordable with no annual report requirement. It is a common choice for foreign founders seeking a low-maintenance structure.",
    body: [
      "When forming a U.S. LLC as a non-U.S. resident, the state of formation affects your annual maintenance costs, privacy protections, and legal framework. The three most popular states for foreign founders are Delaware, Wyoming, and New Mexico.",
      "Delaware is the default choice for startups planning to raise venture capital. Delaware's Court of Chancery has a well-established body of corporate law, and many U.S. investors prefer or require Delaware entities. The annual franchise tax ranges from $50 to several hundred dollars depending on the calculation method used, and annual reports are required.",
      "Wyoming offers strong privacy protections. Members and managers do not need to be listed in public records in many cases. Annual fees are low (typically $60 or less), and the state has no corporate income tax. Wyoming is popular for founders who want a U.S. LLC primarily for banking or payment processing purposes.",
      "New Mexico is the most affordable option. There is no annual report requirement, which means once the LLC is formed, there are no recurring state-level maintenance fees beyond the initial filing. New Mexico also does not require members to be listed publicly. This makes it a practical choice for foreign founders who want a U.S. entity for business purposes without ongoing administrative overhead.",
      "Regardless of which state you form in, the federal Form 5472 and Pro Forma 1120 filing obligation applies to all foreign-owned single-member LLCs. The state of formation does not affect this requirement. If you have questions about which state fits your situation, you can reach us at hello@filetax.co.",
    ],
    ctaLink: "/portal",
    ctaLabel: "Start Filing",
  },
  "reasonable-cause-letter-irs-penalty": {
    title: "What Is a Reasonable Cause Letter and Can It Waive My IRS Penalty?",
    date: "April 17, 2026",
    category: "Past Filing Help",
    shortAnswer: "A reasonable cause letter is a written argument submitted to the IRS requesting that the $25,000 Form 5472 penalty be waived. The IRS may grant relief if the failure was due to reasonable cause and not willful neglect. A CPA-prepared letter is significantly more effective than a self-written one.",
    body: [
      "When you file a late Form 5472 and Pro Forma 1120, you can request that the IRS waive the automatic $25,000 penalty by including a reasonable cause letter. This letter argues that your failure to file on time was due to circumstances beyond your control or a genuine lack of knowledge, and not willful neglect.",
      "The most common argument for foreign founders is that they were unaware of the Form 5472 requirement. The IRS accepts this argument when it is well-supported: you were not notified of the requirement by your formation agent, you had no U.S. tax advisor, and you acted promptly once you discovered the obligation. The letter must establish these facts clearly and in the correct legal framing.",
      "A CPA-prepared reasonable cause letter carries significantly more weight than a self-written one for several reasons. A CPA understands which IRS regulations and revenue rulings support the argument, how to frame the facts in terms the IRS reviewer expects to see, and how to structure the request to maximize the likelihood of approval.",
      "The IRS does not guarantee abatement. It evaluates each request based on the specific facts. However, genuine first-time filers with no history of non-compliance who file promptly after discovering the issue have a reasonable chance of receiving penalty relief, particularly when the letter is professionally prepared.",
      "FileTax.co offers a CPA-prepared reasonable cause letter as an add-on to any past-year Form 5472 filing. The total cost for a past-year filing plus letter is $350 per year, a fraction of the $25,000 penalty it addresses. You can start the process on our past filings page.",
    ],
    ctaLink: "/past-filings",
    ctaLabel: "Fix a Missed Year",
  },
  "file-form-5472-missed-prior-years": {
    title: "How to File Form 5472 If You Missed Prior Years",
    date: "April 20, 2026",
    category: "Past Filing Help",
    shortAnswer: "If you missed Form 5472 for prior years, file the past-year returns as soon as possible and include a reasonable cause letter requesting penalty abatement. The sooner you file, the stronger your abatement argument.",
    body: [
      "If you own a foreign-owned U.S. LLC and have not filed Form 5472 for one or more prior years, the first step is to file the missing returns as soon as possible. Each year you delay adds to your potential penalty exposure and weakens the reasonable cause argument you will need to request abatement.",
      "For each missed year, you need to file a separate Form 5472 and Pro Forma 1120 reflecting the reportable transactions for that specific tax year. The forms must be prepared according to the instructions in effect for that tax year, not the current year. FileTax.co handles this by generating the correct version of the form for the year you select.",
      "Along with each late filing, you should submit a reasonable cause letter requesting that the IRS waive the $25,000 penalty. The letter should explain why you did not file on time, when you discovered the requirement, and what steps you took to correct the situation. The argument is most credible when the filing and the letter arrive together.",
      "For founders who missed three or more years, a CPA review is recommended to build the strongest possible reasonable cause argument. The IRS evaluates each year's request separately, so the quality and consistency of your explanation across all years matters.",
      "FileTax.co offers past-year filing for $150 per year, with an optional CPA-prepared reasonable cause letter for an additional $200 per year, totaling $350 per year. This is available for one or two missed years directly through the platform. For three or more years, contact us via the portal for a multi-year package. See our pricing page for full details.",
    ],
    ctaLink: "/past-filings",
    ctaLabel: "Fix a Missed Year",
  },
  "form-8832-vs-form-2553": {
    title: "Form 8832 vs Form 2553: Which LLC Classification Change Is Right for You?",
    date: "April 24, 2026",
    category: "Entity Formation",
    shortAnswer: "Form 8832 changes your LLC's default tax classification, for example, electing C-Corporation treatment. Form 2553 elects S-Corporation status specifically. They serve different purposes and have different eligibility requirements.",
    body: [
      "By default, a single-member LLC is treated as a disregarded entity for U.S. federal tax purposes. This is usually the correct treatment for foreign-owned LLCs, but there are situations where changing the classification makes sense.",
      "Form 8832 is the Entity Classification Election. It allows an LLC to elect to be taxed as a C-Corporation instead of a disregarded entity or partnership. This is sometimes done when a foreign founder wants their U.S. LLC to be treated as a separate taxpaying corporation for business or treaty reasons. Filing Form 8832 changes the LLC's treatment going forward.",
      "Form 2553 is used specifically to elect S-Corporation status. S-Corporation election is only available to entities that meet certain requirements, including that all shareholders must be U.S. citizens or permanent residents. This means Form 2553 is generally not available to foreign-owned LLCs where the owner is a non-U.S. person.",
      "Both forms are standalone filings that must be mailed to the IRS. They cannot be faxed and do not go through the same submission process as Form 5472. Both forms also have filing deadlines that depend on when you want the election to take effect, so timing matters.",
      "FileTax.co offers LLC tax classification changes as a standalone service for $50. If you are unsure which form applies to your situation, we recommend reviewing the IRS instructions or consulting a CPA before filing. An incorrect election can be difficult to reverse. You can start a classification change filing directly through our portal.",
    ],
    ctaLink: "/portal",
    ctaLabel: "Start Filing",
  },
  "foreign-founders-us-tax-mistakes": {
    title: "What Foreign Founders Get Wrong About U.S. Tax Compliance in Their First Year",
    date: "April 27, 2026",
    category: "Penalty and Compliance",
    shortAnswer: "The most common mistake is assuming a U.S. LLC with no revenue has no filing obligations. Foreign-owned LLCs must file Form 5472 and Pro Forma 1120 every year, regardless of activity. Formation itself is a reportable transaction.",
    body: [
      "The single most common compliance mistake among foreign founders is the assumption that a U.S. LLC with no revenue or profit has no tax filing obligations. This assumption is incorrect, and acting on it can result in an automatic $25,000 IRS penalty per year.",
      "Foreign-owned single-member LLCs are required to file Form 5472 and a Pro Forma 1120 every year the LLC is open, regardless of activity. The initial capital contribution at formation is itself a reportable transaction, which means most LLCs have a filing obligation from their first year of existence, even before they generate any revenue.",
      "A second common mistake is discovering the Form 5472 requirement and attempting to file it without the Pro Forma 1120. The IRS requires both forms to be filed together. Filing only Form 5472 does not satisfy the requirement and does not protect you from the penalty.",
      "A third mistake is delaying the filing after discovering the obligation. Every additional year that passes without filing adds another $25,000 in potential penalties. More importantly, the reasonable cause argument, which is your best tool for getting penalties waived, becomes harder to make the longer you wait. The IRS is more sympathetic to founders who file promptly after discovering the requirement.",
      "FileTax.co was built specifically to address these problems. The eligibility check confirms whether your situation is straightforward enough to handle yourself, the platform generates both required forms together, and past-year filings are available for founders who need to catch up. You can start with the eligibility check in about 2 minutes, or review our services and pricing pages to understand what is involved.",
    ],
    ctaLink: "/check",
    ctaLabel: "Start My Filing",
  },
};

export function Article() {
  const { slug } = useParams<{ slug: string }>();
  const article = slug ? articles[slug] : null;

  usePageMeta({
    title: article ? `${article.title} | FileTax.co` : "Article Not Found | FileTax.co",
    description: article
      ? article.shortAnswer.slice(0, 160)
      : "This article could not be found.",
  });

  if (!article) {
    return (
      <section style={{ background: "var(--tf-bg)", padding: "4rem 1rem", textAlign: "center" }}>
        <h1 style={{ marginBottom: "1rem" }}>Article not found</h1>
        <Link to="/resources" style={{ color: "#0284C7", fontWeight: 600, textDecoration: "none" }}>
          Back to Resources
        </Link>
      </section>
    );
  }

  return (
    <>
      <section style={{ background: "var(--tf-bg)", padding: "2.5rem 1rem 0" }}>
        <div style={{ maxWidth: "740px", margin: "0 auto" }}>
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" style={{ marginBottom: "1.5rem" }}>
            <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "0.25rem", alignItems: "center" }}>
              <li><Link to="/" style={{ color: "var(--tf-muted)", fontSize: "0.875rem", textDecoration: "none" }}>Home</Link></li>
              <li style={{ color: "var(--tf-muted)", fontSize: "0.875rem" }}>/</li>
              <li><Link to="/resources" style={{ color: "var(--tf-muted)", fontSize: "0.875rem", textDecoration: "none" }}>Resources</Link></li>
              <li style={{ color: "var(--tf-muted)", fontSize: "0.875rem" }}>/</li>
              <li style={{ color: "var(--tf-text)", fontSize: "0.875rem", fontWeight: 500 }}>{article.title}</li>
            </ol>
          </nav>

          <div className="flex items-center gap-2 mb-3">
            <span style={{ background: "#0284C718", color: "#0284C7", borderRadius: "9999px", padding: "0.2rem 0.75rem", fontSize: "0.75rem", fontWeight: 600 }}>
              {article.category}
            </span>
            <span style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400 }}>{article.date}</span>
          </div>

          <h1 style={{ fontSize: "clamp(1.375rem, 3.5vw, 2rem)", lineHeight: 1.25, marginBottom: "1.5rem" }}>
            {article.title}
          </h1>
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "0 1rem 4rem" }}>
        <div style={{ maxWidth: "740px", margin: "0 auto" }}>
          {/* Short answer box */}
          <div className="short-answer-box">
            <p style={{ fontWeight: 600, fontSize: "0.8125rem", color: "#0284C7", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Short Answer</p>
            <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.6, fontWeight: 400 }}>{article.shortAnswer}</p>
          </div>

          {/* Body */}
          <div style={{ marginBottom: "2.5rem" }}>
            {article.body.map((para, i) => (
              <p key={i} style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.75, marginBottom: "1.125rem", fontWeight: 400 }}>
                {para}
              </p>
            ))}
          </div>

          {/* Internal links */}
          <div style={{ background: "var(--tf-surface)", border: "1px solid var(--tf-border)", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", marginBottom: "2rem" }}>
            <p style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.75rem" }}>Related pages</p>
            <div className="flex flex-wrap gap-3">
              <Link to="/pricing" style={{ color: "#0284C7", fontWeight: 600, fontSize: "0.875rem", textDecoration: "none" }}>Pricing &#8594;</Link>
              <Link to="/services" style={{ color: "#0284C7", fontWeight: 600, fontSize: "0.875rem", textDecoration: "none" }}>Services &#8594;</Link>
              <Link to="/past-filings" style={{ color: "#0284C7", fontWeight: 600, fontSize: "0.875rem", textDecoration: "none" }}>Past Filings &#8594;</Link>
            </div>
          </div>

          {/* CTA */}
          <div style={{ marginBottom: "1.5rem" }}>
            <Link
              to={article.ctaLink}
              style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}
            >
              {article.ctaLabel}
            </Link>
            <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginTop: "0.5rem" }}>
              Start without an account. Takes about 10 minutes.
            </p>
          </div>

          <Link to="/resources" style={{ color: "var(--tf-muted)", fontWeight: 500, fontSize: "0.875rem", textDecoration: "none" }}>
            &#8592; Back to Resources
          </Link>
        </div>
      </section>
    </>
  );
}