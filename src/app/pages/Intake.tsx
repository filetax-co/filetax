import React, { useEffect, useState, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { Filing } from '../../lib/supabase';

// ─── types ────────────────────────────────────────────────────────────────────

type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
};

type TransactionRow = {
  id?: string;
  transaction_type: string;
  direction: 'paid' | 'received';
  amount_usd: string;
  description: string;
  transaction_date: string;
  is_royalty: boolean;
  related_party_naics?: string;
};

// ─── constants ────────────────────────────────────────────────────────────────

// Tax years: 2019–2025 only (live)
const TAX_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019];

// US states + DC + territories
const US_STATES: { value: string; label: string }[] = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'DC', label: 'Washington D.C.' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
  { value: 'PR', label: 'Puerto Rico' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
];

// Countries (US first, then alphabetical)
const COUNTRIES: { value: string; label: string }[] = [
  { value: 'US', label: 'United States' },
  { value: 'AF', label: 'Afghanistan' },
  { value: 'AL', label: 'Albania' },
  { value: 'DZ', label: 'Algeria' },
  { value: 'AD', label: 'Andorra' },
  { value: 'AO', label: 'Angola' },
  { value: 'AG', label: 'Antigua and Barbuda' },
  { value: 'AR', label: 'Argentina' },
  { value: 'AM', label: 'Armenia' },
  { value: 'AU', label: 'Australia' },
  { value: 'AT', label: 'Austria' },
  { value: 'AZ', label: 'Azerbaijan' },
  { value: 'BS', label: 'Bahamas' },
  { value: 'BH', label: 'Bahrain' },
  { value: 'BD', label: 'Bangladesh' },
  { value: 'BB', label: 'Barbados' },
  { value: 'BY', label: 'Belarus' },
  { value: 'BE', label: 'Belgium' },
  { value: 'BZ', label: 'Belize' },
  { value: 'BJ', label: 'Benin' },
  { value: 'BT', label: 'Bhutan' },
  { value: 'BO', label: 'Bolivia' },
  { value: 'BA', label: 'Bosnia and Herzegovina' },
  { value: 'BW', label: 'Botswana' },
  { value: 'BR', label: 'Brazil' },
  { value: 'BN', label: 'Brunei' },
  { value: 'BG', label: 'Bulgaria' },
  { value: 'BF', label: 'Burkina Faso' },
  { value: 'BI', label: 'Burundi' },
  { value: 'CV', label: 'Cabo Verde' },
  { value: 'KH', label: 'Cambodia' },
  { value: 'CM', label: 'Cameroon' },
  { value: 'CA', label: 'Canada' },
  { value: 'CF', label: 'Central African Republic' },
  { value: 'TD', label: 'Chad' },
  { value: 'CL', label: 'Chile' },
  { value: 'CN', label: 'China' },
  { value: 'CO', label: 'Colombia' },
  { value: 'KM', label: 'Comoros' },
  { value: 'CG', label: 'Congo' },
  { value: 'CR', label: 'Costa Rica' },
  { value: 'HR', label: 'Croatia' },
  { value: 'CU', label: 'Cuba' },
  { value: 'CY', label: 'Cyprus' },
  { value: 'CZ', label: 'Czech Republic' },
  { value: 'DK', label: 'Denmark' },
  { value: 'DJ', label: 'Djibouti' },
  { value: 'DM', label: 'Dominica' },
  { value: 'DO', label: 'Dominican Republic' },
  { value: 'EC', label: 'Ecuador' },
  { value: 'EG', label: 'Egypt' },
  { value: 'SV', label: 'El Salvador' },
  { value: 'GQ', label: 'Equatorial Guinea' },
  { value: 'ER', label: 'Eritrea' },
  { value: 'EE', label: 'Estonia' },
  { value: 'SZ', label: 'Eswatini' },
  { value: 'ET', label: 'Ethiopia' },
  { value: 'FJ', label: 'Fiji' },
  { value: 'FI', label: 'Finland' },
  { value: 'FR', label: 'France' },
  { value: 'GA', label: 'Gabon' },
  { value: 'GM', label: 'Gambia' },
  { value: 'GE', label: 'Georgia' },
  { value: 'DE', label: 'Germany' },
  { value: 'GH', label: 'Ghana' },
  { value: 'GR', label: 'Greece' },
  { value: 'GD', label: 'Grenada' },
  { value: 'GT', label: 'Guatemala' },
  { value: 'GN', label: 'Guinea' },
  { value: 'GW', label: 'Guinea-Bissau' },
  { value: 'GY', label: 'Guyana' },
  { value: 'HT', label: 'Haiti' },
  { value: 'HN', label: 'Honduras' },
  { value: 'HU', label: 'Hungary' },
  { value: 'IS', label: 'Iceland' },
  { value: 'IN', label: 'India' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'IR', label: 'Iran' },
  { value: 'IQ', label: 'Iraq' },
  { value: 'IE', label: 'Ireland' },
  { value: 'IL', label: 'Israel' },
  { value: 'IT', label: 'Italy' },
  { value: 'JM', label: 'Jamaica' },
  { value: 'JP', label: 'Japan' },
  { value: 'JO', label: 'Jordan' },
  { value: 'KZ', label: 'Kazakhstan' },
  { value: 'KE', label: 'Kenya' },
  { value: 'KI', label: 'Kiribati' },
  { value: 'KW', label: 'Kuwait' },
  { value: 'KG', label: 'Kyrgyzstan' },
  { value: 'LA', label: 'Laos' },
  { value: 'LV', label: 'Latvia' },
  { value: 'LB', label: 'Lebanon' },
  { value: 'LS', label: 'Lesotho' },
  { value: 'LR', label: 'Liberia' },
  { value: 'LY', label: 'Libya' },
  { value: 'LI', label: 'Liechtenstein' },
  { value: 'LT', label: 'Lithuania' },
  { value: 'LU', label: 'Luxembourg' },
  { value: 'MG', label: 'Madagascar' },
  { value: 'MW', label: 'Malawi' },
  { value: 'MY', label: 'Malaysia' },
  { value: 'MV', label: 'Maldives' },
  { value: 'ML', label: 'Mali' },
  { value: 'MT', label: 'Malta' },
  { value: 'MH', label: 'Marshall Islands' },
  { value: 'MR', label: 'Mauritania' },
  { value: 'MU', label: 'Mauritius' },
  { value: 'MX', label: 'Mexico' },
  { value: 'FM', label: 'Micronesia' },
  { value: 'MD', label: 'Moldova' },
  { value: 'MC', label: 'Monaco' },
  { value: 'MN', label: 'Mongolia' },
  { value: 'ME', label: 'Montenegro' },
  { value: 'MA', label: 'Morocco' },
  { value: 'MZ', label: 'Mozambique' },
  { value: 'MM', label: 'Myanmar' },
  { value: 'NA', label: 'Namibia' },
  { value: 'NR', label: 'Nauru' },
  { value: 'NP', label: 'Nepal' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'NZ', label: 'New Zealand' },
  { value: 'NI', label: 'Nicaragua' },
  { value: 'NE', label: 'Niger' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'NO', label: 'Norway' },
  { value: 'OM', label: 'Oman' },
  { value: 'PK', label: 'Pakistan' },
  { value: 'PW', label: 'Palau' },
  { value: 'PA', label: 'Panama' },
  { value: 'PG', label: 'Papua New Guinea' },
  { value: 'PY', label: 'Paraguay' },
  { value: 'PE', label: 'Peru' },
  { value: 'PH', label: 'Philippines' },
  { value: 'PL', label: 'Poland' },
  { value: 'PT', label: 'Portugal' },
  { value: 'QA', label: 'Qatar' },
  { value: 'RO', label: 'Romania' },
  { value: 'RU', label: 'Russia' },
  { value: 'RW', label: 'Rwanda' },
  { value: 'KN', label: 'Saint Kitts and Nevis' },
  { value: 'LC', label: 'Saint Lucia' },
  { value: 'VC', label: 'Saint Vincent and the Grenadines' },
  { value: 'WS', label: 'Samoa' },
  { value: 'SM', label: 'San Marino' },
  { value: 'ST', label: 'Sao Tome and Principe' },
  { value: 'SA', label: 'Saudi Arabia' },
  { value: 'SN', label: 'Senegal' },
  { value: 'RS', label: 'Serbia' },
  { value: 'SC', label: 'Seychelles' },
  { value: 'SL', label: 'Sierra Leone' },
  { value: 'SG', label: 'Singapore' },
  { value: 'SK', label: 'Slovakia' },
  { value: 'SI', label: 'Slovenia' },
  { value: 'SB', label: 'Solomon Islands' },
  { value: 'SO', label: 'Somalia' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'SS', label: 'South Sudan' },
  { value: 'ES', label: 'Spain' },
  { value: 'LK', label: 'Sri Lanka' },
  { value: 'SD', label: 'Sudan' },
  { value: 'SR', label: 'Suriname' },
  { value: 'SE', label: 'Sweden' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'SY', label: 'Syria' },
  { value: 'TW', label: 'Taiwan' },
  { value: 'TJ', label: 'Tajikistan' },
  { value: 'TZ', label: 'Tanzania' },
  { value: 'TH', label: 'Thailand' },
  { value: 'TL', label: 'Timor-Leste' },
  { value: 'TG', label: 'Togo' },
  { value: 'TO', label: 'Tonga' },
  { value: 'TT', label: 'Trinidad and Tobago' },
  { value: 'TN', label: 'Tunisia' },
  { value: 'TR', label: 'Turkey' },
  { value: 'TM', label: 'Turkmenistan' },
  { value: 'TV', label: 'Tuvalu' },
  { value: 'UG', label: 'Uganda' },
  { value: 'UA', label: 'Ukraine' },
  { value: 'AE', label: 'United Arab Emirates' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'UY', label: 'Uruguay' },
  { value: 'UZ', label: 'Uzbekistan' },
  { value: 'VU', label: 'Vanuatu' },
  { value: 'VE', label: 'Venezuela' },
  { value: 'VN', label: 'Vietnam' },
  { value: 'YE', label: 'Yemen' },
  { value: 'ZM', label: 'Zambia' },
  { value: 'ZW', label: 'Zimbabwe' },
];

