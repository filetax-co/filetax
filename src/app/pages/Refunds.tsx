import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";
import { PRICE_FAX } from "../../lib/pricing";

// 👉 Review with an attorney before launch, alongside Terms.
const COMPANY_NAME = "FileTax.co";
const SUPPORT_EMAIL = "hello@filetax.co";
const LAST_UPDATED = "August 1, 2026";

const styles = {
  h2: {
    fontSize: "1.25rem",
    fontWeight: 600,
    marginTop: "2rem",
    marginBottom: "0.625rem",
    color: "var(--tf-text)",
  } as React.CSSProperties,
  p: {
    fontSize: "0.9375rem",
    lineHeight: 1.7,
    color: "var(--tf-text)",
    marginBottom: "0.875rem",
    fontWeight: 400,
  } as React.CSSProperties,
  ul: {
    fontSize: "0.9375rem",
    lineHeight: 1.7,
    color: "var(--tf-text)",
    marginBottom: "0.875rem",
    paddingLeft: "1.25rem",
  } as React.CSSProperties,
  li: {
    marginBottom: "0.375rem",
  } as React.CSSProperties,
};

export function Refunds() {
  usePageMeta({
    title: `Refund Policy | ${COMPANY_NAME}`,
    description: `When ${COMPANY_NAME} issues refunds, when it does not, and how to ask for one.`,
    canonical: "https://filetax.co/refunds",
  });

  return (
    <>
      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 2rem" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
          <Link
            to="/"
            style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 500, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.375rem", marginBottom: "1.5rem" }}
          >
            &#8592; Back to Home
          </Link>
          <h1 style={{ fontSize: "clamp(1.625rem, 4vw, 2.25rem)", marginBottom: "0.625rem" }}>
            Refund Policy
          </h1>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400 }}>
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "2.5rem 1rem 4rem" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
          <p style={styles.p}>
            This policy explains when we refund what you have paid. It forms part of our{" "}
            <Link to="/terms" style={{ color: "var(--tf-accent)" }}>Terms of Service</Link>. Where
            the two differ, this policy governs anything to do with refunds.
          </p>

          <h2 style={styles.h2}>1. Before your forms are generated</h2>
          <p style={styles.p}>
            You pay at the point you generate your completed forms, not before. Up to that moment
            nothing has been charged, so there is nothing to refund. You can leave a draft filing
            unfinished for as long as you like at no cost.
          </p>

          <h2 style={styles.h2}>2. After your forms are generated</h2>
          <p style={styles.p}>
            Once your Form 5472 and pro forma 1120 have been generated, the work has been
            performed and the fee is non-refundable. The forms are yours permanently and you can
            re-download them as many times as you want.
          </p>
          <p style={styles.p}>
            This is not a blanket refusal. If the forms we produced are wrong because of an error
            on our side, tell us and we will correct them at no charge. If we cannot correct them,
            we will refund the fee for the affected filing in full. Being unable to produce a
            usable filing is our failure, not yours.
          </p>

          <h2 style={styles.h2}>3. What is not a refundable error</h2>
          <p style={styles.p}>
            The forms are prepared from the information you enter. We do not refund because:
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>the information you entered was incorrect or incomplete</li>
            <li style={styles.li}>your circumstances changed after filing</li>
            <li style={styles.li}>the IRS does not grant penalty relief, which no preparer can guarantee</li>
            <li style={styles.li}>you decided you no longer needed to file</li>
          </ul>
          <p style={styles.p}>
            For a typo in your own details, you do not need a refund. Every paid filing includes
            two post-payment corrections, and re-downloads are always free.
          </p>

          <h2 style={styles.h2}>4. IRS fax transmission</h2>
          <p style={styles.p}>
            The ${PRICE_FAX} fax fee is covered by its own guarantee:
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>if a transmission fails, we retry automatically, at least twice</li>
            <li style={styles.li}>if every attempt fails, we refund the ${PRICE_FAX} in full, without you having to ask</li>
            <li style={styles.li}>the transmission receipt is stored against your filing and stays re-downloadable</li>
          </ul>
          <p style={styles.p}>
            A transmission receipt is proof that the IRS received the fax. It is not proof that
            the IRS has accepted or processed your filing, and no preparer can give you that. We
            do not refund the fee because of how the IRS later treats a filing that was
            successfully transmitted.
          </p>

          <h2 style={styles.h2}>5. Reasonable cause letters</h2>
          <p style={styles.p}>
            The reasonable cause letter is an argument for penalty relief, prepared by a licensed
            CPA. Whether the IRS grants relief is the IRS's decision and cannot be promised by
            anyone. The fee pays for preparing the letter, so it is not refundable based on the
            outcome. If the letter itself is defective, section 2 applies.
          </p>

          <h2 style={styles.h2}>6. Duplicate and accidental charges</h2>
          <p style={styles.p}>
            Duplicate charges, charges for a filing you did not generate, and charges taken in
            error are refunded in full whenever we find them or you report them. Contact us and we
            will trace it.
          </p>

          <h2 style={styles.h2}>7. How to request a refund</h2>
          <p style={styles.p}>
            Email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--tf-accent)" }}>{SUPPORT_EMAIL}</a>{" "}
            with the email address on your account and the tax year in question. You do not need a
            reference number. We aim to reply within two business days and to return an approved
            refund to the original payment method within ten business days, though your bank may
            take longer to show it.
          </p>

          <h2 style={styles.h2}>8. Your statutory rights</h2>
          <p style={styles.p}>
            Nothing in this policy removes any right you have under the consumer law of the country
            you live in. Where that law gives you more than this policy does, that law applies.
          </p>

          <h2 style={styles.h2}>9. Questions</h2>
          <p style={styles.p}>
            Anything unclear, ask before you pay:{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--tf-accent)" }}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
      </section>
    </>
  );
}
