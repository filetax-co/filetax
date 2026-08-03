// src/app/pages/intake/countryTaxIds.ts
//
// Per-country foreign tax identification numbers, keyed by the country of
// TAX RESIDENCE (not citizenship, not the mailing address). Form 5472 Part II
// line 4b asks for the foreign taxpayer identification number "if any", and the
// Instructions treat the residence jurisdiction as the issuer.
//
// WHY THIS FILE EXISTS
// Before this, the field was labelled "Your foreign tax ID" for everybody, with
// one static tooltip naming four example countries. A filer in Jakarta had to
// work out on their own that we meant their NPWP. Naming the number in the
// language the filer already uses is the cheapest trust signal in the intake:
// it says we have prepared this return for someone like them before.
//
// VALIDATION PHILOSOPHY - read before adding a `pattern`
// These patterns are advisory ONLY. `taxIdWarning()` returns a sentence to show
// beside the field; nothing here blocks submission, and nothing here is wired
// into validateStep2(). That is deliberate. A wrong regex on a country we
// serve once a year would stop a real filing dead, and the cost of a false
// block (a lost customer, staring at a $25,000 penalty) is far higher than the
// cost of a false accept (a number the IRS reads as-is). Where a country's
// format is genuinely variable, or where we are not certain, `pattern` is
// simply omitted and the entry still earns its keep through `label` and `help`.
//
// `issues: false` marks a jurisdiction that does not give individuals a tax ID
// at all. Those filers are a large share of our audience - the UAE alone - and
// telling them plainly what to enter instead is the single most useful thing
// this file does. The IRS accepts a passport number as the identifying number
// here; what it does not accept is a blank box or the word "None".
//
// SOURCES: OECD AEOI per-jurisdiction TIN profiles are the authority for the
// entries carrying a `pattern`. Anything softer is expressed as prose in
// `format`/`help` rather than a regex.

export type CountryTaxId = {
  /** Field label, in the filer's own vocabulary. */
  label: string;
  /** Short acronym, for tight spaces (summary rows, related-party cards). */
  short: string;
  /** Native-language name, shown in the tooltip when it differs from `label`. */
  localName?: string;
  /** Shape shown as the input placeholder. */
  example?: string;
  /** Human description of the structure. */
  format?: string;
  /** Advisory regex. Tested against the value with spaces/dots/dashes stripped. */
  pattern?: RegExp;
  /** Where the filer physically finds the number. */
  help?: string;
  /** False when the jurisdiction issues individuals no tax ID whatsoever. */
  issues?: false;
  /** What to enter instead, when `issues` is false. */
  alt?: string;
};

/** Strip the separators people type but no country's regex should care about. */
export function normalizeTaxId(raw: string): string {
  return raw.replace(/[\s.\-/]/g, '').toUpperCase();
}

// ── South & Central Asia ──────────────────────────────────────────────────
const SOUTH_ASIA: Record<string, CountryTaxId> = {
  India: {
    label: 'PAN (Permanent Account Number)',
    short: 'PAN',
    example: 'AAAAA9999A',
    format: '10 characters: 5 letters, then 4 digits, then 1 letter',
    pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    help: 'On your PAN card, or at the top of any Indian income-tax return.',
  },
  Pakistan: {
    label: 'NTN or CNIC',
    short: 'NTN',
    localName: 'National Tax Number',
    example: '1234567-8',
    format: 'NTN is 7 digits plus a check digit. A 13-digit CNIC is also accepted.',
    help: 'On your FBR registration certificate, or your CNIC card.',
  },
  Bangladesh: {
    label: 'e-TIN',
    short: 'e-TIN',
    example: '123456789012',
    format: '12 digits',
    pattern: /^[0-9]{12}$/,
    help: 'On your NBR e-TIN certificate.',
  },
  'Sri Lanka': {
    label: 'TIN',
    short: 'TIN',
    example: '123456789',
    format: '9 digits',
    help: 'On your Inland Revenue Department registration.',
  },
  Nepal: {
    label: 'PAN (Permanent Account Number)',
    short: 'PAN',
    example: '123456789',
    format: '9 digits',
    help: 'On your Inland Revenue Department PAN certificate.',
  },
  Maldives: {
    label: 'TIN',
    short: 'TIN',
    example: '1012345GST501',
    format: 'Issued by MIRA; length varies',
    help: 'On your MIRA taxpayer registration.',
  },
  Bhutan: {
    label: 'TPN (Taxpayer Number)',
    short: 'TPN',
    example: '12345678',
    format: '8 digits',
    help: 'On your Department of Revenue and Customs registration.',
  },
  Afghanistan: {
    label: 'TIN',
    short: 'TIN',
    example: '1234567890',
    format: '10 digits',
    help: 'On your Afghanistan Revenue Department registration.',
  },
  Kazakhstan: {
    label: 'IIN (ЖСН / ИИН)',
    short: 'IIN',
    localName: 'Жеке сәйкестендіру нөмірі',
    example: '850101123456',
    format: '12 digits',
    pattern: /^[0-9]{12}$/,
    help: 'On your Kazakh ID card.',
  },
  Uzbekistan: {
    label: 'INN (STIR)',
    short: 'INN',
    example: '123456789',
    format: '9 digits',
    pattern: /^[0-9]{9}$/,
    help: 'On your State Tax Committee registration.',
  },
  Kyrgyzstan: {
    label: 'INN',
    short: 'INN',
    example: '12345678901234',
    format: '14 digits',
    help: 'On your State Tax Service registration.',
  },
  Azerbaijan: {
    label: 'VÖEN (TIN)',
    short: 'VÖEN',
    localName: 'Vergi ödəyicisinin eyniləşdirmə nömrəsi',
    example: '1234567890',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your State Tax Service registration.',
  },
  Mongolia: {
    label: 'TIN or Civil ID',
    short: 'TIN',
    example: 'AA12345678',
    format: 'Civil ID is 2 letters followed by 8 digits',
    help: 'On your Mongolian civil identity card.',
  },
};

