// Kraj potravín: stránka krajpotravin.sk/aktualna-ponuka vkladá leták z Publitasu (rovnako ako Terno).
// Leták je PDF; platnosť je napísaná v popise publikácie ("Ponuka platí od 22. 10. do 28. 10. 2026").
import { readPdfPages } from "../pdf.mjs";
import { parseKraj } from "../krajParser.mjs";

const PAGE = "https://www.krajpotravin.sk/aktualna-ponuka";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const pad = (n) => String(n).padStart(2, "0");

async function text(url) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

export default {
  id: "kraj",
  name: "Kraj",

  async fetchLeaflets({ known = new Set() } = {}) {
    const html = await text(PAGE);
    const pubs = [...new Set([...html.matchAll(/https:\/\/view\.publitas\.com\/terno-letak\/[a-z0-9_\-]*kraj[a-z0-9_\-]*\/?/gi)].map((m) => m[0]))];
    const out = [];
    for (const pub of pubs) {
      const pubHtml = await text(pub);
      const pdf = pubHtml.match(/https:\/\/view\.publitas\.com\/[0-9]+\/[0-9]+\/pdfs\/[0-9a-f-]+\.pdf/)?.[0];
      // "od 22. 10. do 28. 10. 2026" (rok je len na konci)
      const r = pubHtml.match(/od\s+(\d{1,2})\.\s?(\d{1,2})\.\s+do\s+(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
      if (!pdf || !r) {
        console.warn(`  [kraj] ${pub}: nenašlo sa PDF alebo platnosť`);
        continue;
      }
      if (known.has(pdf)) continue;
      const res = await fetch(pdf, { headers: { "user-agent": UA } });
      if (!res.ok) throw new Error(`PDF ${pdf}: HTTP ${res.status}`);
      const pages = await readPdfPages(await res.arrayBuffer());
      const toYear = Number(r[5]);
      const fromYear = Number(r[2]) > Number(r[4]) ? toYear - 1 : toYear;
      out.push({
        source: pdf,
        validFrom: `${fromYear}-${pad(r[2])}-${pad(r[1])}`,
        validTo: `${toYear}-${pad(r[4])}-${pad(r[3])}`,
        deals: parseKraj(pages),
      });
    }
    return out;
  },
};
