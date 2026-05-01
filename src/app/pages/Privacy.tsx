import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";

// 👉 Update once incorporated and reviewed by an attorney.
const COMPANY_NAME = "FileTax.co";
const COMPANY_LEGAL_NAME = "FileTax.co"; // TODO: replace with registered legal entity once incorporated
const SUPPORT_EMAIL = "hello@filetax.co";
const PRIVACY_EMAIL = "hello@filetax.co"; // Same inbox for now; split later if you set up a dedicated address.
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

export function Privacy() {
  usePageMeta({
    title: `Privacy Policy | ${COMPANY_NAME}`,
    description: `How ${COMPANY_NAME} collects, uses, and protects your personal and tax information.`,
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
            Privacy Policy
          </h1>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400 }}>
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "2.5rem 1rem 4rem" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
          <p style={styles.p}>
            This Privacy Policy explains how {COMPANY_LEGAL_NAME} ("we," "us," "our") collects, uses, shares, and protects information when you visit {COMPANY_NAME} or use our services (collectively, the "Service"). By using the Service, you agree to the practices described in this Policy.
          </p>

          <h2 style={styles.h2}>1. Information We Collect</h2>
          <p style={styles.p}>
            We collect the following categories of information:
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>
              <strong>Information you provide directly.</strong> Your name, email address, postal address, phone number, business and entity details (such as LLC name and EIN), tax-related information (such as ownership details, related-party transactions, and financial data needed to prepare filings), identification documents, and any messages you send us.
            </li>
            <li style={styles.li}>
              <strong>Payment information.</strong> When you purchase services, our payment processor collects your payment details. We do not store full card numbers ourselves.
            </li>
            <li style={styles.li}>
              <strong>Automatically collected information.</strong> When you visit the Service, we may collect technical information such as your IP address, browser type and version, device type, operating system, referring URL, pages viewed, and timestamps.
            </li>
            <li style={styles.li}>
              <strong>Cookies and similar technologies.</strong> We use cookies and similar tools to operate the Service, remember your preferences, and analyze usage. See "Cookies" below.
            </li>
          </ul>

          <h2 style={styles.h2}>2. How We Use Your Information</h2>
          <p style={styles.p}>
            We use your information to:
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>provide, operate, and improve the Service;</li>
            <li style={styles.li}>generate tax forms based on the information you provide, and where you opt in to our IRS Fax Transmission add-on, transmit your signed forms to the IRS by fax;</li>
            <li style={styles.li}>process payments and send related notices;</li>
            <li style={styles.li}>communicate with you about your account, requests, and waitlist signups;</li>
            <li style={styles.li}>send service-related announcements and, where permitted, marketing communications (you can unsubscribe at any time);</li>
            <li style={styles.li}>detect, prevent, and address fraud, abuse, and security issues;</li>
            <li style={styles.li}>comply with legal obligations and enforce our Terms.</li>
          </ul>

          <h2 style={styles.h2}>3. Tax Return Information (IRC §7216)</h2>
          <p style={styles.p}>
            United States federal law (Internal Revenue Code §7216) restricts how tax return preparers may use or disclose tax return information. We will not use or disclose your tax return information for any purpose other than preparing your return, except as permitted by law or with your written consent. Where your consent is required for a specific use or disclosure, we will request it separately and explain the purpose at the time.
          </p>

          <h2 style={styles.h2}>4. How We Share Information</h2>
          <p style={styles.p}>
            We share information only as described below. We do not sell your personal information.
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>
              <strong>Service providers.</strong> Vendors who help us run the Service, including hosting, database, email delivery, form intake, customer support, analytics, and payment processing, may process your information on our behalf under written contracts that limit their use of the data.
            </li>
            <li style={styles.li}>
              <strong>Tax authorities.</strong> When you opt in to our IRS Fax Transmission add-on, we transmit your signed forms to the U.S. Internal Revenue Service (IRS) by fax on your behalf. You remain the filer of record. We do not file or sign forms on your behalf.
            </li>
            <li style={styles.li}>
              <strong>Legal compliance.</strong> We may disclose information when we believe in good faith that disclosure is required by law, legal process, or government request, or is necessary to protect rights, safety, or property.
            </li>
            <li style={styles.li}>
              <strong>Business transfers.</strong> If we are involved in a merger, acquisition, financing, or sale of assets, your information may be transferred as part of that transaction, subject to standard confidentiality protections.
            </li>
            <li style={styles.li}>
              <strong>With your consent.</strong> For any other sharing, we will ask for your consent first.
            </li>
          </ul>

          <h2 style={styles.h2}>5. International Data Transfers</h2>
          <p style={styles.p}>
            We operate internationally and our service providers may be located outside your country of residence. If you are located outside the United States, your information may be transferred to and processed in the United States or other countries that may have different data protection laws than your own. By using the Service, you acknowledge this transfer.
          </p>

          <h2 style={styles.h2}>6. Data Retention</h2>
          <p style={styles.p}>
            We retain your information for as long as necessary to provide the Service, comply with our legal and tax-related recordkeeping obligations (which may require retaining tax return information for several years after preparation), resolve disputes, and enforce our agreements. When information is no longer needed, we will delete or anonymize it. You may also request deletion of your data at any time by emailing us at <a href={`mailto:${PRIVACY_EMAIL}`} style={{ color: "#0284C7", textDecoration: "none" }}>{PRIVACY_EMAIL}</a>, subject to legal retention obligations.
          </p>

          <h2 style={styles.h2}>7. Security</h2>
          <p style={styles.p}>
            We use reasonable administrative, technical, and physical safeguards to protect your information, including encryption in transit, access controls, and vendor due diligence. However, no system is 100% secure. We cannot guarantee absolute security and you transmit information to us at your own risk. If we become aware of a security breach affecting your information, we will notify you as required by applicable law.
          </p>

          <h2 style={styles.h2}>8. Cookies and Analytics</h2>
          <p style={styles.p}>
            Cookies are small text files stored on your device. We use cookies to keep you signed in, remember your preferences, and understand how the Service is used. You can disable cookies through your browser settings, but parts of the Service may not function properly without them.
          </p>

          <h2 style={styles.h2}>9. Your Rights</h2>
          <p style={styles.p}>
            Depending on where you live, you may have rights under applicable privacy laws, including the right to:
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>access the personal information we hold about you;</li>
            <li style={styles.li}>request correction of inaccurate information;</li>
            <li style={styles.li}>request deletion of your information (subject to legal retention obligations);</li>
            <li style={styles.li}>object to or restrict certain processing;</li>
            <li style={styles.li}>request a portable copy of your information;</li>
            <li style={styles.li}>withdraw consent where processing is based on consent;</li>
            <li style={styles.li}>lodge a complaint with your local data protection authority.</li>
          </ul>
          <p style={styles.p}>
            To exercise any of these rights, contact us at <a href={`mailto:${PRIVACY_EMAIL}`} style={{ color: "#0284C7", textDecoration: "none" }}>{PRIVACY_EMAIL}</a>. We will respond within the timeframes required by applicable law. We may need to verify your identity before fulfilling certain requests.
          </p>

          <h2 style={styles.h2}>10. California Residents</h2>
          <p style={styles.p}>
            If you are a California resident, the California Consumer Privacy Act (CCPA) and California Privacy Rights Act (CPRA) give you specific rights regarding your personal information, including the rights described above. We do not sell or share personal information for cross-context behavioral advertising. To exercise your California rights, email <a href={`mailto:${PRIVACY_EMAIL}`} style={{ color: "#0284C7", textDecoration: "none" }}>{PRIVACY_EMAIL}</a>.
          </p>

          <h2 style={styles.h2}>11. EEA, UK, and Swiss Residents</h2>
          <p style={styles.p}>
            If you are located in the European Economic Area, the United Kingdom, or Switzerland, our legal bases for processing your information include performance of a contract, our legitimate interests in operating the Service, your consent (where applicable), and compliance with legal obligations. You have the rights described above and may also lodge a complaint with your local supervisory authority.
          </p>

          <h2 style={styles.h2}>12. Children's Privacy</h2>
          <p style={styles.p}>
            The Service is intended for adults and is not directed to children under 16. We do not knowingly collect personal information from children. If you believe a child has provided information to us, please contact us and we will take appropriate steps to delete it.
          </p>

          <h2 style={styles.h2}>13. Changes to This Policy</h2>
          <p style={styles.p}>
            We may update this Privacy Policy from time to time. If we make material changes, we will notify you by posting the updated Policy on the Service and updating the "Last updated" date. Your continued use of the Service after the changes take effect means you accept the updated Policy.
          </p>

          <h2 style={styles.h2}>14. Contact Us</h2>
          <p style={styles.p}>
            Questions or concerns about this Privacy Policy or how we handle your information? Email us at <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#0284C7", textDecoration: "none" }}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
      </section>
    </>
  );
}
