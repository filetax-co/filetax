// scripts/sanity-read.mjs
//
// Read-only authenticated queries against Sanity. Performs no mutations.
//
//   node scripts/sanity-read.mjs '<GROQ>'
//
// Authentication is needed only to see draft documents; the published dataset
// is public. The token is read from SANITY_WRITE_TOKEN, or failing that from
// the file named by SANITY_TOKEN_FILE, defaulting to the path below. It is used
// solely in the Authorization header: never logged, never echoed, never written
// anywhere. Errors are scrubbed so a failed request cannot surface it either.

import { readFileSync, existsSync } from 'node:fs';

const PROJECT_ID = 'alh0fv7m';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const DEFAULT_TOKEN_FILE = 'C:/Users/chira/OneDrive/Desktop/Sanity Token - Filetax.txt';

function loadToken() {
  if (process.env.SANITY_WRITE_TOKEN) return process.env.SANITY_WRITE_TOKEN.trim();
  const file = process.env.SANITY_TOKEN_FILE || DEFAULT_TOKEN_FILE;
  if (!existsSync(file)) return null;
  // Tolerate "SANITY_WRITE_TOKEN=sk..." or a bare token, with or without quotes.
  const raw = readFileSync(file, 'utf8').trim();
  const match = raw.match(/(sk[A-Za-z0-9]+)/);
  return match ? match[1] : raw.split(/\r?\n/)[0].replace(/^.*=/, '').replace(/['"]/g, '').trim();
}

export async function query(groq, { authenticated = true } = {}) {
  const token = authenticated ? loadToken() : null;
  // The live API (not apicdn) is required for drafts and for fresh reads.
  const host = `https://${PROJECT_ID}.api.sanity.io`;
  const url = `${host}/v${API_VERSION}/data/query/${DATASET}?query=${encodeURIComponent(groq)}`;
  const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  const text = await res.text();
  if (!res.ok) {
    // Scrub anything token-shaped before this reaches a log.
    throw new Error(`Sanity ${res.status}: ${text.replace(/sk[A-Za-z0-9]+/g, '<redacted>')}`);
  }
  return JSON.parse(text).result;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const groq = process.argv[2];
  if (!groq) {
    console.error("Usage: node scripts/sanity-read.mjs '<GROQ>'");
    process.exit(1);
  }
  query(groq)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
