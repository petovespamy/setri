// 101 drogerie: stránka 101drogerie.sk/online-letak odkazuje na aktuálny leták ako PDF.
// Platnosť je napísaná na prvej strane PDF ("Platí od stredy 21. 10. do utorka 3. 11. 2026").
import { readPdfPages } from "../pdf.mjs";
import { parseDrogerie, drogerieValidity } from "../drogerieParser.mjs";

const PAGE = "https://101drogerie.sk/online-letak";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export default {
  id: "drogerie101",
  name: "101 drogerie",

  async fetchLeaflets({ known = new Set() } = {}) {
    const res = await fetch(PAGE, { headers: { "user-agent": UA } });
    if (!res.ok) throw new Error(`${PAGE}: HTTP ${res.status}`);
    const html = await res.text();
    const paths = [...new Set([...html.matchAll(/\/storage\/app\/media\/letak\/[^"'\s<>]+\.pdf/g)].map((m) => m[0]))];
    const out = [];
    for (const path of paths) {
      const pdf = new URL(path, PAGE).href;
      if (known.has(pdf)) continue;
      const pdfRes = await fetch(pdf, { headers: { "user-agent": UA } });
      if (!pdfRes.ok) throw new Error(`PDF ${pdf}: HTTP ${pdfRes.status}`);
      const pages = await readPdfPages(await pdfRes.arrayBuffer());
      const validity = drogerieValidity(pages);
      if (!validity) {
        console.warn(`  [drogerie101] ${pdf}: nenašla sa platnosť`);
        continue;
      }
      out.push({ source: pdf, ...validity, deals: parseDrogerie(pages) });
    }
    return out;
  },
};