// Principal business activity (entity / LLC) — as specified
const BIZ_ACTIVITIES: { code: string; label: string }[] = [
  { code: '541511', label: 'Software Development' },
  { code: '513210', label: 'SaaS / Software Publisher' },
  { code: '541511', label: 'AI / Machine Learning Services' },
  { code: '541512', label: 'IT Consulting' },
  { code: '518210', label: 'Cloud / Hosting / DevOps' },
  { code: '541519', label: 'Cybersecurity' },
  { code: '541519', label: 'Data Analytics' },
  { code: '541611', label: 'Business Consulting' },
  { code: '541611', label: 'Management Consulting' },
  { code: '541613', label: 'Marketing Consulting' },
  { code: '541810', label: 'Digital Marketing Agency' },
  { code: '541430', label: 'Graphic Design' },
  { code: '541430', label: 'Web Design' },
  { code: '455219', label: 'Online Store (Shopify, WooCommerce, etc.)' },
  { code: '455219', label: 'Amazon FBA / Marketplace Seller' },
  { code: '425120', label: 'Import / Export' },
  { code: '423990', label: 'Wholesale Trade' },
  { code: '611420', label: 'Online Education / Courses' },
  { code: '561499', label: 'Business Support Services' },
  { code: '551112', label: 'Holding Company' },
  { code: '523999', label: 'Finance / Investment' },
  { code: '531390', label: 'Real Estate' },
  { code: '541990', label: 'Other Professional Services' },
];

