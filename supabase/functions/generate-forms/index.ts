// supabase/functions/generate-forms/index.ts
// Deno Edge Function — fills IRS Form 5472 using pdf-lib
// Deploy:  supabase functions deploy generate-forms
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//          F5472_BUCKET — private Storage bucket name holding f5472.pdf

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

interface Address {
  line1?: string; line2?: string; city?: string;
  region?: string; postal_code?: string; country?: string;
}
interface Filing {
  id: string; user_id: string;
  tax_year?: string; llc_name?: string; ein?: string;
  mailing_address?: Address;
  total_assets?: number;
  naics_code?: string; naics_description?: string;
  date_of_incorporation?: string; date_of_closure?: string;
  owner_full_name?: string;
  owner_primary_country?: string;
  owner_country_residence?: string; owner_country_citizenship?: string;
  owner_foreign_tax_id?: string; owner_address?: Address;
  owner_us_tin?: string; owner_reference_id?: string;
  owner_naics_code?: string; owner_naics_description?: string;
}
interface Transaction { category: string; direction: string; amount: number; }

function fmtDate(d?: string | Date | null): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "";
  return `${String(dt.getUTCMonth()+1).padStart(2,"0")}/${String(dt.getUTCDate()).padStart(2,"0")}/${dt.getUTCFullYear()}`;
}
function fmtAmt(n?: number | null): string {
  return (!n || n === 0) ? "" : n.toFixed(2);
}
function sumTx(txns: Transaction[], cat: string, dir: string): string {
  return fmtAmt(txns.filter(t => t.category===cat && t.direction===dir).reduce((a,t) => a+(t.amount??0), 0));
}
function totalDir(txns: Transaction[], dir: string): string {
  return fmtAmt(txns.filter(t => t.direction===dir).reduce((a,t) => a+(t.amount??0), 0));
}
function totalGross(txns: Transaction[]): string {
  return fmtAmt(txns.reduce((a,t) => a+(t.amount??0), 0));
}
function cityStateZip(addr?: Address): string {
  return [addr?.city, addr?.region, addr?.postal_code].filter(Boolean).join(", ");
}
function fullAddr(name?: string, addr?: Address): string {
  if (!addr) return name ?? "";
  return [name, addr.line1, addr.line2,
    [addr.city, addr.region, addr.postal_code].filter(Boolean).join(", "),
    addr.country].filter(Boolean).join("\n");
}
function taxYearStart(f: Filing): string {
  const yr = f.tax_year ?? String(new Date().getFullYear()-1);
  if (f.date_of_incorporation) {
    const d = new Date(f.date_of_incorporation);
    if (String(d.getUTCFullYear()) === yr) return fmtDate(f.date_of_incorporation);
  }
  return `01/01/${yr}`;
}
function taxYearEnd(f: Filing): string {
  const yr = f.tax_year ?? String(new Date().getFullYear()-1);
  if (f.date_of_closure) {
    const d = new Date(f.date_of_closure);
    if (String(d.getUTCFullYear()) === yr) return fmtDate(f.date_of_closure);
  }
  return `12/31/${yr}`;
}
function isInitialYear(f: Filing): boolean {
  if (!f.date_of_incorporation || !f.tax_year) return false;
  return String(new Date(f.date_of_incorporation).getUTCFullYear()) === f.tax_year;
}
function ifDiff(val?: string|null, primary?: string|null): string {
  if (!val) return ""; return val === primary ? "" : val;
}

