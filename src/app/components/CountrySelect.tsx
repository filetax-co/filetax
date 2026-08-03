/**
 * CountrySelect, reusable searchable country <select> component.
 *
 * Usage:
 *   <CountrySelect
 *     value={ownerCountryRes}
 *     onChange={setOwnerCountryRes}
 *     label="Country of residence"
 *     id="owner-country-res"
 *   />
 *
 * The list uses standard English short-form country names recognised by the
 * IRS for Form 5472 purposes. The value stored is the full country name
 * (not an ISO code) so it can be written directly into PDF fields.
 *
 * TERRITORIES BELONG HERE, NOT JUST SOVEREIGN STATES
 *
 * The list held UN member states only, which left the owners and related parties
 * this product actually serves unable to say where they are: Hong Kong, Macau,
 * the Cayman Islands, the British Virgin Islands, Bermuda, Jersey, Guernsey and
 * the Isle of Man were all absent, and so was Cote d'Ivoire, a member state that
 * was simply missed. Cayman and the BVI are the two commonest jurisdictions for
 * an ADDITIONAL related party, which is the case this product is built around,
 * so the gap bit hardest exactly where it mattered most.
 *
 * Every name here is WinAnsi-encodable (see toFormText in pdfGenerator.ts), so
 * the accented ones print correctly instead of being stripped and reported back
 * to the filer as unsupported characters.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * US territories. Puerto Rico, Guam, the US Virgin Islands, the Northern
 * Mariana Islands and American Samoa are NOT here, and must not be added. A
 * bona fide resident of the first four is a US citizen and an American Samoan
 * is a US national, so every one of them is a United States person under
 * section 7701(a)(30). If the LLC's single member is a US person then it is not
 * a foreign-owned disregarded entity and no Form 5472 is due on that basis at
 * all. Listing them would invite a return that should not exist, and would put
 * a US person in Part II as the 25% FOREIGN shareholder. They answer "United
 * States".
 *
 * Places that are not their own tax jurisdiction. The French overseas
 * departments (Martinique, Guadeloupe, French Guiana, Mayotte, Réunion), the
 * Åland Islands and Norfolk Island are inside the tax system of France, Finland
 * and Australia respectively, so a resident's country of tax residence is the
 * parent state and that is what belongs on the form. The overseas collectivités
 * that DO levy their own tax — French Polynesia, New Caledonia, Wallis and
 * Futuna, Saint Pierre and Miquelon, Saint Barthélemy — are listed.
 *
 * KEEP IT ALPHABETICAL, and keep NO_POSTAL_CODE_COUNTRIES in Intake.tsx in step
 * with the names used here.
 *
 * ANYTHING STILL MISSING CAN BE TYPED
 *
 * No fixed list is ever complete, and absence from it used to mean being unable
 * to file at all: this is a <select>, so there was no way to enter a country it
 * did not offer. "Other, not listed" now reveals a free-text box. The value it
 * stores has the same shape as a picked one, so nothing downstream knows the
 * difference, and a future gap is an inconvenience rather than a wall.
 */

import React, { useEffect, useState } from 'react';