// ── Middle East ───────────────────────────────────────────────────────────
const MIDDLE_EAST: Record<string, CountryTaxId> = {
  'United Arab Emirates': {
    label: 'Passport or Emirates ID number',
    short: 'Passport / Emirates ID',
    issues: false,
    alt: 'passport number',
    help:
      'The UAE does not issue personal tax identification numbers, so there is nothing to look up. ' +
      'Enter your passport number (or your Emirates ID). The IRS accepts either as the identifying ' +
      'number in this box. Do not leave it blank and do not write "None".',
  },
  'Saudi Arabia': {
    label: 'TIN or National ID',
    short: 'TIN',
    example: '1234567890',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your ZATCA registration, or your national ID / Iqama card.',
  },
  Qatar: {
    label: 'Qatar ID (QID) or TIN',
    short: 'QID',
    example: '12345678901',
    format: '11 digits',
    help: 'Qatar issues a TIN only to individuals carrying on business. Otherwise enter your QID, or your passport number.',
  },
  Kuwait: {
    label: 'Passport or Civil ID number',
    short: 'Passport / Civil ID',
    issues: false,
    alt: 'passport number',
    help: 'Kuwait does not issue personal tax identification numbers. Enter your passport number or Civil ID.',
  },
  Bahrain: {
    label: 'Passport or CPR number',
    short: 'Passport / CPR',
    issues: false,
    alt: 'passport number',
    help: 'Bahrain does not issue personal tax identification numbers. Enter your passport number or CPR number.',
  },
  Oman: {
    label: 'Passport or Civil ID number',
    short: 'Passport / Civil ID',
    issues: false,
    alt: 'passport number',
    help: 'Oman does not issue personal tax identification numbers. Enter your passport number or Civil ID.',
  },
  Israel: {
    label: 'Teudat Zehut (ID number)',
    short: 'Teudat Zehut',
    localName: 'תעודת זהות',
    example: '123456789',
    format: '9 digits',
    pattern: /^[0-9]{9}$/,
    help: 'On your Israeli identity card. Israel uses the same number for tax.',
  },
  Turkey: {
    label: 'Vergi Kimlik No / T.C. Kimlik No',
    short: 'VKN',
    localName: 'Vergi Kimlik Numarası',
    example: '12345678901',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help: 'Residents use the 11-digit T.C. Kimlik number, which doubles as the tax number.',
  },
  Jordan: {
    label: 'TIN',
    short: 'TIN',
    example: '12345678',
    format: '8 digits',
    help: 'On your Income and Sales Tax Department registration.',
  },
  Lebanon: {
    label: 'TIN',
    short: 'TIN',
    example: '1234567',
    format: 'Up to 8 digits',
    help: 'On your Ministry of Finance registration.',
  },
  Iraq: {
    label: 'TIN or National ID',
    short: 'TIN',
    example: '123456789',
    format: 'Length varies by governorate',
    help: 'On your General Commission for Taxes registration, or your national ID.',
  },
  Iran: {
    label: 'National ID (Kad-e Melli)',
    short: 'National ID',
    localName: 'کد ملی',
    example: '1234567890',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your Iranian national identity card.',
  },
  Syria: {
    label: 'TIN or National ID',
    short: 'TIN',
    format: 'Length varies',
    help: 'On your Ministry of Finance registration, or your national ID card.',
  },
  Yemen: {
    label: 'TIN',
    short: 'TIN',
    format: 'Length varies',
    help: 'On your Tax Authority registration.',
  },
};

