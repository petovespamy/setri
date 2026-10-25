// Kaufland: stránka s akciovými výrobkami má všetky ponuky ako hotové dáta
// (názov, cena, pôvodná cena, zľava, platnosť), takže netreba čítať PDF.

const URL_CURRENT = "https://predajne.kaufland.sk/aktualna-ponuka/prehlad.html?kloffer-week=current";
const URL_NEXT = "https://predajne.kaufland.sk/aktualna-ponuka/prehlad.html?kloffer-week=next";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

import { recategorize } from "../categorize.mjs";

// Oblasti, ktoré do potravinovej appky nepatria.
const SKIP_CATEGORY = /^(elektro|oble[cč]enie|dom,)/i;
// Nepotravinový tovar, ktorý sa objaví aj v potravinových oddieloch (kvety, dekorácie).
const SKIP_NAME = /náhrobn|dekorác|kvetin|chryzant|vresov|hrob|sviečk|rastlin|hrnc/i;

const ALCOHOL = /pivo|pilsner|víno|vodka|whisk|\brum\b|likér|gin\b|prosecco|šumivé víno|brandy|borovič|slivovic|radler|koňak|vermut|aperol|cider/i;
const PETS = /pre psov|pre mačk|granule|krmivo|whiskas|pedigree|felix|sheba|perfect fit|kitekat/i;
const BABY = /plienk|detská výživa|bábät|príkrm|pampers|huggies/i;
const DRINK = /šťava|džús|nápoj|limonád|sirup|minerál/i;
const DELI = /šunk|saláma|salám|klobás|párky|párok|údený|údenin|slanin|špek|mortadel|paštéta|uzeniny|sekaná/i;

function categoryFor(kauflandCategory, text) {
  if (ALCOHOL.test(text)) return "alcohol";
  if (PETS.test(text)) return "pets";
  if (BABY.test(text)) return "baby";
  if (DRINK.test(text)) return "drinks";
  const c = kauflandCategory.toLowerCase();
  if (c.startsWith("čerstvé ovocie")) return "fruitveg";
  if (c.startsWith("mäso")) return DELI.test(text) ? "deli" : "meat";
  if (c.startsWith("čerstvé ryby")) return "meat";
  if (c.startsWith("čerstvé výrobky")) return "dairy";
  if (c.startsWith("mrazené")) return "frozen";
  if (c.startsWith("lahôdky")) return "deli";
  if (c.startsWith("trvanlivé")) return "pantry";
  if (c.startsWith("pečivo")) return "bakery";
  if (c.startsWith("káva")) return "sweets";
  if (c.startsWith("nápoje")) return "drinks";
  if (c.startsWith("drogéria")) return "drugstore";
  if (c.startsWith("dom,")) return "household";
  return undefined;
}

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const isUnitLike = (s) => /^[\d.,]+\s*(g|kg|ml|l|ks|kus)\b/i.test(s) || /^(pultový|rôzne|cena za|\+)/i.test(s);

/** Prevedie dáta stránky na leták v tvare, ktorý číta appka. */
export function offersToLeaflet(ssr) {
  const cycles = ssr.props.offerData.cycles;
  const seen = new Set();
  const deals = [];
  let validFrom = null;
  let validTo = null;

  for (const cycle of cycles) {
    for (const cat of cycle.categories) {
      if (!cat.main || SKIP_CATEGORY.test(cat.displayName)) continue;
      validFrom = !validFrom || cat.dateFrom < validFrom ? cat.dateFrom : validFrom;
      validTo = !validTo || cat.dateTo > validTo ? cat.dateTo : validTo;

      for (const o of cat.offers) {
        if (seen.has(o.offerId) || !(o.price > 0)) continue;
        seen.add(o.offerId);

        const subLines = String(o.subtitle ?? "").split("\n").map(oneLine).filter(Boolean);
        const title = oneLine(o.title);
        const productLine = subLines.find((l) => !isUnitLike(l));
        const name = oneLine([title, productLine].filter(Boolean).join(" ")) || oneLine(o.detailTitle);
        if (!name || SKIP_NAME.test(name)) continue;

        const extra = subLines.filter((l) => l !== productLine && l !== o.unit);
        const detail = oneLine([o.unit, ...extra].filter(Boolean).join(", "));

        const oldPrice = o.formattedOldPrice ? Number(String(o.formattedOldPrice).replace(",", ".")) : null;
        const deal = { n: name.slice(0, 60), p: Math.round(o.price * 100) / 100 };
        if (detail) deal.d = detail.slice(0, 70);
        if (oldPrice && oldPrice > o.price) {
          deal.o = oldPrice;
          deal.x = o.discount > 0 ? o.discount : Math.round((1 - o.price / oldPrice) * 100);
        }
        const cs = recategorize("kaufland", name, detail, categoryFor(cat.displayName, `${name} ${detail}`.toLowerCase()));
        if (cs) deal.c = cs;
        deals.push(deal);
      }
    }
  }
  return { validFrom, validTo, deals };
}

async function getSsr(url) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, "accept-language": "sk-SK,sk;q=0.9" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/window\.SSR\[[^\]]+\]\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (!m) throw new Error("Kaufland: v stránke sa nenašli dáta ponuky (zmenil sa formát?)");
  return JSON.parse(m[1]);
}

export default {
  id: "kaufland",
  name: "Kaufland",

  /** Vráti hotové letáky: aktuálny a (ak už je zverejnený) budúci týždeň. */
  async fetchLeaflets() {
    const out = new Map();
    for (const url of [URL_CURRENT, URL_NEXT]) {
      try {
        const lf = offersToLeaflet(await getSsr(url));
        if (lf.validFrom && lf.deals.length) out.set(lf.validFrom, { source: `${url.split("?")[0]}#${lf.validFrom}`, ...lf });
      } catch (err) {
        console.warn(`  [kaufland] ${err.message}`);
      }
    }
    return [...out.values()];
  },
};