// Related-party NAICS codes — as specified
const RP_NAICS: { code: string; label: string; hint: string }[] = [
  { code: '541511', label: 'Software Developer / Programmer',   hint: 'Freelance developers, agencies, AI engineers' },
  { code: '513210', label: 'SaaS Founder / Software Company',   hint: 'SaaS startups, mobile apps' },
  { code: '541512', label: 'IT Consultant',                      hint: 'Technology consultants' },
  { code: '518210', label: 'Cloud / DevOps / Infrastructure',    hint: 'Cloud engineers' },
  { code: '541519', label: 'Cybersecurity / Data / AI Services', hint: 'AI consultants, cybersecurity' },
  { code: '541611', label: 'Business Consultant',                hint: 'General consulting' },
  { code: '541613', label: 'Marketing Consultant',               hint: 'Marketing professionals' },
  { code: '541810', label: 'Digital Marketing Agency',           hint: 'Advertising agencies' },
  { code: '541430', label: 'Graphic / UI-UX Designer',           hint: 'Designers' },
  { code: '455219', label: 'E-commerce Seller',                  hint: 'Shopify, Amazon, Etsy' },
  { code: '425120', label: 'Import / Export Trader',             hint: 'Trading businesses' },
  { code: '423990', label: 'Wholesale Business',                 hint: 'Product wholesalers' },
  { code: '611420', label: 'Online Education / Coach',           hint: 'Coaches, course creators' },
  { code: '561499', label: 'Business Support Services',          hint: 'VA agencies, outsourcing' },
  { code: '551112', label: 'Holding Company / Investor',         hint: 'Investment holding companies' },
  { code: '523999', label: 'Finance / Investment',               hint: 'Financial services' },
  { code: '531390', label: 'Real Estate',                        hint: 'Property-related businesses' },
  { code: '541990', label: 'Other Professional Services',        hint: 'Catch-all for professionals' },
];

const TX_TYPES: { value: string; label: string }[] = [
  { value: 'sales',                label: 'Sales' },
  { value: 'service_payment',      label: 'Service payment' },
  { value: 'rent_royalty',         label: 'Rent / Royalty' },
  { value: 'loan_to_llc',          label: 'Loan to LLC (closing balance)' },
  { value: 'loan_from_llc',        label: 'Loan from LLC (closing balance)' },
  { value: 'interest',             label: 'Interest' },
  { value: 'insurance',            label: 'Insurance' },
  { value: 'dividend',             label: 'Dividend' },
  { value: 'commission',           label: 'Commission' },
  { value: 'intangible',           label: 'Intangible property' },
  { value: 'capital_contribution', label: 'Capital contribution' },
  { value: 'distribution',         label: 'Distribution' },
  { value: 'formation_costs',      label: 'Formation costs (paid by owner)' },
  { value: 'property_transfer',    label: 'Property transfer (Part VI)' },
  { value: 'nonmonetary_other',    label: 'Other nonmonetary (Part VI)' },
  { value: 'other',                label: 'Other' },
];

const LOAN_TYPES    = new Set(['loan_to_llc', 'loan_from_llc', 'capital_contribution', 'distribution']);
const ROYALTY_TYPES = new Set(['rent_royalty']);
const PART_VI_TYPES = new Set(['property_transfer', 'nonmonetary_other']);

type IntakeStep = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<IntakeStep, string> = {
  1: 'LLC Details',
  2: 'Owner Details',
  3: 'Transactions',
  4: 'Review',
};

// ─── EIN helpers ──────────────────────────────────────────────────────────────

/** Format raw digits into XX-XXXXXXX, max 9 digits */
function formatEIN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** Validate XX-XXXXXXX (2 digits, dash, 7 digits) */
function isValidEIN(val: string): boolean {
  return /^\d{2}-\d{7}$/.test(val);
}

// ─── owner-reference helper ───────────────────────────────────────────────────

/**
 * Owner reference = first 3 letters of owner name (uppercase) + 001
 * Each subsequent related-party ref increments: 002, 003 …
 */
function buildOwnerRef(name: string): string {
  const prefix = name.trim().replace(/\s+/g, '').slice(0, 3).toUpperCase();
  return prefix ? `${prefix}001` : '';
}

function buildRelatedPartyRef(name: string, index: number): string {
  const prefix = name.trim().replace(/\s+/g, '').slice(0, 3).toUpperCase();
  const suffix = String(index + 2).padStart(3, '0'); // 002, 003 …
  return prefix ? `${prefix}${suffix}` : '';
}

// ─── component ────────────────────────────────────────────────────────────────