// ── Africa ────────────────────────────────────────────────────────────────
const AFRICA: Record<string, CountryTaxId> = {
  Nigeria: {
    label: 'TIN',
    short: 'TIN',
    example: '12345678-0001',
    format: 'Issued by the JTB or FIRS; length varies by issuer',
    help: 'On your JTB/FIRS TIN certificate, or via the JTB TIN verification portal.',
  },
  Kenya: {
    label: 'KRA PIN',
    short: 'KRA PIN',
    example: 'A123456789Z',
    format: '11 characters: a letter, 9 digits, then a letter',
    pattern: /^[A-Z][0-9]{9}[A-Z]$/,
    help: 'On your KRA PIN certificate, from the iTax portal.',
  },
  Ghana: {
    label: 'TIN or Ghana Card PIN',
    short: 'TIN',
    example: 'GHA-123456789-0',
    format: 'The Ghana Card PIN now serves as the TIN',
    help: 'On your Ghana Card, or your GRA TIN certificate.',
  },
  'South Africa': {
    label: 'SARS tax reference number',
    short: 'Tax ref.',
    example: '0123456789',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your SARS notice of assessment (ITA34) or eFiling profile.',
  },
  Egypt: {
    label: 'Tax registration number',
    short: 'TIN',
    example: '123-456-789',
    format: '9 digits',
    help: 'On your Egyptian Tax Authority registration card.',
  },
  Morocco: {
    label: 'Identifiant Fiscal (IF)',
    short: 'IF',
    localName: 'Identifiant Fiscal',
    example: '12345678',
    format: '7 to 8 digits',
    help: 'On your Direction Générale des Impôts registration.',
  },
  Mauritius: {
    label: 'Tax Account Number (TAN)',
    short: 'TAN',
    example: '12345678',
    format: '8 digits',
    help: 'On your Mauritius Revenue Authority correspondence.',
  },
  Tanzania: {
    label: 'TIN',
    short: 'TIN',
    example: '123-456-789',
    format: '9 digits',
    help: 'On your Tanzania Revenue Authority TIN certificate.',
  },
  Uganda: {
    label: 'TIN',
    short: 'TIN',
    example: '1234567890',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your Uganda Revenue Authority registration.',
  },
  Rwanda: {
    label: 'TIN',
    short: 'TIN',
    example: '123456789',
    format: '9 digits',
    pattern: /^[0-9]{9}$/,
    help: 'On your Rwanda Revenue Authority registration.',
  },
  Zambia: {
    label: 'TPIN',
    short: 'TPIN',
    example: '1234567890',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your Zambia Revenue Authority registration.',
  },
  Zimbabwe: {
    label: 'BPN (Business Partner Number)',
    short: 'BPN',
    example: '1234567890',
    format: '10 digits',
    help: 'On your ZIMRA registration.',
  },
  Botswana: {
    label: 'TIN',
    short: 'TIN',
    example: 'C12345678',
    format: 'A letter followed by 8 digits',
    help: 'On your Botswana Unified Revenue Service registration.',
  },
  Namibia: {
    label: 'TIN',
    short: 'TIN',
    example: '12345678',
    format: '8 digits',
    help: 'On your Namibia Revenue Agency registration.',
  },
  Ethiopia: {
    label: 'TIN',
    short: 'TIN',
    example: '1234567890',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your Ministry of Revenues registration.',
  },
  Senegal: {
    label: 'NINEA',
    short: 'NINEA',
    localName: "Numéro d'Identification Nationale des Entreprises et Associations",
    example: '123456789',
    format: '9 digits',
    help: 'On your Direction Générale des Impôts et des Domaines registration.',
  },
  Cameroon: {
    label: 'NIU (Numéro Identifiant Unique)',
    short: 'NIU',
    localName: 'Numéro Identifiant Unique',
    example: 'P123456789012A',
    format: '14 characters',
    help: 'On your Direction Générale des Impôts registration.',
  },
  Algeria: {
    label: 'NIF (Numéro d\'Identification Fiscale)',
    short: 'NIF',
    localName: "Numéro d'Identification Fiscale",
    example: '123456789012345',
    format: '15 digits',
    help: 'On your Direction Générale des Impôts registration.',
  },
  Tunisia: {
    label: 'Matricule Fiscal',
    short: 'Matricule Fiscal',
    localName: 'Matricule Fiscal',
    example: '1234567A/B/C/000',
    format: '7 digits, a check letter, then category letters',
    help: 'On your Direction Générale des Impôts registration.',
  },
  Libya: {
    label: 'TIN',
    short: 'TIN',
    format: 'Length varies',
    help: 'On your Libyan Tax Authority registration.',
  },
  Angola: {
    label: 'NIF',
    short: 'NIF',
    localName: 'Número de Identificação Fiscal',
    example: '123456789LA123',
    format: 'Alphanumeric; individuals use their BI number',
    help: 'On your bilhete de identidade, or your AGT registration.',
  },
  Mozambique: {
    label: 'NUIT',
    short: 'NUIT',
    localName: 'Número Único de Identificação Tributária',
    example: '123456789',
    format: '9 digits',
    pattern: /^[0-9]{9}$/,
    help: 'On your Autoridade Tributária registration.',
  },
};

