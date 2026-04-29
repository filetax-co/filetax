import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";

// 👉 Update once incorporated and reviewed by an attorney.
const COMPANY_NAME = "FileTax.co";
const COMPANY_LEGAL_NAME = "FileTax.co"; // TODO: replace with registered legal entity once incorporated
const GOVERNING_JURISDICTION = "the State of Delaware, United States"; // TODO: confirm with attorney
const SUPPORT_EMAIL = "hello@filetax.co";
const LAST_UPDATED = "April 29, 2026";

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

export function Terms() {
  usePageMeta({
    title: `Terms of Service | ${COMPANY_NAME}`,
    description: `The terms and conditions that govern your use of ${COMPANY_NAME} services.`,
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
            Terms of Service
          </h1>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400 }}>
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "2.5rem 1rem 4rem" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
          <p style={styles.p}>
            These Terms of Service ("Terms") form a binding agreement between you ("you," "your") and {COMPANY_LEGAL_NAME} ("we," "us," "our") and govern your access to and use of the {COMPANY_NAME} website, products, and services (collectively, the "Service"). By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.
          </p>

          <h2 style={styles.h2}>1. Eligibility</h2>
          <p style={styles.p}>
            You must be at least 18 years old and have the legal authority to enter into this agreement on behalf of yourself or the entity you represent (such as a foreign-owned U.S. LLC). By using the Service, you represent and warrant that you meet these requirements.
          </p>

          <h2 style={styles.h2}>2. Description of the Service</h2>
          <p style={styles.p}>
            {COMPANY_NAME} provides software-assisted tax compliance services for foreign-owned U.S. limited liability companies and other small entities, including but not limited to preparation assistance for IRS Form 5472, Pro Forma Form 1120, and related filings. The specific scope of services for any engagement is described at the time of purchase.
          </p>
          <p style={styles.p}>
            <strong>The Service does not constitute legal advice.</strong> While we may assist in preparing tax-related documents, we are not a law firm and do not provide legal representation. For legal questions specific to your situation, please consult a qualified attorney.
          </p>

          <h2 style={styles.h2}>3. Your Account and Information</h2>
          <p style={styles.p}>
            To use certain features of the Service, you may need to create an account or provide information about yourself, your business, and your tax situation. You agree to:
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>provide accurate, current, and complete information;</li>
            <li style={styles.li}>promptly update your information if anything changes;</li>
            <li style={styles.li}>maintain the confidentiality of your account credentials;</li>
            <li style={styles.li}>be responsible for all activity that occurs under your account.</li>
          </ul>
          <p style={styles.p}>
            You are solely responsible for the accuracy and completeness of all information you provide. We rely on the information you submit to prepare filings and are not responsible for errors, omissions, penalties, or interest resulting from inaccurate or incomplete information you provide.
          </p>

          <h2 style={styles.h2}>4. Fees, Payment, and Refunds</h2>
          <p style={styles.p}>
            Fees for the Service are displayed at the point of purchase. Unless otherwise stated, fees are non-refundable once we have begun work on your filing. If you cancel before we have started work, we will issue a refund as described in our refund policy or at our reasonable discretion. All fees are exclusive of taxes you may owe in your own jurisdiction.
          </p>

          <h2 style={styles.h2}>5. User Responsibilities</h2>
          <p style={styles.p}>
            You are responsible for:
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>reviewing all prepared documents before they are filed and confirming they are accurate;</li>
            <li style={styles.li}>signing and authorizing any returns or filings as required by law;</li>
            <li style={styles.li}>retaining copies of all documents and records for your own records and as required by tax authorities;</li>
            <li style={styles.li}>complying with all applicable laws and regulations in your own jurisdiction.</li>
          </ul>

          <h2 style={styles.h2}>6. Prohibited Uses</h2>
          <p style={styles.p}>
            You agree not to use the Service to:
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>submit false, misleading, or fraudulent information;</li>
            <li style={styles.li}>infringe the rights of others or violate applicable law;</li>
            <li style={styles.li}>interfere with, attack, or disrupt the Service or its underlying infrastructure;</li>
            <li style={styles.li}>reverse engineer, scrape, or attempt to extract source code or proprietary content;</li>
            <li style={styles.li}>impersonate any person or entity or misrepresent your affiliation.</li>
          </ul>

          <h2 style={styles.h2}>7. Intellectual Property</h2>
          <p style={styles.p}>
            All content on the Service, including text, graphics, software, logos, and trademarks, is owned by {COMPANY_LEGAL_NAME} or its licensors and is protected by intellectual property laws. We grant you a limited, non-exclusive, non-transferable license to use the Service for its intended purpose. You may not copy, modify, distribute, sell, or create derivative works from the Service without our prior written consent.
          </p>
          <p style={styles.p}>
            You retain ownership of the information and documents you submit. By submitting content, you grant us a non-exclusive license to use, store, and process that content solely as necessary to provide the Service to you.
          </p>

          <h2 style={styles.h2}>8. Third-Party Services</h2>
          <p style={styles.p}>
            The Service may rely on third-party providers for hosting, payments, communications, and similar functions. Your use of those third-party services may be subject to their own terms. We are not responsible for the acts, omissions, or content of third parties.
          </p>

          <h2 style={styles.h2}>9. Disclaimers</h2>
          <p style={styles.p}>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, OR ACCURACY. We do not warrant that the Service will be uninterrupted, error-free, secure, or that any defects will be corrected. We do not guarantee any specific tax outcome, refund amount, or treatment by any tax authority.
          </p>

          <h2 style={styles.h2}>10. Limitation of Liability</h2>
          <p style={styles.p}>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, {COMPANY_LEGAL_NAME.toUpperCase()} AND ITS OFFICERS, EMPLOYEES, AGENTS, AND AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, LOST DATA, OR LOSS OF GOODWILL, ARISING OUT OF OR RELATING TO YOUR USE OF THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
          </p>
          <p style={styles.p}>
            OUR TOTAL CUMULATIVE LIABILITY FOR ANY CLAIM ARISING FROM OR RELATED TO THE SERVICE SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE TWELVE MONTHS PRECEDING THE CLAIM OR (B) ONE HUNDRED U.S. DOLLARS (USD $100).
          </p>

          <h2 style={styles.h2}>11. Indemnification</h2>
          <p style={styles.p}>
            You agree to indemnify, defend, and hold harmless {COMPANY_LEGAL_NAME} and its officers, employees, and affiliates from and against any claims, liabilities, damages, losses, and expenses (including reasonable attorneys' fees) arising out of or related to (i) your use of the Service, (ii) your violation of these Terms, (iii) your violation of any law or third-party right, or (iv) inaccurate or incomplete information you provide.
          </p>

          <h2 style={styles.h2}>12. Termination</h2>
          <p style={styles.p}>
            We may suspend or terminate your access to the Service at any time, with or without notice, if we believe you have violated these Terms or for any other reason at our reasonable discretion. You may stop using the Service at any time. Provisions that by their nature should survive termination (including disclaimers, limitations of liability, indemnification, and governing law) will survive.
          </p>

          <h2 style={styles.h2}>13. Changes to the Terms</h2>
          <p style={styles.p}>
            We may update these Terms from time to time. If we make material changes, we will notify you by posting the updated Terms on the Service and updating the "Last updated" date. Your continued use of the Service after the changes take effect constitutes your acceptance of the updated Terms.
          </p>

          <h2 style={styles.h2}>14. Governing Law and Disputes</h2>
          <p style={styles.p}>
            These Terms are governed by the laws of {GOVERNING_JURISDICTION}, without regard to conflict-of-law principles. You agree that any dispute arising from or related to these Terms or the Service shall be resolved exclusively in the state or federal courts located in that jurisdiction, and you consent to the personal jurisdiction of those courts.
          </p>

          <h2 style={styles.h2}>15. Miscellaneous</h2>
          <p style={styles.p}>
            These Terms, together with our Privacy Policy, constitute the entire agreement between you and us regarding the Service. If any provision is held unenforceable, the remaining provisions remain in full effect. Our failure to enforce any provision is not a waiver of our right to do so later. You may not assign these Terms without our prior written consent.
          </p>

          <h2 style={styles.h2}>16. Contact</h2>
          <p style={styles.p}>
            Questions about these Terms? Email us at <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#0284C7", textDecoration: "none" }}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
      </section>
    </>
  );
}
