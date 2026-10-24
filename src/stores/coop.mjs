// COOP Jednota: celoslovenský leták "Potraviny, Supermarket a Tempo" je na coop.sk/letaky ako vložený
// Adobe InDesign dokument; z neho sa číta zoznam textových rámcov (content.json).
import { parseCoop } from "../coopParser.mjs";

const LIST = "https://www.coop.sk/letaky";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const pad = (n) => String(n).padStart(2, "0");

async function text(url) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

export default {
  id: "coop",
  name: "COOP Jednota",

  async fetchLeaflets({ known = new Set() } = {}) {
    const listHtml = await text(LIST);
    const slugs = [...new Set([...listHtml.matchAll(/\/letaky\/(potraviny-supermarket-a-tempo-[a-z0-9-]+)/g)].map((m) => m[1]))];
    const out = [];
    for (const slug of slugs) {
      const pageUrl = `https://www.coop.sk/letaky/${slug}`;
      if (known.has(pageUrl)) continue;
      const page = await text(pageUrl);
      const id = page.match(/indd\.adobe\.com\/view\/([0-9a-f-]{36})/)?.[1];
      const range = page.match(/od\s+(\d{1,2})\.\s*(\d{1,2})\.\s*do\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/i);
      if (!id || !range) {
        console.warn(`  [coop] ${slug}: nenašiel sa leták alebo platnosť`);
        continue;
      }
      const year = Number(range[5]);
      const startYear = Number(range[2]) > Number(range[4]) ? year - 1 : year;
      const validFrom = `${startYear}-${pad(range[2])}-${pad(range[1])}`;
      const validTo = `${year}-${pad(range[4])}-${pad(range[3])}`;

      const view = await text(`https://indd.adobe.com/view/${id}`);
      const prefix = view.match(/VERSION_PREFIX\\?":\\?"([a-z0-9]+)/)?.[1];
      if (!prefix) throw new Error("COOP: v dokumente sa nenašla verzia publikácie");
      const content = JSON.parse(await text(`https://indd.adobe.com/view/publication/${id}/${prefix}/content.json`));
      out.push({ source: pageUrl, validFrom, validTo, deals: parseCoop(content) });
    }
    return out;
  },
};
