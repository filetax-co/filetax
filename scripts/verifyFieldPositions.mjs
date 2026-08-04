/**
 * Every Part IV field must sit where its line number says it sits.
 *
 * WHY THIS EXISTS
 *
 * `LINE_9_SALES_RECEIVED` was mapped to the AcroForm field 'StockPurchase' and
 * `LINE_23_SALES_PAID` to 'StockSales'. Both names exist, both fields are real,
 * and both accept a number, so nothing failed: a sale of stock in trade was
 * simply printed on line 23, "Purchases of stock in trade", and the return went
 * out saying the reporting corporation had bought inventory from the related
 * party when it had sold it.
 *
 * No existing check could catch that. The typecheck sees two valid strings. The
 * PDF-field audit sees two names that exist in the template. The output
 * regressions assert on the aggregated TOTALS, which were right, because the
 * money was counted correctly and only placed in the wrong box. The bug is
 * invisible to anything that does not know where on the page a field is drawn.
 *
 * So this reads the widget rectangles out of the template and asserts that the
 * fields descend the page in the same order as the line numbers. A field mapped
 * to the wrong line lands out of sequence and fails here.
 *
 * The names are NOT evidence of anything. The IRS named lines 9 and 23 from the
 * related party's side of the transaction, so 'StockSales' really does belong
 * on line 9, "Sales of stock in trade". Geometry is the only reliable check.
 */

import { PDFDocument } from 'pdf-lib';
import { readFileSync, existsSync } from 'node:fs';

const SRC = 'src/lib/form5472Fields.ts';

// Part IV, top to bottom. 17a/17b and 31a/31b share a row, so equal y is fine.
const LINE_ORDER = [
  'LINE_9_SALES_RECEIVED', 'LINE_10_TANGIBLE_PROP_RECEIVED',
  'LINE_11_PCT_PAYMENTS_RECEIVED', 'LINE_12_CST_PAYMENTS_RECEIVED',
  'LINE_13A_RENTS_RECEIVED', 'LINE_13B_ROYALTIES_RECEIVED',
  'LINE_14_INTANGIBLE_RECEIVED', 'LINE_15_SERVICES_RECEIVED',
  'LINE_16_COMMISSIONS_RECEIVED', 'LINE_17A_BORROWED_BEGIN',
  'LINE_17B_BORROWED_END', 'LINE_18_INTEREST_RECEIVED',
  'LINE_19_INSURANCE_RECEIVED', 'LINE_20_LOAN_GUARANTEE_RECEIVED',
  'LINE_21_OTHER_RECEIVED', 'LINE_22_TOTAL_RECEIVED',
  'LINE_23_SALES_PAID', 'LINE_24_TANGIBLE_PROP_PAID',
  'LINE_25_PCT_PAYMENTS_PAID', 'LINE_26_CST_PAYMENTS_PAID',
  'LINE_27A_RENTS_PAID', 'LINE_27B_ROYALTIES_PAID',
  'LINE_28_INTANGIBLE_PAID', 'LINE_29_SERVICES_PAID',
  'LINE_30_COMMISSIONS_PAID', 'LINE_31A_LOANED_BEGIN',
  'LINE_31B_LOANED_END', 'LINE_32_INTEREST_PAID',
  'LINE_33_INSURANCE_PAID', 'LINE_34_LOAN_GUARANTEE_PAID',
  'LINE_35_OTHER_PAID', 'LINE_36_TOTAL_PAID',
];

/** First definition of each LINE_* key, which is the canonical (latest) map. */
function readFieldMap() {
  const map = {};
  for (const line of readFileSync(SRC, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(LINE_[0-9A-Z_]+):\s*'([^']*)'/);
    if (m && !(m[1] in map)) map[m[1]] = m[2];
  }
  return map;
}

async function widgetTops(pdfPath) {
  const doc = await PDFDocument.load(readFileSync(pdfPath));
  const tops = {};
  for (const field of doc.getForm().getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      tops[field.getName()] = Math.round(widget.getRectangle().y);
    }
  }
  return tops;
}

const TEMPLATE = 'public/pdf/Form-5472.pdf';

if (!existsSync(TEMPLATE)) {
  console.error(`MISSING  ${TEMPLATE}`);
  process.exit(1);
}

const fields = readFieldMap();
const tops = await widgetTops(TEMPLATE);

const failures = [];
let previousY = Infinity;
let previousKey = null;

for (const key of LINE_ORDER) {
  const name = fields[key];
  // An empty mapping is deliberate on revisions where the line does not exist
  // (see LINE_20 / LINE_34 on the 2019-2021 template). Nothing to place.
  if (!name) continue;

  const y = tops[name];
  if (y === undefined) {
    failures.push(`${key} -> '${name}' is not a field in ${TEMPLATE}`);
    continue;
  }
  if (y > previousY) {
    failures.push(
      `${key} -> '${name}' is drawn at y=${y}, ABOVE ${previousKey} at y=${previousY}. `
      + `A later line cannot sit higher on the page: this field belongs to a different line.`,
    );
  }
  previousY = y;
  previousKey = key;
}

for (const key of LINE_ORDER) {
  if (fields[key]) console.log(`ok    ${key} -> ${fields[key]}`);
}

if (failures.length > 0) {
  console.error('\nFAIL  Part IV fields are not in line order:\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`\nPASS  all ${LINE_ORDER.filter((k) => fields[k]).length} Part IV fields sit in line order.`);
