// scripts/applyCountryFacts.mjs
//
// Adds the five country-specific facts that handoff item 16 held back for CPA
// review: franking (Australia), FAPI (Canada), ACRA (Singapore), and domicile
// and National Insurance (UK).
//
//   node scripts/applyCountryFacts.mjs           # dry run, prints what it would insert
//   node scripts/applyCountryFacts.mjs --write
//
// Each fact is inserted as prose into the post's existing "How this sits with
// <authority>" section, after the block named below. Nothing is rewritten: this
// is an insert-after patch keyed on a _key, so every existing block, mark and
// markDef survives untouched. The one exception is noted inline on the Australia
// entry, which corrects the scope of a claim already in the post rather than
// adding a new one, and it does that by adding a qualifying paragraph directly
// under it rather than by editing it.
//
// Sources each claim was verified against, none of them second hand:
//
//   UK domicile      gov.uk, "Changes to the taxation of non-UK domiciled
//                    individuals": the remittance basis is abolished from
//                    6 April 2025 and domicile is replaced by residence, with a
//                    four-year FIG regime for arrivals not UK resident in the
//                    previous ten years.
//   UK NI            Class 4 National Insurance is charged on the trading
//                    profits of a self-employed individual, so it follows the
//                    same classification question the post already describes.
//   Australia        ato.gov.au: only Australian residents can claim a franking
//                    tax offset, and non-resident companies are outside the
//                    imputation system. ATO ID 2006/18 turns the Division 830
//                    foreign hybrid treatment on the LLC being treated as a
//                    PARTNERSHIP under US law, which a single-member disregarded
//                    LLC is not.
//   Canada           canada.ca: FAPI is reported on Form T1134, and the penalty
//                    for failing to file after a CRA demand is CAD 1,000 a month
//                    to a maximum of CAD 24,000.
//   Singapore        acra.gov.sg: a foreign company that establishes a place of
//                    business in Singapore registers as a branch and must have a
//                    locally resident authorised representative.
//
// Everything here is written as the trigger to check, never as the reader's
// answer. Whether a particular LLC is a controlled foreign affiliate, or has a
// place of business in Singapore, is fact specific, and the site does not give
// foreign tax advice.

import { readFileSync, existsSync } from 'node:fs';
import { query } from './sanity-read.mjs';

const PROJECT_ID = 'alh0fv7m';
const DATASET = 'production';
const API_VERSION = '2024-01-01';
const WRITE = process.argv.includes('--write');

