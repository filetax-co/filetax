#!/usr/bin/env bash
# Downloads the official IRS AcroForm PDFs into public/pdf/
# Run once from the repo root: bash scripts/download-irs-pdfs.sh

set -e
mkdir -p public/pdf

echo "Downloading f5472.pdf…"
curl -fL --retry 3 \
  "https://www.irs.gov/pub/irs-pdf/f5472.pdf" \
  -o public/pdf/f5472.pdf
echo "  ✓ public/pdf/f5472.pdf"

echo "Downloading f1120.pdf…"
curl -fL --retry 3 \
  "https://www.irs.gov/pub/irs-pdf/f1120.pdf" \
  -o public/pdf/f1120.pdf
echo "  ✓ public/pdf/f1120.pdf"

echo "Done. Commit both files before deploying."