async function fillForm5472(src: Uint8Array, f: Filing, txns: Transaction[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(src, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const primary = f.owner_primary_country ?? f.owner_country_residence ?? "";
  const set = (fld: string, val: string) => { try { form.getTextField(fld).setText(val); } catch(_){} };
  const chk = (fld: string, on: boolean) => { try { on ? form.getCheckBox(fld).check() : form.getCheckBox(fld).uncheck(); } catch(_){} };

  set("f1_1[0]", taxYearStart(f));  set("f1_2[0]", taxYearEnd(f));
  set("f1_3[0]", taxYearStart(f));  set("f1_4[0]", taxYearEnd(f));

  set("f1_5[0]",  f.llc_name ?? "");
  set("f1_6[0]",  f.mailing_address?.line1 ?? "");
  set("f1_7[0]",  cityStateZip(f.mailing_address));
  set("f1_8[0]",  f.ein ?? "");
  set("f1_9[0]",  fmtAmt(f.total_assets));
  set("f1_10[0]", f.naics_description ?? "");
  set("f1_11[0]", f.naics_code ?? "");
  set("f1_12[0]", totalGross(txns));
  set("f1_13[0]", "1");
  set("f1_14[0]", totalGross(txns));
  set("f1_15[0]", "0");
  set("f1_16[0]", "United States of America");
  set("f1_17[0]", fmtDate(f.date_of_incorporation));
  set("f1_18[0]", "United States of America");
  set("f1_19[0]", "United States");
  chk("c1_1[0]", false);
  chk("c1_2[0]", isInitialYear(f));
  chk("c1_3[0]", true);  chk("c1_4[0]", true);  chk("c1_5[0]", false);

  set("f1_20[0]", fullAddr(f.owner_full_name, f.owner_address));
  set("f1_21[0]", f.owner_us_tin ?? "");
  set("f1_22[0]", f.owner_reference_id ?? "");
  set("f1_23[0]", f.owner_foreign_tax_id ?? "");
  set("f1_24[0]", primary);
  set("f1_25[0]", ifDiff(f.owner_country_citizenship, primary));
  set("f1_26[0]", ifDiff(f.owner_country_residence, primary));
  for (let i=27; i<=47; i++) set(`f1_${i}[0]`, "");

  chk("c2_1[0]", true);  chk("c2_1[1]", false);
  set("f2_1[0]", fullAddr(f.owner_full_name, f.owner_address));
  set("f2_2[0]", f.owner_us_tin ?? "");
  set("f2_3[0]", f.owner_reference_id ?? "");
  set("f2_4[0]", f.owner_foreign_tax_id ?? "");
  set("f2_5[0]", f.owner_naics_description ?? "");
  set("f2_6[0]", f.owner_naics_code ?? "");
  chk("c2_2[0]", false);  chk("c2_3[0]", true);  chk("c2_4[0]", false);
  set("f2_7[0]", ifDiff(f.owner_country_residence, primary) || primary);
  set("f2_8[0]", ifDiff(f.owner_country_residence, primary) || primary);

  set("f2_9[0]",  sumTx(txns,"capital_contribution","to_llc"));
  set("f2_10[0]", sumTx(txns,"other","to_llc"));
  set("f2_11[0]", sumTx(txns,"service_payment","to_llc"));
  set("f2_12[0]", "");
  set("f2_13[0]", sumTx(txns,"rent_royalty","to_llc"));
  ["f2_14[0]","f2_15[0]","f2_16[0]","f2_17[0]"].forEach(x => set(x,""));
  set("f2_18[0]", sumTx(txns,"loan_from_llc","from_llc"));
  ["f2_19[0]","f2_20[0]","f2_21[0]","f2_22[0]"].forEach(x => set(x,""));
  set("f2_23[0]", sumTx(txns,"distribution","to_llc"));
  set("f2_24[0]", totalDir(txns,"to_llc"));
  chk("c2_5[0]", true);

  set("f2_25[0]", sumTx(txns,"capital_contribution","from_llc"));
  set("f2_26[0]", sumTx(txns,"other","from_llc"));
  set("f2_27[0]", sumTx(txns,"service_payment","from_llc"));
  set("f2_28[0]", "");
  set("f2_29[0]", sumTx(txns,"rent_royalty","from_llc"));
  ["f2_30[0]","f2_31[0]","f2_32[0]","f2_33[0]"].forEach(x => set(x,""));
  set("f2_34[0]", sumTx(txns,"loan_to_llc","to_llc"));
  ["f2_35[0]","f2_36[0]","f2_37[0]","f2_38[0]"].forEach(x => set(x,""));
  set("f2_39[0]", sumTx(txns,"distribution","from_llc"));
  set("f2_40[0]", totalDir(txns,"from_llc"));

  chk("c2_6[0]", true);
  chk("c2_7[0]", false);

  form.flatten();
  return pdfDoc.save();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  }});
  try {
    const { filing_id } = await req.json();
    if (!filing_id) return new Response(JSON.stringify({ error: "filing_id required" }), { status: 400 });
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: filingData, error: filingErr } = await supabase
      .from("filings").select("*").eq("id", filing_id).single();
    if (filingErr || !filingData)
      return new Response(JSON.stringify({ error: filingErr?.message ?? "Filing not found" }), { status: 404 });
    const { data: txData } = await supabase
      .from("filing_transactions").select("category, direction, amount").eq("filing_id", filing_id);
    const txns = (txData ?? []) as Transaction[];
    const bucket = Deno.env.get("F5472_BUCKET") ?? "irs-forms";
    const { data: pdfBlob, error: storageErr } = await supabase.storage.from(bucket).download("f5472.pdf");
    if (storageErr || !pdfBlob)
      return new Response(JSON.stringify({ error: "Could not load source PDF: " + storageErr?.message }), { status: 500 });
    const srcBytes = new Uint8Array(await pdfBlob.arrayBuffer());
    const filled   = await fillForm5472(srcBytes, filingData as Filing, txns);
    const outPath = `${filingData.user_id}/${filing_id}/form-5472.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from("filled-forms").upload(outPath, filled, { contentType: "application/pdf", upsert: true });
    if (uploadErr)
      return new Response(JSON.stringify({ error: "Upload failed: " + uploadErr.message }), { status: 500 });
    const { data: signed, error: signedErr } = await supabase.storage
      .from("filled-forms").createSignedUrl(outPath, 3600);
    if (signedErr || !signed)
      return new Response(JSON.stringify({ error: "Could not create download URL" }), { status: 500 });
    await supabase.from("filings")
      .update({ forms_generated_at: new Date().toISOString() }).eq("id", filing_id);
    return new Response(JSON.stringify({ url: signed.signedUrl }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
