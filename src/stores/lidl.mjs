// Lidl: letáky sú v rovnakom prehliadači ako Kaufland (leaflets.schwarz). Adresa letáku sa dá odvodiť
// z pondelka, odkedy platí ("online-letak-platny-od-26-10-2026"); jeho PDF a platnosť dá rozhranie.
import { readPdfPages } from "../pdf.mjs";
import { parseLidl } from "../lidlParser.mjs";

const API = "https://endpoints.leaflets.schwarz/v4/flyer";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const pad = (n) => String(n).padStart(2, "0");

/** Pondelky: minulý, tento a budúci týždeň (formát DD-MM-YYYY). */
function candidateSlugs() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Bratislava" }));
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const slugs = [];
  for (const shift of [-7, 0, 7]) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + shift);
    slugs.push(`online-letak-platny-od-${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`);
  }
  return slugs;
}

async function getFlyer(slug) {
  const url = `${API}?flyer_identifier=${slug}&region_id=0&region_code=0`;
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) return null;
  const json = await res.json();
  return json.success && json.flyer ? json.flyer : null;
}

export default {
  id: "lidl",
  name: "Lidl",

  async fetchLeaflets({ known = new Set() } = {}) {
    const out = [];
    for (const slug of candidateSlugs()) {
      let flyer;
      try {
        flyer = await getFlyer(slug);
      } catch (err) {
        console.warn(`  [lidl] ${slug}: ${err.message}`);
        continue;
      }
      if (!flyer || !flyer.pdfUrl || !flyer.offerStartDate || !flyer.offerEndDate) continue;
      const source = flyer.pdfUrl;
      if (known.has(source)) continue;

      console.log(`  [lidl] sťahujem ${slug}`);
      const res = await fetch(source, { headers: { "user-agent": UA } });
      if (!res.ok) throw new Error(`PDF ${source}: HTTP ${res.status}`);
      const pages = await readPdfPages(await res.arrayBuffer());
      const deals = parseLidl(pages);
      out.push({ source, validFrom: flyer.offerStartDate, validTo: flyer.offerEndDate, deals });
    }
    return out;
  },
};