export const COUNTRIES: readonly string[] = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola',
  'Anguilla', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Aruba',
  'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain',
  'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize',
  'Benin', 'Bermuda', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina',
  'Botswana', 'Brazil', 'British Virgin Islands', 'Brunei', 'Bulgaria',
  'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon',
  'Canada', 'Caribbean Netherlands', 'Cayman Islands', 'Central African Republic', 'Chad',
  'Chile', 'China', 'Colombia', 'Comoros', 'Congo (Democratic Republic)',
  'Congo (Republic)', 'Cook Islands', 'Costa Rica', "Côte d'Ivoire", 'Croatia',
  'Cuba', 'Curaçao', 'Cyprus', 'Czech Republic', 'Denmark',
  'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt',
  'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini',
  'Ethiopia', 'Falkland Islands', 'Faroe Islands', 'Fiji', 'Finland',
  'France', 'French Polynesia', 'Gabon', 'Gambia', 'Georgia',
  'Germany', 'Ghana', 'Gibraltar', 'Greece', 'Greenland',
  'Grenada', 'Guatemala', 'Guernsey', 'Guinea', 'Guinea-Bissau',
  'Guyana', 'Haiti', 'Honduras', 'Hong Kong', 'Hungary',
  'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq',
  'Ireland', 'Isle of Man', 'Israel', 'Italy', 'Jamaica',
  'Japan', 'Jersey', 'Jordan', 'Kazakhstan', 'Kenya',
  'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos',
  'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya',
  'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macau', 'Madagascar',
  'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta',
  'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia',
  'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Montserrat',
  'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru',
  'Nepal', 'Netherlands', 'New Caledonia', 'New Zealand', 'Nicaragua',
  'Niger', 'Nigeria', 'Niue', 'North Korea', 'North Macedonia',
  'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine',
  'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines',
  'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia',
  'Rwanda', 'Saint Barthélemy', 'Saint Helena', 'Saint Kitts and Nevis', 'Saint Lucia',
  'Saint Martin', 'Saint Pierre and Miquelon', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino',
  'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles',
  'Sierra Leone', 'Singapore', 'Sint Maarten', 'Slovakia', 'Slovenia',
  'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan',
  'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden',
  'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania',
  'Thailand', 'Timor-Leste', 'Togo', 'Tokelau', 'Tonga',
  'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Turks and Caicos Islands',
  'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom',
  'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City',
  'Venezuela', 'Vietnam', 'Wallis and Futuna', 'Yemen', 'Zambia',
  'Zimbabwe',
] as const;

interface CountrySelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  style?: React.CSSProperties;
}

/**
 * Sentinel for the "not listed" option. Never stored: picking it clears the
 * value and reveals the text box, and what the filer types is stored instead.
 * Prefixed and suffixed so it can never collide with a real country name.
 */
const OTHER = '__other__';

export function CountrySelect({
  id,
  label,
  value,
  onChange,
  required = false,
  style,
}: CountrySelectProps) {
  // A value that is not in the list can only have come from the text box, so
  // the component reopens in free-text mode. This is what makes a saved filing
  // load back correctly: the filing is fetched after the first render, so the
  // initial state cannot see it and an effect has to catch it when it arrives.
  const [custom, setCustom] = useState(() => !!value && !COUNTRIES.includes(value));
  useEffect(() => {
    if (value && !COUNTRIES.includes(value)) setCustom(true);
  }, [value]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', ...style }}>
      <label
        htmlFor={id}
        style={{
          fontSize: '0.8125rem',
          fontWeight: 600,
          color: 'var(--tf-text)',
          letterSpacing: '0.01em',
        }}
      >
        {label}
      </label>
      <select
        id={id}
        value={custom ? OTHER : value}
        required={required && !custom}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER) {
            // Clear rather than keep the previously picked country, so the box
            // below starts empty and the filer cannot leave a stale answer
            // behind a control that no longer shows it.
            setCustom(true);
            onChange('');
          } else {
            setCustom(false);
            onChange(next);
          }
        }}
        style={{
          width: '100%',
          padding: '0.5625rem 0.75rem',
          fontSize: '0.9375rem',
          fontWeight: 400,
          color: custom || value ? 'var(--tf-text)' : 'var(--tf-muted)',
          background: 'var(--tf-bg)',
          border: '1px solid var(--tf-border)',
          borderRadius: '0.5rem',
          minHeight: '44px',
          cursor: 'pointer',
          appearance: 'auto',
        }}
      >
        <option value="">Select country…</option>
        {COUNTRIES.map((country) => (
          <option key={country} value={country}>
            {country}
          </option>
        ))}
        <option value={OTHER}>Other, not listed…</option>
      </select>

      {custom && (
        <input
          id={`${id}-custom`}
          type="text"
          value={value}
          required={required}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter the country or territory"
          aria-label={`${label}, not listed`}
          style={{
            width: '100%',
            padding: '0.5625rem 0.75rem',
            fontSize: '0.9375rem',
            fontWeight: 400,
            color: 'var(--tf-text)',
            background: 'var(--tf-bg)',
            border: '1px solid var(--tf-border)',
            borderRadius: '0.5rem',
            minHeight: '44px',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  );
}