// ── Europe ────────────────────────────────────────────────────────────────
const EUROPE: Record<string, CountryTaxId> = {
  'United Kingdom': {
    label: 'UTR (Unique Taxpayer Reference)',
    short: 'UTR',
    example: '1234567890',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your HMRC Self Assessment notice, or in your HMRC online account. Your National Insurance number is also accepted.',
  },

  // ── Crown Dependencies and Gibraltar ─────────────────────────────────────
  // Separate tax jurisdictions from the UK, each issuing its own number, so a
  // resident here must not be told to enter a UTR. Deliberately no `pattern`:
  // these are low-volume for us and the file's rule is that an unverified regex
  // is worse than none, because it warns on a number that is actually correct.
  Jersey: {
    label: 'Tax Identification Number',
    short: 'TIN',
    help: 'Issued by Revenue Jersey. On your Jersey tax return or assessment.',
  },
  Guernsey: {
    label: 'Tax Reference Number',
    short: 'Tax ref',
    help: 'Issued by the Guernsey Revenue Service. On your Guernsey tax return or assessment.',
  },
  'Isle of Man': {
    label: 'Tax Reference Number',
    short: 'Tax ref',
    help: 'Issued by the Isle of Man Income Tax Division. On your Manx tax return or assessment.',
  },
  Gibraltar: {
    label: 'Taxpayer Identification Number',
    short: 'TIN',
    help: 'Issued by the Gibraltar Income Tax Office. On your Gibraltar tax return or assessment.',
  },
  Ireland: {
    label: 'PPS Number',
    short: 'PPSN',
    localName: 'Uimhir Phearsanta Seirbhíse Poiblí',
    example: '1234567FA',
    format: '7 digits followed by 1 or 2 letters',
    pattern: /^[0-9]{7}[A-Z]{1,2}$/,
    help: 'On your Revenue correspondence or your Public Services Card.',
  },
  Germany: {
    label: 'Steuerliche Identifikationsnummer',
    short: 'Steuer-ID',
    localName: 'Steuer-ID / IdNr',
    example: '12 345 678 901',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help: 'On the letter the Bundeszentralamt für Steuern sent when you registered, or on any Lohnsteuerbescheinigung.',
  },
  France: {
    label: 'Numéro fiscal de référence',
    short: 'Numéro fiscal',
    localName: 'Numéro fiscal de référence (SPI)',
    example: '1234567890123',
    format: '13 digits',
    pattern: /^[0-9]{13}$/,
    help: 'Top-left of your avis d\'impôt, or in your espace particulier on impots.gouv.fr.',
  },
  Spain: {
    label: 'NIF / NIE',
    short: 'NIF',
    localName: 'Número de Identificación Fiscal',
    example: '12345678Z or X1234567L',
    format: 'DNI: 8 digits + a letter. NIE: X, Y or Z + 7 digits + a letter.',
    pattern: /^([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z])$/,
    help: 'On your DNI or NIE card, or any Agencia Tributaria notice.',
  },
  Portugal: {
    label: 'NIF (Número de Identificação Fiscal)',
    short: 'NIF',
    localName: 'Número de Identificação Fiscal',
    example: '123456789',
    format: '9 digits',
    pattern: /^[0-9]{9}$/,
    help: 'On your cartão de cidadão or any Autoridade Tributária document.',
  },
  Italy: {
    label: 'Codice Fiscale',
    short: 'Codice Fiscale',
    localName: 'Codice Fiscale',
    example: 'RSSMRA85M01H501Z',
    format: '16 characters, alphanumeric',
    pattern: /^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$/,
    help: 'On your tessera sanitaria (health card) or codice fiscale card.',
  },
  Netherlands: {
    label: 'BSN (Burgerservicenummer)',
    short: 'BSN',
    localName: 'Burgerservicenummer',
    example: '123456789',
    format: '9 digits',
    pattern: /^[0-9]{9}$/,
    help: 'On your Dutch passport, ID card, or any Belastingdienst letter.',
  },
  Belgium: {
    label: 'Rijksregisternummer / Numéro national',
    short: 'NN',
    example: '85.01.01-123.45',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help: 'On the back of your Belgian eID card.',
  },
  Poland: {
    label: 'PESEL',
    short: 'PESEL',
    example: '85010112345',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help: 'On your dowód osobisty. If you run a business, your 10-digit NIP is also accepted.',
  },
  'Czech Republic': {
    label: 'Rodné číslo (birth number)',
    short: 'Rodné číslo',
    localName: 'Rodné číslo',
    example: '850101/1234',
    format: '9 or 10 digits',
    help: 'On your Czech ID card.',
  },
  Romania: {
    label: 'CNP (Cod Numeric Personal)',
    short: 'CNP',
    localName: 'Cod Numeric Personal',
    example: '1850101123456',
    format: '13 digits',
    pattern: /^[0-9]{13}$/,
    help: 'On your Romanian identity card.',
  },
  Bulgaria: {
    label: 'EGN (ЕГН)',
    short: 'EGN',
    localName: 'Единен граждански номер',
    example: '8501011234',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your Bulgarian identity card.',
  },
  Greece: {
    label: 'AFM (ΑΦΜ)',
    short: 'AFM',
    localName: 'Αριθμός Φορολογικού Μητρώου',
    example: '123456789',
    format: '9 digits',
    pattern: /^[0-9]{9}$/,
    help: 'On any ΑΑΔΕ (tax office) document, or in your TAXISnet account.',
  },
  Hungary: {
    label: 'Adóazonosító jel',
    short: 'Adóazonosító',
    localName: 'Adóazonosító jel',
    example: '8123456789',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your adókártya (tax card).',
  },
  Austria: {
    label: 'Steuernummer',
    short: 'Steuernummer',
    localName: 'Abgabenkontonummer',
    example: '12-345/6789',
    format: '9 digits, usually written 12-345/6789',
    help: 'On any Finanzamt assessment notice.',
  },
  Switzerland: {
    label: 'AHV / AVS number',
    short: 'AHV',
    localName: 'AHV-Nummer / Numéro AVS',
    example: '756.1234.5678.90',
    format: 'Starts 756, then 10 digits',
    pattern: /^756[0-9]{10}$/,
    help: 'On your AHV/AVS card or health insurance card.',
  },
  Sweden: {
    label: 'Personnummer',
    short: 'Personnummer',
    localName: 'Personnummer',
    example: '19850101-1234',
    format: '10 or 12 digits, YYYYMMDD-NNNN',
    help: 'On your Swedish ID card, or from Skatteverket.',
  },
  Norway: {
    label: 'Fødselsnummer',
    short: 'Fødselsnummer',
    localName: 'Fødselsnummer',
    example: '01018512345',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help: 'On your Norwegian ID, or from Skatteetaten.',
  },
  Denmark: {
    label: 'CPR number',
    short: 'CPR',
    localName: 'CPR-nummer',
    example: '010185-1234',
    format: '10 digits, DDMMYY-NNNN',
    pattern: /^[0-9]{10}$/,
    help: 'On your sundhedskort (health card).',
  },
  Finland: {
    label: 'Henkilötunnus',
    short: 'HETU',
    localName: 'Henkilötunnus',
    example: '010185-123A',
    format: '11 characters, DDMMYY, a century marker, 3 digits, 1 check character',
    help: 'On your Finnish ID card or Kela card.',
  },
  Estonia: {
    label: 'Isikukood (personal code)',
    short: 'Isikukood',
    localName: 'Isikukood',
    example: '38501012345',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help:
      'On your Estonian ID card. If you hold an e-Residency card, the isikukood printed on it is ' +
      'the number to use here.',
  },
  Latvia: {
    label: 'Personas kods',
    short: 'Personas kods',
    localName: 'Personas kods',
    example: '010185-12345',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help: 'On your Latvian ID card.',
  },
  Lithuania: {
    label: 'Asmens kodas',
    short: 'Asmens kodas',
    localName: 'Asmens kodas',
    example: '38501011234',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help: 'On your Lithuanian ID card.',
  },
  Croatia: {
    label: 'OIB',
    short: 'OIB',
    localName: 'Osobni identifikacijski broj',
    example: '12345678901',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help: 'On your Croatian ID card.',
  },
  Serbia: {
    label: 'JMBG / PIB',
    short: 'JMBG',
    localName: 'Jedinstveni matični broj građana',
    example: '0101985123456',
    format: '13 digits',
    pattern: /^[0-9]{13}$/,
    help: 'On your Serbian ID card.',
  },
  Ukraine: {
    label: 'RNOKPP (tax number)',
    short: 'RNOKPP',
    localName: 'РНОКПП',
    example: '1234567890',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your Ukrainian tax number certificate, or printed in your ID card.',
  },
  Russia: {
    label: 'INN (ИНН)',
    short: 'INN',
    localName: 'Идентификационный номер налогоплательщика',
    example: '123456789012',
    format: '12 digits for individuals',
    pattern: /^[0-9]{12}$/,
    help: 'On your INN certificate from the Federal Tax Service.',
  },
  Georgia: {
    label: 'Personal number',
    short: 'Personal no.',
    example: '01234567890',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help: 'On your Georgian ID card. Georgia uses the same number for tax.',
  },
  Armenia: {
    label: 'TIN (ՀՎՀՀ)',
    short: 'TIN',
    example: '12345678',
    format: '8 digits',
    help: 'On your State Revenue Committee registration.',
  },
  Monaco: {
    label: 'Passport number',
    short: 'Passport',
    issues: false,
    alt: 'passport number',
    help: 'Monaco does not issue personal tax identification numbers. Enter your passport number.',
  },
  Slovakia: {
    label: 'Rodné číslo (birth number)',
    short: 'Rodné číslo',
    localName: 'Rodné číslo',
    example: '850101/1234',
    format: '9 or 10 digits',
    help: 'On your Slovak ID card.',
  },
  Slovenia: {
    label: 'Davčna številka',
    short: 'Davčna št.',
    localName: 'Davčna številka',
    example: '12345678',
    format: '8 digits',
    pattern: /^[0-9]{8}$/,
    help: 'On your FURS tax card.',
  },
  Luxembourg: {
    label: 'Matricule (national ID)',
    short: 'Matricule',
    example: '1985010112345',
    format: '13 digits',
    pattern: /^[0-9]{13}$/,
    help: 'On your Luxembourg ID card or social security card.',
  },
  Malta: {
    label: 'Tax number or ID card number',
    short: 'Tax no.',
    example: '123456M',
    format: '6 or 7 digits followed by a letter',
    help: 'On your Maltese identity card, or any CFR correspondence.',
  },
  Cyprus: {
    label: 'TIC (Tax Identification Code)',
    short: 'TIC',
    example: '12345678A',
    format: '8 digits followed by a letter',
    pattern: /^[0-9]{8}[A-Z]$/,
    help: 'On your Cyprus Tax Department registration.',
  },
  Iceland: {
    label: 'Kennitala',
    short: 'Kennitala',
    localName: 'Kennitala',
    example: '010185-1234',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your Icelandic ID or any Skatturinn document.',
  },
  Albania: {
    label: 'NIPT or ID number',
    short: 'NIPT',
    example: 'K12345678A',
    format: 'A letter, 8 digits, then a letter',
    help: 'On your General Directorate of Taxation registration.',
  },
  'Bosnia and Herzegovina': {
    label: 'JMB (unique citizen number)',
    short: 'JMB',
    example: '0101985123456',
    format: '13 digits',
    pattern: /^[0-9]{13}$/,
    help: 'On your BiH identity card.',
  },
  'North Macedonia': {
    label: 'EMBG',
    short: 'EMBG',
    example: '0101985123456',
    format: '13 digits',
    pattern: /^[0-9]{13}$/,
    help: 'On your Macedonian identity card.',
  },
  Montenegro: {
    label: 'JMBG',
    short: 'JMBG',
    example: '0101985123456',
    format: '13 digits',
    pattern: /^[0-9]{13}$/,
    help: 'On your Montenegrin identity card.',
  },
  Kosovo: {
    label: 'Personal number',
    short: 'Personal no.',
    example: '1234567890',
    format: '10 digits',
    pattern: /^[0-9]{10}$/,
    help: 'On your Kosovo identity card.',
  },
  Moldova: {
    label: 'IDNP',
    short: 'IDNP',
    localName: 'Numărul de identificare de stat',
    example: '1234567890123',
    format: '13 digits',
    pattern: /^[0-9]{13}$/,
    help: 'On your Moldovan identity card.',
  },
  Belarus: {
    label: 'UNP (УНП)',
    short: 'UNP',
    example: '123456789',
    format: '9 digits',
    pattern: /^[0-9]{9}$/,
    help: 'On your Ministry of Taxes and Duties registration.',
  },
  Andorra: {
    label: 'NRT',
    short: 'NRT',
    localName: 'Número de Registre Tributari',
    example: 'F-123456-A',
    format: 'A letter, 6 digits, then a letter',
    help: 'On your Departament de Tributs i de Fronteres registration.',
  },
  Liechtenstein: {
    label: 'PEID (personal ID)',
    short: 'PEID',
    example: '1234567',
    format: 'Up to 12 digits',
    help: 'On your Steuerverwaltung correspondence.',
  },
  'San Marino': {
    label: 'COE or ISS number',
    short: 'COE',
    example: 'SM12345',
    format: 'Length varies',
    help: 'On your Ufficio Tributario registration.',
  },
};