export function Intake() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const filingId = params.get('filing_id');

  const [step, setStep]     = useState<IntakeStep>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [einErr, setEinErr] = useState<string | null>(null);

  // ── step 1 — LLC ──────────────────────────────────────────────────────────
  const [llcName,            setLlcName]            = useState('');
  const [ein,                setEin]                = useState('');
  const [stateOfFormation,   setStateOfFormation]   = useState('');
  const [taxYear,            setTaxYear]            = useState('2024');
  const [mailing,            setMailing]            = useState<Address>({});
  // Entity business activity + code (point 8)
  const [entityBizActivity,  setEntityBizActivity]  = useState('');
  const [entityBizCode,      setEntityBizCode]      = useState('');

  // ── step 2 — Owner ────────────────────────────────────────────────────────
  const [ownerName,          setOwnerName]          = useState('');
  const [ownerCountryRes,    setOwnerCountryRes]    = useState('');
  const [ownerCountryCit,    setOwnerCountryCit]    = useState('');
  // passport removed (point 6)
  const [ownerForeignTaxId,  setOwnerForeignTaxId]  = useState('');
  const [ownerRefNumber,     setOwnerRefNumber]     = useState(''); // point 7 & 10
  const [ownerDOI,           setOwnerDOI]           = useState(''); // date of incorporation (point 3)
  const [ownerAddress,       setOwnerAddress]       = useState<Address>({});
  const [signerTitle,        setSignerTitle]        = useState('Owner');
  // Principal business activity + code for owner (point 5a)
  const [ownerBizActivity,   setOwnerBizActivity]   = useState('');
  const [ownerBizCode,       setOwnerBizCode]       = useState('');
  // Owner country (point 9)
  const [ownerCountry,       setOwnerCountry]       = useState('');

  // ── step 3 — Transactions ─────────────────────────────────────────────────
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [txType,       setTxType]       = useState('sales');
  const [txDir,        setTxDir]        = useState<'paid' | 'received'>('received');
  const [txAmt,        setTxAmt]        = useState('');
  const [txDesc,       setTxDesc]       = useState('');
  const [txDate,       setTxDate]       = useState('');
  const [txIsRoyalty,  setTxIsRoyalty]  = useState(false);
  const [txRpNaics,    setTxRpNaics]    = useState(''); // related-party NAICS (point 11)

  // auto-derive owner ref whenever name changes
  useEffect(() => {
    const derived = buildOwnerRef(ownerName);
    setOwnerRefNumber(derived);
  }, [ownerName]);

  // ── load existing filing ──────────────────────────────────────────────────
  useEffect(() => {
    if (!filingId) return;
    (async () => {
      const { data: f, error: err } = await supabase
        .from('filings').select('*').eq('id', filingId).single();
      if (err || !f) return;

      setLlcName(f.llc_name ?? '');
      setEin(f.ein ?? '');
      setStateOfFormation(f.state_of_formation ?? '');
      setTaxYear(String(f.tax_year ?? 2024));
      setMailing(f.mailing_address ?? {});
      setEntityBizActivity((f as Record<string, unknown>).entity_business_activity as string ?? '');
      setEntityBizCode((f as Record<string, unknown>).entity_business_code as string ?? '');

      setOwnerName(f.owner_full_name ?? '');
      setOwnerCountryRes(f.owner_country_residence ?? '');
      setOwnerCountryCit(f.owner_country_citizenship ?? '');
      setOwnerForeignTaxId(f.owner_foreign_tax_id ?? '');
      setOwnerRefNumber((f as Record<string, unknown>).owner_ref_number as string ?? '');
      setOwnerDOI((f as Record<string, unknown>).owner_date_of_incorporation as string ?? '');
      setOwnerAddress(f.owner_address ?? {});
      setSignerTitle(f.signer_title ?? 'Owner');
      setOwnerBizActivity(f.owner_business_activity ?? '');
      setOwnerBizCode((f as Record<string, unknown>).owner_business_code as string ?? '');
      setOwnerCountry((f as Record<string, unknown>).owner_country as string ?? '');

      const { data: txns } = await supabase
        .from('reportable_transactions').select('*')
        .eq('filing_id', filingId).order('created_at', { ascending: true });
      if (txns) {
        setTransactions(txns.map((t) => ({
          id: t.id,
          transaction_type: t.transaction_type,
          direction: t.direction,
          amount_usd: String(t.amount_usd ?? ''),
          description: t.description ?? '',
          transaction_date: t.transaction_date ?? '',
          is_royalty: t.is_royalty ?? false,
          related_party_naics: (t as Record<string, unknown>).related_party_naics as string ?? '',
        })));
      }
    })();
  }, [filingId]);

  // ── patch helpers ─────────────────────────────────────────────────────────

  function patchFromCurrentStep(): Partial<Filing> & Record<string, unknown> {
    if (step === 1) return {
      llc_name:            llcName.trim() || null,
      ein:                 ein.trim() || null,
      state_of_formation:  stateOfFormation.trim() || null,
      tax_year:            Number(taxYear),
      mailing_address:     mailing,
      entity_business_activity: entityBizActivity.trim() || null,
      entity_business_code:     entityBizCode.trim() || null,
    };
    if (step === 2) return {
      owner_full_name:              ownerName.trim() || null,
      owner_country_residence:      ownerCountryRes.trim() || null,
      owner_country_citizenship:    ownerCountryCit.trim() || null,
      owner_foreign_tax_id:         ownerForeignTaxId.trim() || null,
      owner_ref_number:             ownerRefNumber.trim() || null,
      owner_date_of_incorporation:  ownerDOI.trim() || null,
      owner_address:                ownerAddress,
      signer_title:                 signerTitle.trim() || 'Owner',
      owner_business_activity:      ownerBizActivity.trim() || null,
      owner_business_code:          ownerBizCode.trim() || null,
      owner_country:                ownerCountry.trim() || null,
    };
    return {};
  }

  // ── EIN validation on blur ────────────────────────────────────────────────

  const handleEinBlur = () => {
    if (ein && !isValidEIN(ein)) {
      setEinErr('EIN must be in the format XX-XXXXXXX (e.g. 12-3456789)');
    } else {
      setEinErr(null);
    }
  };

  // ── save / navigation ─────────────────────────────────────────────────────

  const saveStep = async (): Promise<string | null> => {
    setSaving(true);
    setError(null);
    try {
      const patch = patchFromCurrentStep();
      if (!filingId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not signed in');
        const { data, error: err } = await supabase
          .from('filings').insert({ ...patch, user_id: user.id }).select('id').single();
        if (err) throw err;
        return data.id as string;
      } else {
        const { error: err } = await supabase
          .from('filings').update(patch).eq('id', filingId);
        if (err) throw err;
        return filingId;
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    if (step === 1 && ein && !isValidEIN(ein)) {
      setEinErr('EIN must be in the format XX-XXXXXXX (e.g. 12-3456789)');
      return;
    }
    if (step < 3) {
      const id = await saveStep();
      if (id) {
        if (!filingId) navigate(`?filing_id=${id}`, { replace: true });
        setStep((s) => (s + 1) as IntakeStep);
      }
    } else if (step === 3) {
      const saved = await saveTransactions();
      if (saved) setStep(4);
    }
  };

  const handleBack = () => setStep((s) => Math.max(1, s - 1) as IntakeStep);

  // ── transaction helpers ───────────────────────────────────────────────────

  const saveTransactions = async (): Promise<boolean> => {
    if (!filingId) return false;
    setError(null);
    try {
      const validTxns = transactions.filter(
        (t) => t.amount_usd && Number(t.amount_usd) > 0,
      );
      if (validTxns.length === 0) return true;

      // New rows (no id) → insert; existing rows (have id) → upsert
      const toInsert = validTxns
        .filter((t) => !t.id)
        .map((t) => ({
          filing_id:           filingId,
          transaction_type:    t.transaction_type,
          direction:           t.direction,
          amount_usd:          Number(t.amount_usd),
          description:         t.description || null,
          transaction_date:    t.transaction_date || null,
          is_royalty:          t.is_royalty,
          related_party_naics: t.related_party_naics || null,
        }));

      const toUpsert = validTxns
        .filter((t) => !!t.id)
        .map((t) => ({
          id:                  t.id!,
          filing_id:           filingId,
          transaction_type:    t.transaction_type,
          direction:           t.direction,
          amount_usd:          Number(t.amount_usd),
          description:         t.description || null,
          transaction_date:    t.transaction_date || null,
          is_royalty:          t.is_royalty,
          related_party_naics: t.related_party_naics || null,
        }));

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase
          .from('reportable_transactions').insert(toInsert);
        if (insErr) throw insErr;
      }

      if (toUpsert.length > 0) {
        const { error: upErr } = await supabase
          .from('reportable_transactions').upsert(toUpsert, { onConflict: 'id' });
        if (upErr) throw upErr;
      }

      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save transactions');
      return false;
    }
  };

  const addTransaction = () => {
    if (!txAmt || Number(txAmt) <= 0) return;
    setTransactions((prev) => [
      ...prev,
      {
        transaction_type:    txType,
        direction:           txDir,
        amount_usd:          txAmt,
        description:         txDesc,
        transaction_date:    txDate,
        is_royalty:          txIsRoyalty,
        related_party_naics: txRpNaics,
      },
    ]);
    setTxAmt(''); setTxDesc(''); setTxDate('');
    setTxIsRoyalty(false); setTxRpNaics('');
  };

  const removeTransaction = (i: number) =>
    setTransactions((prev) => prev.filter((_, idx) => idx !== i));

  // ── submit (step 4) ───────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!filingId) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from('filings').update({ status: 'in_progress' }).eq('id', filingId);
      if (err) throw err;
      navigate(`/filing/${filingId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSaving(false);
    }
  };

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        .intake-form input,
        .intake-form select,
        .intake-form textarea {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--tf-border, #d1d5db);
          border-radius: 0.375rem;
          font-size: 0.9375rem;
          font-family: inherit;
          background: var(--tf-input-bg, var(--tf-surface, #fff));
          color: var(--tf-text, #111);
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .intake-form input:focus,
        .intake-form select:focus,
        .intake-form textarea:focus {
          border-color: var(--tf-primary, #0284c7);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--tf-primary, #0284c7) 18%, transparent);
        }
        .intake-form input::placeholder {
          color: var(--tf-text-muted, #9ca3af);
          opacity: 1;
        }
        .intake-form input[data-invalid="true"] {
          border-color: #dc2626;
          box-shadow: 0 0 0 3px rgba(220,38,38,0.15);
        }
        .intake-form .field-error {
          font-size: 0.78rem;
          color: #dc2626;
          margin-top: 0.25rem;
        }
        .intake-form select option {
          background: var(--tf-surface, #fff);
          color: var(--tf-text, #111);
        }
        /* auto-derived ref: read-only styling */
        .intake-form input[readonly] {
          background: var(--tf-offset, #f3f4f6);
          color: var(--tf-text-muted, #6b7280);
          cursor: default;
        }

        /* ── Stepper ────────────────────────────────────────── */
        .stepper-track {
          display: inline-flex;
          align-items: center;
          background: #f1f5f9;
          border-radius: 2rem;
          padding: 0.25rem;
          gap: 0;
          margin-bottom: 2rem;
          flex-wrap: nowrap;
          overflow-x: auto;
          max-width: 100%;
        }
        .stepper-pill {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.35rem 0.9rem;
          border-radius: 2rem;
          font-size: 0.8125rem;
          font-weight: 500;
          white-space: nowrap;
          border: none;
          background: transparent;
          transition: background 0.15s, color 0.15s;
          line-height: 1;
        }
        /* Active step */
        .stepper-pill--active {
          background: #0284c7;
          color: #fff;
          font-weight: 700;
          cursor: default;
          box-shadow: 0 1px 4px rgba(2,132,199,0.25);
        }
        /* Completed step */
        .stepper-pill--done {
          background: #e0f2fe;
          color: #0369a1;
          font-weight: 600;
          cursor: pointer;
        }
        .stepper-pill--done:hover {
          background: #bae6fd;
        }
        /* Future / pending step */
        .stepper-pill--pending {
          color: #94a3b8;
          cursor: default;
          opacity: 0.6;
        }
        .stepper-check {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1rem;
          height: 1rem;
          border-radius: 50%;
          background: #0369a1;
          color: #fff;
          font-size: 0.6rem;
          font-weight: 800;
          line-height: 1;
          flex-shrink: 0;
        }

        /* ── Stepper dark mode ──────────────────────────────── */
        @media (prefers-color-scheme: dark) {
          .stepper-track {
            background: rgba(255, 255, 255, 0.10);
          }
          .stepper-pill--done {
            background: rgba(255, 255, 255, 0.12);
            color: #7dd3fc;
          }
          .stepper-pill--done:hover {
            background: rgba(255, 255, 255, 0.18);
          }
          .stepper-check {
            background: #0ea5e9;
          }
        }
      `}</style>

      <div className="intake-form" style={{
        maxWidth: 680,
        margin: '0 auto',
        padding: '2rem 1rem',
        fontFamily: 'inherit',
      }}>

        {/* ── Step breadcrumb — pill group on soft gray track ───────── */}
        <nav aria-label="Form steps">
          <div className="stepper-track">
            {([1, 2, 3, 4] as IntakeStep[]).map((s) => {
              const isDone   = s < step;
              const isActive = s === step;
              const isPending = s > step;
              return (
                <button
                  key={s}
                  type="button"
                  className={[
                    'stepper-pill',
                    isActive  ? 'stepper-pill--active'  : '',
                    isDone    ? 'stepper-pill--done'    : '',
                    isPending ? 'stepper-pill--pending' : '',
                  ].join(' ')}
                  onClick={() => { if (isDone) setStep(s); }}
                  aria-current={isActive ? 'step' : undefined}
                  tabIndex={isDone ? 0 : -1}
                >
                  {isDone && (
                    <span className="stepper-check" aria-hidden="true">✓</span>
                  )}
                  {s}. {STEP_LABELS[s]}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Error banner */}
        {error && (
          <div style={{
            background: '#fef2f2', color: '#991b1b',
            border: '1px solid #fecaca', borderRadius: '0.375rem',
            padding: '0.75rem 1rem', fontSize: '0.875rem', marginBottom: '1.25rem',
          }}>{error}</div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            STEP 1 — LLC Details
        ═══════════════════════════════════════════════════════════════ */}
        {step === 1 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 1 — LLC Details</h2>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Company Information</h3>
              <div style={gridStyle}>

                {/* LLC name */}
                <Field label="LLC / Corporation name *" style={{ gridColumn: '1 / -1' }}>
                  <input
                    value={llcName}
                    onChange={(e) => setLlcName(e.target.value)}
                    placeholder="e.g. Acme Global LLC"
                  />
                </Field>

                {/* EIN with XX-XXXXXXX mask + validation */}
                <Field label="EIN" hint="Employer Identification Number">
                  <input
                    value={ein}
                    onChange={(e) => setEin(formatEIN(e.target.value))}
                    onBlur={handleEinBlur}
                    placeholder="XX-XXXXXXX"
                    data-invalid={einErr ? 'true' : undefined}
                    inputMode="numeric"
                    maxLength={10}
                  />
                  {einErr && <span className="field-error">{einErr}</span>}
                </Field>

                {/* State of formation — dropdown */}
                <Field label="State of formation *">
                  <select
                    value={stateOfFormation}
                    onChange={(e) => setStateOfFormation(e.target.value)}
                  >
                    <option value="">— Select state —</option>
                    {US_STATES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </Field>

                {/* Tax year — 2019–2025 only */}
                <Field label="Tax year *">
                  <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)}>
                    {TAX_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </Field>

              </div>
            </section>

            {/* Entity business activity + code */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Principal Business Activity</h3>
              <div style={gridStyle}>
                <Field label="Activity" hint="What does the LLC primarily do?">
                  <select
                    value={entityBizActivity}
                    onChange={(e) => {
                      const sel = BIZ_ACTIVITIES.find((a) => a.label === e.target.value);
                      setEntityBizActivity(e.target.value);
                      if (sel) setEntityBizCode(sel.code);
                      else setEntityBizCode('');
                    }}
                  >
                    <option value="">— Select activity —</option>
                    {BIZ_ACTIVITIES.map((a) => (
                      <option key={`${a.code}-${a.label}`} value={a.label}>{a.label}</option>
                    ))}
                    <option value="__other__">Other (enter manually below)</option>
                  </select>
                </Field>
                <Field label="Business activity code" hint="Auto-filled or enter manually">
                  <input
                    value={entityBizCode}
                    onChange={(e) => setEntityBizCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="e.g. 541511"
                    inputMode="numeric"
                    maxLength={6}
                  />
                </Field>
                {entityBizActivity === '__other__' && (
                  <Field label="Describe activity" style={{ gridColumn: '1 / -1' }}>
                    <input
                      value={entityBizActivity === '__other__' ? '' : entityBizActivity}
                      onChange={(e) => setEntityBizActivity(e.target.value)}
                      placeholder="Brief description of principal business"
                    />
                  </Field>
                )}
              </div>
            </section>

            {/* Mailing address */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>LLC Mailing Address</h3>
              <AddressFields value={mailing} onChange={setMailing} />
            </section>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            STEP 2 — Foreign Owner / Related Party Details
        ═══════════════════════════════════════════════════════════════ */}
        {step === 2 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 2 — Foreign Owner Details</h2>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Identity</h3>
              <div style={gridStyle}>

                <Field label="Full legal name *" hint="As shown on government ID" style={{ gridColumn: '1 / -1' }}>
                  <input
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="As shown on government ID"
                  />
                </Field>

                {/* Owner country — dropdown (point 9) */}
                <Field label="Owner country *" hint="Country of the related party">
                  <select value={ownerCountry} onChange={(e) => setOwnerCountry(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>

                {/* Country of residence */}
                <Field label="Country of residence *">
                  <select value={ownerCountryRes} onChange={(e) => setOwnerCountryRes(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>

                {/* Country of citizenship */}
                <Field label="Country of citizenship">
                  <select value={ownerCountryCit} onChange={(e) => setOwnerCountryCit(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>

                {/* Foreign tax ID */}
                <Field label="Foreign tax ID" hint="Optional — PAN, TIN, etc.">
                  <input
                    value={ownerForeignTaxId}
                    onChange={(e) => setOwnerForeignTaxId(e.target.value)}
                    placeholder="e.g. ABCDE1234F"
                  />
                </Field>

                {/* Date of incorporation (point 3) */}
                <Field label="Date of incorporation" hint="Owner entity's incorporation date">
                  <input
                    type="date"
                    value={ownerDOI}
                    onChange={(e) => setOwnerDOI(e.target.value)}
                  />
                </Field>

                {/* Owner reference — auto-derived, read-only (point 7 & 10) */}
                <Field
                  label="Owner reference number"
                  hint="Auto-derived: first 3 letters of name + 001"
                >
                  <input
                    value={ownerRefNumber}
                    onChange={(e) => setOwnerRefNumber(e.target.value)}
                    placeholder="e.g. CHI001"
                    readOnly={!!ownerName.trim()}
                  />
                </Field>

              </div>
            </section>

            {/* Owner address */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Owner Address</h3>
              <AddressFields value={ownerAddress} onChange={setOwnerAddress} />
            </section>

            {/* Signature & activity */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Signature &amp; Business Activity</h3>
              <div style={gridStyle}>

                <Field label="Your title" hint="Printed on the form signature line">
                  <input
                    value={signerTitle}
                    onChange={(e) => setSignerTitle(e.target.value)}
                    placeholder="Owner"
                  />
                </Field>

                {/* Owner principal business activity + code (point 5a) */}
                <Field label="Principal business activity" hint="Related party's primary business">
                  <select
                    value={ownerBizActivity}
                    onChange={(e) => {
                      const sel = BIZ_ACTIVITIES.find((a) => a.label === e.target.value);
                      setOwnerBizActivity(e.target.value);
                      if (sel) setOwnerBizCode(sel.code);
                      else setOwnerBizCode('');
                    }}
                  >
                    <option value="">— Select activity —</option>
                    {BIZ_ACTIVITIES.map((a) => (
                      <option key={`${a.code}-${a.label}`} value={a.label}>{a.label}</option>
                    ))}
                    <option value="__other__">Other (enter manually below)</option>
                  </select>
                </Field>

                <Field label="Activity code" hint="Auto-filled or enter manually">
                  <input
                    value={ownerBizCode}
                    onChange={(e) => setOwnerBizCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="e.g. 541511"
                    inputMode="numeric"
                    maxLength={6}
                  />
                </Field>

              </div>
            </section>

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            STEP 3 — Reportable Transactions
        ═══════════════════════════════════════════════════════════════ */}
        {step === 3 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 3 — Reportable Transactions</h2>
            <p style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.55 }}>
              Add every monetary transaction between you and the LLC during the tax year.
              For loans, enter the <strong>year-end closing balance</strong>.
            </p>

            {/* Add transaction form */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Add a transaction</h3>
              <div style={gridStyle}>

                <Field label="Type">
                  <select value={txType} onChange={(e) => { setTxType(e.target.value); setTxIsRoyalty(false); }}>
                    {TX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>

                {!LOAN_TYPES.has(txType) && (
                  <Field label="Direction">
                    <select value={txDir} onChange={(e) => setTxDir(e.target.value as 'paid' | 'received')}>
                      <option value="received">LLC received</option>
                      <option value="paid">LLC paid</option>
                    </select>
                  </Field>
                )}

                <Field label={LOAN_TYPES.has(txType) ? 'Closing balance (USD) *' : 'Amount (USD) *'}>
                  <input
                    type="number" min="0" value={txAmt}
                    onChange={(e) => setTxAmt(e.target.value)}
                    placeholder="0"
                  />
                </Field>

                <Field label="Date" hint="Optional">
                  <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
                </Field>

                {ROYALTY_TYPES.has(txType) && (
                  <Field label="Subtype">
                    <select
                      value={txIsRoyalty ? 'royalty' : 'rent'}
                      onChange={(e) => setTxIsRoyalty(e.target.value === 'royalty')}
                    >
                      <option value="rent">Rent</option>
                      <option value="royalty">Royalty</option>
                    </select>
                  </Field>
                )}

                {/* Related-party NAICS (point 11) */}
                <Field label="Related-party NAICS" hint="Type of business of the related party" style={{ gridColumn: '1 / -1' }}>
                  <select value={txRpNaics} onChange={(e) => setTxRpNaics(e.target.value)}>
                    <option value="">— Select NAICS (optional) —</option>
                    {RP_NAICS.map((n) => (
                      <option key={`${n.code}-${n.label}`} value={n.code}>
                        {n.code} — {n.label} ({n.hint})
                      </option>
                    ))}
                    <option value="__manual__">Other — enter code manually</option>
                  </select>
                </Field>

                <Field label="Description" hint="Optional" style={{ gridColumn: '1 / -1' }}>
                  <input value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Brief description" />
                </Field>

              </div>

              {/* Part VI hint */}
              {PART_VI_TYPES.has(txType) && (
                <p style={{
                  fontSize: '0.8125rem', color: 'var(--tf-text-muted, #6b7280)',
                  marginTop: '0.75rem', padding: '0.625rem 0.875rem',
                  background: 'var(--tf-offset, #f9fafb)',
                  border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.375rem',
                }}>
                  ℹ️ Disclosed in <strong>Part VI statement</strong> (nonmonetary / less-than-FMV). Amount is optional.
                </p>
              )}

              <button onClick={addTransaction} style={addBtnStyle} type="button">
                + Add transaction
              </button>
            </section>

            {/* Transaction list */}
            {transactions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.5rem' }}>
                {transactions.map((tx, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.55rem 0.875rem',
                    background: 'var(--tf-surface, #fff)',
                    border: '1px solid var(--tf-border, #e5e7eb)',
                    borderRadius: '0.5rem', fontSize: '0.875rem',
                  }}>
                    <div style={{ flex: 1, display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>
                        {TX_TYPES.find((t) => t.value === tx.transaction_type)?.label ?? tx.transaction_type}
                      </span>
                      {!LOAN_TYPES.has(tx.transaction_type) && (
                        <span style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.75rem', alignSelf: 'center' }}>
                          {tx.direction === 'received' ? '↓ received' : '↑ paid'}
                        </span>
                      )}
                      {tx.is_royalty && (
                        <span style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.75rem', alignSelf: 'center' }}>royalty</span>
                      )}
                      {tx.related_party_naics && tx.related_party_naics !== '__manual__' && (
                        <span style={{
                          fontSize: '0.72rem',
                          color: '#0284c7',
                          background: '#e0f2fe',
                          padding: '0.1rem 0.4rem',
                          borderRadius: '0.25rem',
                          alignSelf: 'center',
                        }}>
                          NAICS {tx.related_party_naics}
                        </span>
                      )}
                      {tx.description && (
                        <span style={{ color: 'var(--tf-text-muted, #6b7280)' }}> — {tx.description}</span>
                      )}
                    </div>
                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#0284c7' }}>
                      ${Number(tx.amount_usd).toLocaleString()}
                    </span>
                    <button
                      onClick={() => removeTransaction(i)}
                      style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: '1.125rem', cursor: 'pointer', padding: '0 0.25rem', lineHeight: 1 }}
                      type="button" aria-label="Remove transaction"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            STEP 4 — Review & Submit
        ═══════════════════════════════════════════════════════════════ */}
        {step === 4 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 4 — Review &amp; Submit</h2>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>LLC</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="LLC name"          value={llcName} />
                <SummaryRow label="EIN"               value={ein} />
                <SummaryRow label="State"             value={US_STATES.find((s) => s.value === stateOfFormation)?.label ?? stateOfFormation} />
                <SummaryRow label="Tax year"          value={taxYear} />
                <SummaryRow label="Business activity" value={entityBizActivity !== '__other__' ? entityBizActivity : ''} />
                <SummaryRow label="Activity code"     value={entityBizCode} />
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Owner / Related Party</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="Full name"         value={ownerName} />
                <SummaryRow label="Owner country"     value={COUNTRIES.find((c) => c.value === ownerCountry)?.label ?? ownerCountry} />
                <SummaryRow label="Country of res."   value={COUNTRIES.find((c) => c.value === ownerCountryRes)?.label ?? ownerCountryRes} />
                <SummaryRow label="Citizenship"       value={COUNTRIES.find((c) => c.value === ownerCountryCit)?.label ?? ownerCountryCit} />
                <SummaryRow label="Foreign tax ID"    value={ownerForeignTaxId} />
                <SummaryRow label="Date of incorp."   value={ownerDOI} />
                <SummaryRow label="Owner ref"         value={ownerRefNumber} />
                <SummaryRow label="Signer title"      value={signerTitle} />
                <SummaryRow label="Business activity" value={ownerBizActivity !== '__other__' ? ownerBizActivity : ''} />
                <SummaryRow label="Activity code"     value={ownerBizCode} />
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Transactions ({transactions.length})</h3>
              {transactions.length === 0 ? (
                <p style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.875rem' }}>
                  No transactions added yet.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {transactions.map((tx, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: '0.75rem', alignItems: 'center',
                      padding: '0.5rem 0.875rem',
                      background: 'var(--tf-surface, #fff)',
                      border: '1px solid var(--tf-border, #e5e7eb)',
                      borderRadius: '0.5rem', fontSize: '0.875rem',
                    }}>
                      <span style={{ flex: 1, fontWeight: 500 }}>
                        {TX_TYPES.find((t) => t.value === tx.transaction_type)?.label ?? tx.transaction_type}
                      </span>
                      {tx.related_party_naics && tx.related_party_naics !== '__manual__' && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--tf-text-muted, #6b7280)' }}>
                          NAICS {tx.related_party_naics}
                        </span>
                      )}
                      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#0284c7' }}>
                        ${Number(tx.amount_usd).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

          </div>
        )}

        {/* ── Navigation ────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end',
          gap: '0.75rem', paddingTop: '1.5rem',
          borderTop: '1px solid var(--tf-border, #e5e7eb)',
          marginTop: '1.5rem',
        }}>
          {step > 1 && (
            <button onClick={handleBack} disabled={saving} style={secondaryBtnStyle} type="button">
              ← Back
            </button>
          )}
          {step < 4 ? (
            <button onClick={handleNext} disabled={saving} style={primaryBtnStyle} type="button">
              {saving ? 'Saving…' : step === 3 ? 'Save & Review →' : 'Save & Continue →'}
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={saving} style={primaryBtnStyle} type="button">
              {saving ? 'Submitting…' : 'Submit Intake →'}
            </button>
          )}
        </div>

      </div>
    </>
  );
}

export default Intake;

// ─── small components ─────────────────────────────────────────────────────────

function Field({
  label, hint, children, style,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', ...style }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-text-muted, #6b7280)' }}>
        {label}
        {hint && <span style={{ fontWeight: 400, marginLeft: '0.25rem' }}>— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function AddressFields({ value, onChange }: { value: Address; onChange: (a: Address) => void }) {
  const set = (k: keyof Address, v: string) => onChange({ ...value, [k]: v });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
      <Field label="Street line 1" style={{ gridColumn: '1 / -1' }}>
        <input placeholder="Street line 1" value={value.line1 ?? ''} onChange={(e) => set('line1', e.target.value)} />
      </Field>
      <Field label="Street line 2" style={{ gridColumn: '1 / -1' }}>
        <input placeholder="Optional" value={value.line2 ?? ''} onChange={(e) => set('line2', e.target.value)} />
      </Field>
      <Field label="City">
        <input placeholder="City" value={value.city ?? ''} onChange={(e) => set('city', e.target.value)} />
      </Field>
      <Field label="State / Region">
        <input placeholder="State / Region" value={value.region ?? ''} onChange={(e) => set('region', e.target.value)} />
      </Field>
      <Field label="Postal code">
        <input placeholder="Postal code" value={value.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} />
      </Field>
      <Field label="Country">
        <input placeholder="Country" value={value.country ?? ''} onChange={(e) => set('country', e.target.value)} />
      </Field>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: 'var(--tf-text-muted, #6b7280)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.95rem', fontWeight: 500, color: value ? 'var(--tf-text, #111)' : 'var(--tf-text-muted, #9ca3af)' }}>
        {value || '—'}
      </div>
    </div>
  );
}

// ─── shared styles ────────────────────────────────────────────────────────────

const stepHeadingStyle: React.CSSProperties = {
  fontSize: '1.25rem',
  fontWeight: 700,
  marginBottom: '1.5rem',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '2rem',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'var(--tf-text-muted, #6b7280)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '0.875rem',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: '1rem',
};

const reviewGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: '0.75rem',
  background: 'var(--tf-surface, #fff)',
  border: '1px solid var(--tf-border, #e5e7eb)',
  borderRadius: '0.625rem',
  padding: '1rem 1.25rem',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.5rem',
  background: '#0284c7',
  color: '#fff',
  border: 'none',
  borderRadius: '0.5rem',
  fontWeight: 700,
  fontSize: '0.95rem',
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.25rem',
  background: 'transparent',
  color: 'var(--tf-text, #111)',
  border: '1px solid var(--tf-border, #d1d5db)',
  borderRadius: '0.5rem',
  fontWeight: 600,
  fontSize: '0.95rem',
  cursor: 'pointer',
};

const addBtnStyle: React.CSSProperties = {
  marginTop: '0.75rem',
  alignSelf: 'flex-start',
  padding: '0.4375rem 1rem',
  background: '#0284c7',
  color: '#fff',
  border: 'none',
  borderRadius: '0.375rem',
  fontWeight: 600,
  fontSize: '0.875rem',
  cursor: 'pointer',
};

// Used for related-party ref preview on step 3 if ever needed
void buildRelatedPartyRef;
