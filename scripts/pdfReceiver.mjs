/**
 * pdfReceiver - a throwaway local endpoint that catches PDFs the browser
 * downloads during an end-to-end run and writes them to disk.
 *
 *   node scripts/pdfReceiver.mjs [outDir] [port]
 *
 * The app delivers its package with a blob URL and an <a download> click. In a
 * driven browser that file lands wherever the browser decides, which is no use
 * for checking it afterwards. The page-side hook (installed by the test driver)
 * intercepts those clicks, reads the blob back, and POSTs it here instead - so
 * the bytes captured are exactly the bytes a real user receives.
 */
import http from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? path.resolve(here, '../../../Testing/outBrowser');
const port = Number(process.argv[3] ?? 5199);

await mkdir(outDir, { recursive: true });
const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, '-').replace(/\.\./g, '.').trim();

let count = 0;
http.createServer(async (req, res) => {
  // The page is served from :5174, so every POST here is cross-origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(200); return res.end('pdfReceiver up'); }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const name = safe(decodeURIComponent(req.headers['x-filename'] ?? `download-${Date.now()}.pdf`));
  const tag = safe(decodeURIComponent(req.headers['x-scenario'] ?? 'na'));
  const file = path.join(outDir, `${tag}__${name}`);
  await writeFile(file, body);
  count++;
  console.log(`saved [${count}] ${path.basename(file)}  ${body.length} bytes`);
  res.writeHead(200); res.end('ok');
}).listen(port, () => console.log(`pdfReceiver listening on :${port} → ${outDir}`));