// ── Americas ──────────────────────────────────────────────────────────────
const AMERICAS: Record<string, CountryTaxId> = {
  Canada: {
    label: 'SIN (Social Insurance Number)',
    short: 'SIN',
    example: '123 456 789',
    format: '9 digits',
    pattern: /^[0-9]{9}$/,
    help: 'On your CRA Notice of Assessment or your SIN letter.',
  },
  Mexico: {
    label: 'RFC',
    short: 'RFC',
    localName: 'Registro Federal de Contribuyentes',
    example: 'GODE850101ABC',
    format: '13 characters for individuals: 4 letters, 6 digits, 3 alphanumeric',
    pattern: /^[A-Z]{4}[0-9]{6}[A-Z0-9]{3}$/,
    help: 'On your SAT constancia de situación fiscal.',
  },
  Brazil: {
    label: 'CPF',
    short: 'CPF',
    localName: 'Cadastro de Pessoas Físicas',
    example: '123.456.789-09',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help: 'On your CPF card, or any Receita Federal document.',
  },
  Argentina: {
    label: 'CUIT / CUIL',
    short: 'CUIT',
    localName: 'Clave Única de Identificación Tributaria',
    example: '20-12345678-9',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help: 'On your AFIP/ARCA constancia de inscripción.',
  },
  Chile: {
    label: 'RUT',
    short: 'RUT',
    localName: 'Rol Único Tributario',
    example: '12.345.678-5',
    format: '8 digits plus a check character (a digit or K)',
    pattern: /^[0-9]{7,8}[0-9K]$/,
    help: 'On your cédula de identidad.',
  },
  Colombia: {
    label: 'NIT or Cédula',
    short: 'NIT',
    localName: 'Número de Identificación Tributaria',
    example: '1.234.567.890',
    format: '8 to 11 digits',
    help: 'On your DIAN RUT certificate.',
  },
  Peru: {
    label: 'RUC',
    short: 'RUC',
    localName: 'Registro Único de Contribuyentes',
    example: '10123456789',
    format: '11 digits',
    pattern: /^[0-9]{11}$/,
    help: 'On your SUNAT ficha RUC.',
  },
  Ecuador: {
    label: 'RUC or Cédula',
    short: 'RUC',
    example: '1712345678001',
    format: '13 digits for RUC, 10 for cédula',
    help: 'On your SRI registration.',
  },
  Uruguay: {
    label: 'RUT or Cédula',
    short: 'RUT',
    example: '123456789012',
    format: '12 digits for RUT',
    help: 'On your DGI registration.',
  },
  Venezuela: {
    label: 'RIF',
    short: 'RIF',
    localName: 'Registro de Información Fiscal',
    example: 'V-12345678-9',
    format: 'A letter, then 8 digits, then a check digit',
    help: 'On your SENIAT RIF certificate.',
  },
  Bahamas: {
    label: 'Passport number',
    short: 'Passport',
    issues: false,
    alt: 'passport number',
    help: 'The Bahamas does not issue personal tax identification numbers. Enter your passport number.',
  },
  'Saint Kitts and Nevis': {
    label: 'Passport number',
    short: 'Passport',
    issues: false,
    alt: 'passport number',
    help: 'Saint Kitts and Nevis does not issue personal tax identification numbers. Enter your passport number.',
  },

  // ── Caribbean and Atlantic offshore jurisdictions ────────────────────────
  //
  // These four arrived with the territories added to CountrySelect, and they
  // matter out of all proportion to their population: the Cayman Islands and
  // the British Virgin Islands are the two commonest jurisdictions for an
  // ADDITIONAL related party on these returns, and Bermuda is not far behind.
  // Until they were listed, such a party could not even be given a country.
  //
  // Bermuda, the British Virgin Islands and the Cayman Islands are the three
  // relevant names on the IRS's own "List of jurisdictions that do not issue
  // foreign TINs" (last updated 16 August 2025). Note that list also carries
  // Australia and Japan, which DO issue tax IDs and appear only because their
  // law restricts disclosure, and note that the list governs the Foreign TIN a
  // withholding agent must collect on a Form W-8, not Form 5472 line 4b. So it
  // is used here only as corroboration that these three issue nothing. Do not
  // "complete" this by importing Australia and Japan: it would be a different
  // rule wearing the same words.
  'Cayman Islands': {
    label: 'Passport number',
    short: 'Passport',
    issues: false,
    alt: 'passport number',
    help: 'The Cayman Islands levies no income tax and issues no tax identification numbers. Enter your passport number.',
  },
  'British Virgin Islands': {
    label: 'Passport number',
    short: 'Passport',
    issues: false,
    alt: 'passport number',
    help: 'The British Virgin Islands issues no tax identification numbers or equivalent. Enter your passport number.',
  },
  Bermuda: {
    label: 'Passport number',
    short: 'Passport',
    issues: false,
    alt: 'passport number',
    help: 'Bermuda issues no personal tax identification number. Enter your passport number.',
  },
  Anguilla: {
    label: 'Passport number',
    short: 'Passport',
    issues: false,
    alt: 'passport number',
    help: 'Anguilla levies no income tax and issues no personal tax identification numbers. Enter your passport number.',
  },
  'Turks and Caicos Islands': {
    label: 'Passport number',
    short: 'Passport',
    issues: false,
    alt: 'passport number',
    help: 'The Turks and Caicos Islands levies no income tax and issues no personal tax identification numbers. Enter your passport number.',
  },

  // NO US TERRITORIES HERE, AND NONE IN CountrySelect EITHER
  //
  // Puerto Rico, Guam, the US Virgin Islands, the Northern Mariana Islands and
  // American Samoa were briefly added alongside the offshore jurisdictions
  // above, and that was wrong. A bona fide resident of the first four is a US
  // citizen and an American Samoan is a US national, so all of them are United
  // States persons under section 7701(a)(30). If the LLC's single member is a
  // US person then it is not a foreign-owned disregarded entity and the
  // section 1.6038A-1 obligation this product exists to discharge does not
  // arise at all.
  //
  // Offering them as a country of tax residence would therefore not merely
  // mislabel a number, it would invite a filer to produce a return they should
  // not be filing, and would print a US person into Part II as the 25% FOREIGN
  // shareholder. Anyone in a territory who genuinely belongs on one of these
  // forms is a US person and answers "United States".
  'Costa Rica': {
    label: 'Cédula or NITE',
    short: 'Cédula',
    example: '1-2345-6789',
    format: '9 digits for a national cédula',
    help: 'On your cédula de identidad, or your Ministerio de Hacienda registration.',
  },
  Panama: {
    label: 'RUC or Cédula',
    short: 'RUC',
    example: '8-123-4567',
    format: 'Individuals use their cédula as the RUC',
    help: 'On your cédula de identidad personal.',
  },
  Guatemala: {
    label: 'NIT',
    short: 'NIT',
    localName: 'Número de Identificación Tributaria',
    example: '1234567-8',
    format: '7 to 8 digits plus a check character',
    help: 'On your SAT registration.',
  },
  'Dominican Republic': {
    label: 'RNC or Cédula',
    short: 'RNC',
    example: '001-1234567-8',
    format: 'Cédula is 11 digits; RNC is 9',
    help: 'On your cédula, or your DGII registration.',
  },
  Bolivia: {
    label: 'NIT',
    short: 'NIT',
    example: '1234567890',
    format: 'Length varies',
    help: 'On your Servicio de Impuestos Nacionales registration.',
  },
  Paraguay: {
    label: 'RUC',
    short: 'RUC',
    example: '1234567-8',
    format: 'Cédula number plus a check digit',
    help: 'On your SET registration.',
  },
  Honduras: {
    label: 'RTN',
    short: 'RTN',
    localName: 'Registro Tributario Nacional',
    example: '08011985123456',
    format: '14 digits',
    pattern: /^[0-9]{14}$/,
    help: 'On your SAR registration.',
  },
  'El Salvador': {
    label: 'NIT or DUI',
    short: 'NIT',
    example: '0614-123456-123-4',
    format: 'NIT is 14 digits; DUI is 9',
    help: 'On your DUI card, or your Ministerio de Hacienda registration.',
  },
  Nicaragua: {
    label: 'RUC or Cédula',
    short: 'RUC',
    example: '001-010185-1234A',
    format: 'Cédula is 14 characters',
    help: 'On your cédula de identidad.',
  },
  Jamaica: {
    label: 'TRN (Taxpayer Registration Number)',
    short: 'TRN',
    example: '123-456-789',
    format: '9 digits',
    pattern: /^[0-9]{9}$/,
    help: 'On your TRN card.',
  },
  'Trinidad and Tobago': {
    label: 'BIR number',
    short: 'BIR',
    example: '123456789012',
    format: '12 digits',
    pattern: /^[0-9]{12}$/,
    help: 'On your Board of Inland Revenue registration.',
  },
  Barbados: {
    label: 'TIN',
    short: 'TIN',
    example: '1234567890123',
    format: 'Length varies',
    help: 'On your Barbados Revenue Authority registration.',
  },
  Belize: {
    label: 'TIN',
    short: 'TIN',
    example: '123456-1',
    format: '6 digits plus a check digit',
    help: 'On your Belize Tax Service registration.',
  },
  'Antigua and Barbuda': {
    label: 'Passport number',
    short: 'Passport',
    issues: false,
    alt: 'passport number',
    help: 'Antigua and Barbuda abolished personal income tax and issues individuals no tax ID. Enter your passport number.',
  },
};

