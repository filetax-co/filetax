import { useEffect, useState, useMemo, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router';
import { supabase, Filing, Transaction, Address } from '../../lib/supabase';

// Categories supported by this wizard (subset of Transaction['transaction_type']).
// Mirrors the legacy FilingTransactionCategory list.
type WizardTxCategory =
  | 'capital_contribution'
  | 'distribution'
  | 'loan_to_llc'
  | 'loan_from_llc'
  | 'service_payment'
  | 'rent_royalty'
  | 'other';
import { assembleFilingPackage, EARLIEST_SUPPORTED_TAX_YEAR } from '../../lib/pdfGenerator';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';

const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
  'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
  'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
  'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire',
  'New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio',
  'Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota',
  'Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia',
  'Wisconsin','Wyoming',
];

const TX_CATEGORIES: { value: WizardTxCategory; label: string }[] = [
  { value: 'capital_contribution', label: 'Capital Contribution' },
  { value: 'distribution',         label: 'Distribution' },
  { value: 'loan_to_llc',          label: 'Loan to LLC' },
  { value: 'loan_from_llc',        label: 'Loan from LLC' },
  { value: 'service_payment',      label: 'Service Payment' },
  { value: 'rent_royalty',         label: 'Rent / Royalty / License' },
  { value: 'other',                label: 'Other' },
];

// Returns the current year in US Eastern Time (IRS jurisdiction).
// Handles EST (UTC-5) and EDT (UTC-4) automatically via America/New_York.
function getEasternYear(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
    }).format(new Date())
  );
}
const ET_YEAR = getEasternYear();
const CURRENT_TAX_YEAR = String(ET_YEAR - 1);
// Newest first. Range covers EARLIEST_SUPPORTED_TAX_YEAR (driven by the PDF
// resolver in pdfGenerator) through last completed calendar year.
const TAX_YEARS = (() => {
  const newest = Number(CURRENT_TAX_YEAR);
  const out: string[] = [];
  for (let y = newest; y >= EARLIEST_SUPPORTED_TAX_YEAR; y--) out.push(String(y));
  return out;
})();