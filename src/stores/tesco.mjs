// Tesco: leták hypermarketov vychádza vo štvrtok-streda, adresa má tvar "tesco-letak-RRRR-MM-DD" (dátum
// prvého dňa platnosti, zvyčajne streda). PDF a platnosť dá ich rozhranie (GraphQL).
import { readPdfPages } from "../pdf.mjs";
import { parseTesco } from "../tescoParser.mjs";

const GRAPHQL = "https://api.prod.retail.tesco.com/marketing/leaflets-be/graphql";
const QUERY =
  "query($c:CountryCode!,$t:LeafletType!,$s:String!){leafletBySlug(country:$c,leafletType:$t,slug:$s){id type leafletUrl validFrom validTo}}";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const pad = (n) => String(n).padStart(2, "0");
const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bratislava" }); // YYYY-MM-DD

/** Všetky dni od -8 do +8 od dnes (leták môže začínať aj iný deň ako streda, preto skúšame viac dní). */
function candidateSlugs() {
  const slugs = [];
  const base = new Date();
  for (let shift = -8; shift <= 8; shift++) {
    const d = new Date(base.getTime() + shift * 86400000);
    slugs.push(`tesco-letak-${day.format(d)}`);
  }
  return slugs;
}

async function getLeaflet(slug) {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ query: QUERY, variables: { c: "sk", t: "HM", s: slug } }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.data?.leafletBySlug ?? null;
}

export default {
  id: "tesco",
  name: "Tesco",

  async fetchLeaflets({ known = new Set() } = {}) {
    const out = [];
    for (const slug of candidateSlugs()) {
      let leaflet;
      try {
        leaflet = await getLeaflet(slug);
      } catch (err) {
        console.warn(`  [tesco] ${slug}: ${err.message}`);
        continue;
      }
      if (!leaflet?.leafletUrl) continue;
      const source = leaflet.leafletUrl;
      if (known.has(source)) continue;

      console.log(`  [tesco] sťahujem ${slug}`);
      const res = await fetch(source, { headers: { "user-agent": UA } });
      if (!res.ok) throw new Error(`PDF ${source}: HTTP ${res.status}`);
      const pages = await readPdfPages(await res.arrayBuffer());
      out.push({
        source,
        validFrom: day.format(new Date(leaflet.validFrom)),
        validTo: day.format(new Date(leaflet.validTo)),
        deals: parseTesco(pages),
      });
    }
    return out;
  },
};