// ── Asia-Pacific ──────────────────────────────────────────────────────────
const ASIA_PACIFIC: Record<string, CountryTaxId> = {
  Singapore: {
    label: 'NRIC or FIN',
    short: 'NRIC / FIN',
    example: 'S1234567D',
    format: 'A letter (S, T, F, G or M), 7 digits, then a check letter',
    pattern: /^[STFGM][0-9]{7}[A-Z]$/,
    help: 'On your NRIC card or your employment pass.',
  },
  Malaysia: {
    label: 'TIN (Nombor Cukai Pendapatan)',
    short: 'TIN',
    localName: 'Nombor Cukai Pendapatan',
    example: 'IG12345678901',
    format: 'A prefix (IG, SG or OG) followed by digits',
    help: 'On your LHDN e-Filing profile or any LHDN notice.',
  },
  Indonesia: {
    label: 'NPWP',
    short: 'NPWP',
    localName: 'Nomor Pokok Wajib Pajak',
    example: '12.345.678.9-012.345',
    format: '15 digits (the newer 16-digit NIK-based number is also accepted)',
    help: 'On your NPWP card, or in DJP Online.',
  },
  Philippines: {
    label: 'TIN',
    short: 'TIN',
    example: '123-456-789-000',
    format: '9 digits, sometimes with a 3 or 5 digit branch code',
    help: 'On your BIR Form 2303 or your TIN card.',
  },
  Thailand: {
    label: 'TIN',
    short: 'TIN',
    example: '1234567890123',
    format: '13 digits',
    pattern: /^[0-9]{13}$/,
    help: 'Your Thai national ID number doubles as the TIN.',
  },
  Vietnam: {
    label: 'MST (tax code)',
    short: 'MST',
    localName: 'Mã số thuế',
    example: '1234567890',
    format: '10 digits, or 13 with a branch suffix',
    help: 'On your tax registration certificate.',
  },
  China: {
    label: 'National ID number',
    short: 'ID number',
    localName: '居民身份证号码',
    example: '11010119850101123X',
    format: '18 characters: 17 digits, then a digit or X',
    pattern: /^[0-9]{17}[0-9X]$/,
    help: 'On your resident identity card. China uses it as the TIN for individuals.',
  },
  'Hong Kong': {
    label: 'HKID number',
    short: 'HKID',
    example: 'A123456(7)',
    format: '1 or 2 letters, 6 digits, then a check character in brackets',
    help: 'On your Hong Kong identity card.',
  },
  Taiwan: {
    label: 'National ID number',
    short: 'ID number',
    example: 'A123456789',
    format: 'A letter followed by 9 digits',
    pattern: /^[A-Z][0-9]{9}$/,
    help: 'On your national identification card.',
  },
  Japan: {
    label: 'My Number',
    short: 'My Number',
    localName: 'マイナンバー',
    example: '1234 5678 9012',
    format: '12 digits',
    pattern: /^[0-9]{12}$/,
    help: 'On your My Number card or notification card.',
  },
  'South Korea': {
    label: 'Resident Registration Number',
    short: 'RRN',
    localName: '주민등록번호',
    example: '850101-1234567',
    format: '13 digits',
    pattern: /^[0-9]{13}$/,
    help: 'On your resident registration card.',
  },
  Australia: {
    label: 'TFN (Tax File Number)',
    short: 'TFN',
    example: '123 456 789',
    format: '8 or 9 digits',
    pattern: /^[0-9]{8,9}$/,
    help: 'On your ATO notice of assessment, or in myGov.',
  },
  'New Zealand': {
    label: 'IRD number',
    short: 'IRD',
    example: '123-456-789',
    format: '8 or 9 digits',
    pattern: /^[0-9]{8,9}$/,
    help: 'On any Inland Revenue letter, or in myIR.',
  },
  Vanuatu: {
    label: 'Passport number',
    short: 'Passport',
    issues: false,
    alt: 'passport number',
    help: 'Vanuatu does not issue personal tax identification numbers. Enter your passport number.',
  },
  Myanmar: {
    label: 'TIN',
    short: 'TIN',
    example: '123456789',
    format: '9 digits',
    help: 'On your Internal Revenue Department registration.',
  },
  Cambodia: {
    label: 'TIN',
    short: 'TIN',
    example: 'K001-1234567890',
    format: 'Alphanumeric, issued by the GDT',
    help: 'On your General Department of Taxation patent certificate.',
  },
  Laos: {
    label: 'TIN',
    short: 'TIN',
    example: '123456789',
    format: 'Length varies',
    help: 'On your Tax Department registration.',
  },
  Brunei: {
    label: 'Passport or IC number',
    short: 'Passport / IC',
    issues: false,
    alt: 'passport number',
    help: 'Brunei levies no personal income tax and issues individuals no tax ID. Enter your passport number or IC number.',
  },
  Fiji: {
    label: 'TIN',
    short: 'TIN',
    example: '12-34567-8-9',
    format: '9 digits',
    help: 'On your Fiji Revenue and Customs Service registration.',
  },
  'Papua New Guinea': {
    label: 'TIN',
    short: 'TIN',
    example: '123456789',
    format: '9 digits',
    help: 'On your Internal Revenue Commission registration.',
  },
  Samoa: {
    label: 'TIN',
    short: 'TIN',
    example: '12345678',
    format: 'Length varies',
    help: 'On your Ministry for Revenue registration.',
  },
  Nauru: {
    label: 'Passport number',
    short: 'Passport',
    issues: false,
    alt: 'passport number',
    help: 'Nauru issues individuals no tax identification number. Enter your passport number.',
  },
  'Marshall Islands': {
    label: 'Passport number',
    short: 'Passport',
    issues: false,
    alt: 'passport number',
    help: 'The Marshall Islands issues individuals no tax identification number. Enter your passport number.',
  },
};

