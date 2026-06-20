/**
 * PDF Generation Layer — Form 5472 + Pro Forma 1120
 *
 * Uses pdf-lib to fill the official IRS AcroForm PDFs. PDFs are served from
 * /pdf/ (public/pdf/) to avoid CORS.
 *
 * Templates are now PER TAX YEAR. The template path AND the AcroForm field
 * names are resolved per year:
 *
 *   Tax year  | Form 5472 PDF                  | Pro Forma 1120 PDF
 *   ----------|--------------------------------|-----------------------
 *   2024+     | public/pdf/Form-5472.pdf       | public/pdf/Form-1120-2024.pdf
 *   2023      | public/pdf/Form-5472-2023.pdf  | public/pdf/Form-1120-2023.pdf
 *   2022      | public/pdf/Form-5472-2022.pdf  | public/pdf/Form-1120-2022.pdf
 *   2019-2021 | public/pdf/Form-5472-2019-2021.pdf | public/pdf/Form-1120-YYYY.pdf
 *   fallback  | public/pdf/Form-5472.pdf       | public/pdf/Form-1120-Page-1.pdf
 *
 * Field-name maps live in src/lib/form5472Fields.ts (F5472, getF5472Map) and
 * src/lib/form1120Fields.ts (getF1120Map). To add a new year:
 *
 *   1. Drop the AcroForm PDF into public/pdf/.
 *   2. Run `node scripts/audit-pdf-fields.mjs` to see which expected fields
 *      are missing in the new PDF.
 *   3. Update resolveForm5472Path / resolveForm1120Path below, and add a
 *      per-year override in form5472Fields.ts / form1120Fields.ts as needed.
 *
 * Field names are simple flat AcroForm names (NOT XFA dot-paths). Verified
 * by live PDF dump — see scripts/audit-pdf-fields.mjs.
 *
 * ── Form 5472 field map ────────────────────────────────────────────────────────────────────────────
 * See form5472Fields.ts (F5472 constants) for the complete mapping.
 *
 * ── Form 1120 Page 1 field map ────────────────────────────────────────────────────────────────
 * TextField    CorporateName
 * TextField    AddressLine1
 * TextField    City
 * TextField    State
 * TextField    Country
 * TextField    Zipcode
 * TextField    EIN
 * CheckBox     Initial Return
 * CheckBox     FinalReturn
 * CheckBox     NameChange
 * CheckBox     AddressChange
 * TextField    Signature       — owner_full_name (auto-filled at generation time)
 * TextField    Date            — today's date in MM/DD/YYYY format (IRS Eastern Time)
 * TextField    Title           — filing.signer_title ?? "Owner" (default)
 * TextField    BeginningDate   — month+day only, e.g. "January 1" (year auto-filled by form)
 * TextField    EndingDate      — e.g. "December 31"
 * TextField    EndingYear      — last 2 digits only, e.g. "25" (form pre-prints "20")
 */