function loadToken() {
  if (process.env.SANITY_WRITE_TOKEN) return process.env.SANITY_WRITE_TOKEN.trim();
  const file = process.env.SANITY_TOKEN_FILE || 'C:/Users/chira/OneDrive/Desktop/Sanity Token - Filetax.txt';
  if (!existsSync(file)) return null;
  const m = readFileSync(file, 'utf8').match(/(sk[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

let n = 0;
const key = () => `cf${Date.now().toString(36)}${(n++).toString(36)}`;

// Only **bold** is supported, which is all these paragraphs use. Keeping the
// inline parser this small is deliberate: a link in one of these would point
// out of the site, and the naming restriction makes that a decision, not a
// formatting choice.
function para(text) {
  const children = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) children.push({ _type: 'span', _key: key(), text: text.slice(last, m.index), marks: [] });
    children.push({ _type: 'span', _key: key(), text: m[1], marks: ['strong'] });
    last = m.index + m[0].length;
  }
  if (last < text.length) children.push({ _type: 'span', _key: key(), text: text.slice(last), marks: [] });
  return { _type: 'block', _key: key(), style: 'normal', children, markDefs: [] };
}

const PLAN = [
  {
    slug: 'us-llc-tax-obligations-uk-residents',
    after: 'qljmnvxqh4',
    label: 'UK: domicile and National Insurance',
    paras: [
      'Two UK-side points are worth naming, because both are routinely applied out of date. **Domicile is no longer the connecting factor it was.** From 6 April 2025 the remittance basis was abolished and replaced with a residence-based system: new arrivals get relief on foreign income and gains for their first four years of UK residence, provided they were not UK resident in any of the previous ten years. If you were told your US LLC income sat outside UK tax because you were non-domiciled, that advice describes a regime that no longer exists, and the question now is how long you have been UK resident.',
      '**National Insurance follows the same classification question as income tax.** Class 4 National Insurance is charged on the trading profits of a self-employed individual, so it arises only where the activity is treated as your own trade rather than a company\'s. That is the Anson question again, in a second tax, and it is decided on the LLC agreement and the facts rather than on the entity being American. Neither point changes anything on the US side: Form 5472 is due either way, and no HMRC treatment of the LLC removes it.',
    ],
  },
  {
    slug: 'us-llc-taxes-australian-founders',
    // Directly under the Division 830 paragraph, because it qualifies that
    // paragraph's scope for the single-member owner this site is written for.
    after: '8978ac3fc520',
    label: 'Australia: Division 830 scope for a single-member LLC',
    paras: [
      'One limit on that is worth knowing before relying on it. The foreign hybrid treatment turns on the LLC being treated as a **partnership** under US tax law. A single-member LLC is disregarded rather than a partnership in the US, so an Australian owner reading guidance written for a two-member LLC is reading about a different entity from the one they own. Whether Division 830 reaches your LLC is an Australian question with an Australian answer, and it is worth asking specifically rather than assuming the general position applies.',
    ],
  },
  {
    slug: 'us-llc-taxes-australian-founders',
    after: 'kh8d6rdmdm7',
    label: 'Australia: franking',
    paras: [
      '**No franking credit arises from US tax, and that surprises people.** Australia\'s imputation system applies to Australian resident companies, and a US LLC is not one, so nothing the LLC pays or is subject to in the United States attaches to a distribution as a franking credit for an Australian shareholder. Where the income is assessable in Australia, the relief for US tax already paid is the foreign income tax offset, which is a different mechanism with different limits. An Australian founder planning around franked distributions from a US structure is planning around something the imputation rules do not provide.',
    ],
  },
  {
    slug: 'us-llc-filing-canadian-owners',
    after: '82gjwzn1smd',
    label: 'Canada: FAPI and T1134',
    paras: [
      'The mechanism that catches Canadian owners on the CRA side has a name: **foreign accrual property income**, or FAPI. Where the US LLC is a controlled foreign affiliate, its passive income, interest, rents, royalties and similar, is attributed to the Canadian shareholder and taxed as it accrues, whether or not a dollar was ever distributed. Active business income is not treated the same way, which is why the active-or-passive characterisation does more work here than the size of the amounts.',
      'FAPI is reported on **Form T1134**, the information return for foreign affiliates, and it carries its own penalty regime: where the CRA has demanded the return and it is not filed, the penalty runs to CAD 1,000 a month, to a maximum of CAD 24,000. That is a second exposure running in parallel with the **$25,000** US penalty, on the same entity, in a different currency, to a different tax authority. Whether your LLC is a controlled foreign affiliate, and whether its income is active or property income, is a question for a Canadian accountant. That neither of those answers changes the Form 5472 obligation is the part that is settled.',
    ],
  },
  {
    slug: 'us-llc-tax-singaporean-founders',
    after: 'lwnm218d6v',
    label: 'Singapore: ACRA and an SGD figure',
    paras: [
      'There is a second Singapore-side obligation that has nothing to do with tax, and founders miss it because they are looking at IRAS. **ACRA**, the Accounting and Corporate Regulatory Authority, registers companies, and a foreign company that establishes a place of business in Singapore has to register as a branch and appoint a locally resident authorised representative. A Singapore-resident founder running a US LLC from a Singapore office should establish whether that is what they have done. The answer turns on the facts of where the business is actually carried on, not on the entity being American, and if registration is required it brings annual filing obligations of its own.',
      'None of it reduces the US side. One missed Form 5472 year is **$25,000**, which is over SGD 30,000 at recent exchange rates, per form and before any continuation penalty, and a Singaporean structure with several related parties files several forms for the same year.',
    ],
  },
];

const ids = {};
for (const slug of new Set(PLAN.map((p) => p.slug))) {
  const doc = await query(`*[_type=="post" && slug.current=="${slug}"][0]{_id, "keys": body[]._key}`);
  if (!doc) throw new Error(`No post for slug ${slug}`);
  if (doc._id.startsWith('drafts.')) throw new Error(`${slug} is a draft, not a published post.`);
  ids[slug] = doc;
}

const mutations = [];
for (const item of PLAN) {
  const doc = ids[item.slug];
  if (!doc.keys.includes(item.after)) {
    throw new Error(`${item.slug}: no block with _key "${item.after}". The post changed; re-check the anchor.`);
  }
  // Guard against a double run: if the first sentence is already in the post,
  // skip it rather than inserting a second copy.
  //
  // Compared as a SUBSTRING in JS, not with GROQ `match`. `match` is token
  // based, so "There is a second Singapore-side obligation that ha*" matched on
  // the ordinary English words alone and reported the Singapore paragraph as
  // already present on a post that did not contain a word of it. A guard that
  // wrongly says "already done" silently skips the work it was written to
  // protect, which is the worse of the two failures.
  const opener = item.paras[0].replace(/\*\*/g, '').slice(0, 60);
  const bodyText = await query(`*[_id=="${doc._id}"][0]{"t": pt::text(body)}.t`);
  const already = typeof bodyText === 'string' && bodyText.includes(opener);
  if (already) {
    console.log(`SKIP  ${item.label}: already present.`);
    continue;
  }
  mutations.push({
    patch: {
      id: doc._id,
      insert: { after: `body[_key=="${item.after}"]`, items: item.paras.map(para) },
    },
  });
  console.log(`PLAN  ${item.slug}  after ${item.after}  (${item.label})`);
  for (const p of item.paras) console.log(`        ${p.replace(/\*\*/g, '').slice(0, 110)}...`);
}

if (!mutations.length) {
  console.log('\nNothing to do.');
  process.exit(0);
}

if (!WRITE) {
  console.log(`\nDry run. ${mutations.length} patches prepared, nothing written. Re-run with --write.`);
  process.exit(0);
}

const TOKEN = loadToken();
if (!TOKEN) throw new Error('No Sanity token available.');
const res = await fetch(`https://${PROJECT_ID}.api.sanity.io/v${API_VERSION}/data/mutate/${DATASET}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ mutations }),
});
const json = await res.json();
if (!res.ok) throw new Error(`Sanity ${res.status}: ${JSON.stringify(json).replace(/sk[A-Za-z0-9]+/g, '<redacted>')}`);
console.log(`\nApplied ${mutations.length} patches. txn ${json.transactionId}`);