/**
 * The full map, keyed by the exact `value` used in COUNTRIES (constants.ts).
 * Keys MUST match those strings, they are what the filing stores and what the
 * PDF writes.
 */
export const COUNTRY_TAX_IDS: Record<string, CountryTaxId> = {
  ...SOUTH_ASIA,
  ...MIDDLE_EAST,
  ...AFRICA,
  ...EUROPE,
  ...AMERICAS,
  ...ASIA_PACIFIC,
};

/** Shown when we have no entry for the selected country, or none is selected. */
export const GENERIC_TAX_ID: CountryTaxId = {
  label: 'Foreign tax ID',
  short: 'Foreign tax ID',
  help:
    'The tax identification number your country of residence issues you. If your country does ' +
    'not issue one, enter your passport number instead, which the IRS accepts here. Do not write ' +
    '"None": the box cannot be left without an identifier.',
};

/** Look up the guidance for a country of tax residence. Never returns null. */
export function taxIdInfoFor(country?: string | null): CountryTaxId {
  if (!country) return GENERIC_TAX_ID;
  return COUNTRY_TAX_IDS[country] ?? GENERIC_TAX_ID;
}

/** True when we know this jurisdiction issues individuals no tax ID at all. */
export function issuesNoTaxId(country?: string | null): boolean {
  return taxIdInfoFor(country).issues === false;
}

/**
 * Advisory only. Returns a sentence to show BESIDE the field, never an error
 * that blocks the step. See the file header for why this never hard-fails.
 */
export function taxIdWarning(country: string | null | undefined, value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const info = taxIdInfoFor(country);
  if (!info.pattern) return null;
  if (info.pattern.test(normalizeTaxId(raw))) return null;
  return `That does not look like a ${info.short}${info.format ? ` (${info.format.toLowerCase()})` : ''}. Check it, or continue if you are sure it is right.`;
}

/** Placeholder for the input: the country's own shape when we know it. */
export function taxIdPlaceholder(country?: string | null): string {
  const info = taxIdInfoFor(country);
  if (info.issues === false) return 'Passport number';
  return info.example ?? 'Local tax ID, or passport number';
}

/** Full tooltip text for the field, assembled from whatever the entry carries. */
export function taxIdTooltip(country?: string | null): string {
  const info = taxIdInfoFor(country);
  const parts: string[] = [];
  if (info.localName && info.localName !== info.label) parts.push(`Known locally as the ${info.localName}.`);
  if (info.format) parts.push(`${info.format}.`);
  if (info.help) parts.push(info.help);
  return parts.join(' ') || GENERIC_TAX_ID.help!;
}
