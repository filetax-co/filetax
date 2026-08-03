/**
 * Single source of truth for portal pricing.
 *
 *   • Base filing:             USD 99 per year (Form 5472 + pro forma 1120)
 *   • Reasonable-cause letter: USD 199 per JOB (one letter covers every year)
 *   • Additional related party: USD 25 per additional Form 5472, per year
 *   • IRS fax delivery:        USD 9 per JOB (opt-in; covers every transmission)
 *
 * These rates apply everywhere, the marketing pricing page, the eligibility
 * estimator, the dashboard, and the filing/checkout flow. Nothing should
 * hardcode a dollar figure; import from here so prices cannot drift again.
 *
 * Returning customers: the next two filings after the first are guaranteed at
 * the same USD 99 base. Counted in filings, not calendar years.
 *
 * NOTE: this file is duplicated in the product app repo (CNL 5472/5472) because
 * the two repos share no package. The copies must stay identical, if you change
 * a price here, change it there in the same commit.
 */

export const PRICE_PER_YEAR = 99;
/** One reasonable-cause letter covers every year in a job, charged once. */
export const PRICE_RCL = 199;
/** Each ADDITIONAL related party (each extra Form 5472), charged per year. */
export const PRICE_ADDITIONAL_PARTY = 25;
/** Opt-in IRS fax delivery, charged once per job however many years are sent. */
export const PRICE_FAX = 9;
/** Standalone Form 8832 classification-change filing. */
export const PRICE_CLASSIFICATION_CHANGE = 50;

/** Number of subsequent filings guaranteed at the same base price. */
export const RENEWAL_GUARANTEE_FILINGS = 2;

/* ─── What can actually be bought ──────────────────────────────────────────
 *
 * Availability used to be asserted page by page, in prose, and it was wrong in
 * both directions four separate times in two days: IRS fax was described as
 * unbuilt on four pages for weeks after it shipped, and Form 8832 was sold with
 * a "Start Filing" button into a portal that cannot do it. Each fix touched one
 * page and left the others, because there was no one place to change.
 *
 * Every surface that states whether something can be bought must read this map.
 * Shipping or unshipping a service is then one edit to one flag, and it cannot
 * be half done.
 *
 * `available` means a filer can get this TODAY, through the product, not that
 * the code exists. Form 7004 is the distinction: it generates, it ships inside
 * the package, so it is available even though it is not sold separately.
 */

export type ServiceId =
  | 'filing'
  | 'rcl'
  | 'additional_party'
  | 'fax'
  | 'form7004'
  | 'classification_change'
  | 'fbar'
  | 'wyoming_annual';

export interface Service {
  /** One canonical customer-facing name per service, used on every surface. */
  label: string;
  /** Standalone price, or null when the service carries no price of its own. */
  price: number | null;
  /** How that price is charged. Empty when there is no price. */
  priceNote: string;
  /** Can a filer get this today? */
  available: boolean;
  /** Can it be bought ON ITS OWN? A CTA may only be shaped like the start of a
   *  checkout when this is true, which is the rule item 64 settled. */
  standalone: boolean;
}

export const SERVICES: Record<ServiceId, Service> = {
  filing: {
    label: 'Form 5472 + pro forma 1120',
    price: PRICE_PER_YEAR,
    priceNote: 'per tax year',
    available: true,
    standalone: true,
  },
  rcl: {
    label: 'CPA-authored reasonable cause letter',
    price: PRICE_RCL,
    priceNote: 'once per job, however many late years',
    available: true,
    standalone: false,
  },
  additional_party: {
    label: 'Additional related party',
    price: PRICE_ADDITIONAL_PARTY,
    priceNote: 'per party, per year',
    available: true,
    standalone: false,
  },
  fax: {
    label: 'IRS fax transmission',
    price: PRICE_FAX,
    priceNote: 'once per job, however many years',
    available: true,
    standalone: false,
  },
  form7004: {
    // Generated, merged into the combined PDF and separately downloadable
    // whenever the filing opted into an extension or reported one. Included,
    // never charged, so it has no price rather than a price of zero.
    label: 'Form 7004 extension',
    price: null,
    priceNote: 'included with your filing',
    available: true,
    standalone: false,
  },
  classification_change: {
    // Priced, marketed, and NOT BUILT. Do not flip this without the flow.
    label: 'LLC tax classification change (Form 8832)',
    price: PRICE_CLASSIFICATION_CHANGE,
    priceNote: 'per filing',
    available: false,
    standalone: true,
  },
  fbar: {
    label: 'FBAR',
    price: null,
    priceNote: '',
    available: false,
    standalone: true,
  },
  wyoming_annual: {
    // Marketed on Home and Services as coming soon since before this map
    // existed, and it was the one service named on a page with no entry here.
    // Delaware and New Mexico were deliberately dropped from that list: a
    // Delaware LLC pays a $300 franchise tax rather than filing a report, and
    // New Mexico has no annual or biennial report at all.
    label: 'Annual report for Wyoming',
    price: null,
    priceNote: '',
    available: false,
    standalone: true,
  },
};

/**
 * The waitlist only makes sense for things a filer cannot get yet. Collecting
 * an email address for a service that is already buyable tells that filer to
 * wait for something sitting behind the button they just walked past.
 */
export function waitlistServices(): { id: ServiceId; service: Service }[] {
  return (Object.keys(SERVICES) as ServiceId[])
    .filter((id) => !SERVICES[id].available)
    .map((id) => ({ id, service: SERVICES[id] }));
}

/** Services a filer cannot get yet. The only honest source for a "coming soon" list. */
export function unavailableServices(): Service[] {
  return Object.values(SERVICES).filter((s) => !s.available);
}

/** "LLC tax classification change (Form 8832), $50" for a coming-soon line. */
export function serviceWithPrice(s: Service): string {
  return s.price == null ? s.label : `${s.label}, $${s.price}`;
}

/** Cost of the additional Form 5472s beyond the first, for a single year. */
export function additionalPartiesCost(totalForms: number): number {
  const additional = Math.max(0, totalForms - 1);
  return additional * PRICE_ADDITIONAL_PARTY;
}

/**
 * Total price for a filing job.
 * @param years      number of tax years being filed
 * @param includeRCL whether a reasonable-cause letter is included (one per job)
 * @param totalForms total number of Forms 5472 per year (1 owner + related parties)
 * @param includeFax whether IRS fax delivery is added (one fee per job)
 */
export function computeTotal(
  years: number,
  includeRCL: boolean,
  totalForms = 1,
  includeFax = false,
): number {
  const base = years * PRICE_PER_YEAR;
  // One letter covers every year in the job, so it is never multiplied by years.
  const rcl = includeRCL ? PRICE_RCL : 0;
  // The additional-party add-on applies once per additional party, per year.
  const parties = years * additionalPartiesCost(totalForms);
  // Fax is a single delivery fee for the whole job, not per transmission.
  const fax = includeFax ? PRICE_FAX : 0;
  return base + rcl + parties + fax;
}

/** Human-readable breakdown for the additional-party add-on, for one year. */
export function additionalPartiesBreakdown(totalForms: number): string {
  const additional = Math.max(0, totalForms - 1);
  if (additional === 0) return '';
  const cost = additionalPartiesCost(totalForms);
  return `${additional} additional related part${additional > 1 ? 'ies' : 'y'} at $${PRICE_ADDITIONAL_PARTY} each per year = +$${cost} per year.`;
}

/** Total additional-party cost across every year in a job. */
export function additionalPartiesTotal(totalForms: number, years: number): number {
  return years * additionalPartiesCost(totalForms);
}
