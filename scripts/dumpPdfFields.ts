import { PDFDocument } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

async function dumpFields(filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.log(`\n⚠️  MISSING: ${filePath}`);
    return;
  }
  const buf = fs.readFileSync(filePath);
  const doc = await PDFDocument.load(buf);
  const fields = doc.getForm().getFields();
  console.log(`\n=== ${path.basename(filePath)} - ${fields.length} fields ===`);
  fields.forEach(f => {
    const type = f.constructor.name.replace('PDF', '').replace('Field', '');
    console.log(`  [${type.padEnd(10)}]  ${f.getName()}`);
  });
}

const pdfs = [
  'public/pdf/Form-5472.pdf',
  'public/pdf/Form-5472-2023.pdf',
  'public/pdf/Form-5472-2022.pdf',
  'public/pdf/Form-5472-2019-2021.pdf',
  'public/pdf/Form-1120-2025.pdf',
  'public/pdf/Form-1120-2024.pdf',
  'public/pdf/Form-1120-2023.pdf',
  'public/pdf/Form-1120-2022.pdf',
  'public/pdf/Form-1120-2021.pdf',
  'public/pdf/Form-1120-2020.pdf',
  'public/pdf/Form-1120-2019.pdf',
];

(async () => {
  for (const p of pdfs) await dumpFields(p);
})();
