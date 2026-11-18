// Kaufland: stránka s akciovými výrobkami má všetky ponuky ako hotové dáta
// (názov, cena, pôvodná cena, zľava, platnosť), takže netreba čítať PDF.

const URL_CURRENT = "https://predajne.kaufland.sk/aktualna-ponuka/prehlad.html?kloffer-week=current";
const URL_NEXT = "https://predajne.kaufland.sk/aktualna-ponuka/prehlad.html?kloffer-week=next";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

import { recategorize } from "../categorize.mjs";
import { conditionFromText } from "../conditions.mjs";

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

/** Prejde všetky krátke texty ponuky (štítky ako "Kúp 2 za 1", "1/2 CENA!") a vyberie podmienku. */
function conditionOf(offer) {
  const texts = [];
  const walk = (v, key = "") => {
    if (typeof v === "string") {
      if (v.length <= 80 && !/^https?:|^\/|\.(jpe?g|png|webp)/i.test(v) && !/^(title|subtitle|detailTitle)$/.test(key)) texts.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(offer);
  return conditionFromText(texts.join(" | "));
}

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const isUnitLike = (s) => /^[\d.,]+\s*(g|kg|ml|l|ks|kus)\b/i.test(s) || /^(pultový|rôzne|cena za|\+)/i.test(s);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (v) => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v));
const dayNum = (iso) => Math.round(Date.parse(iso) / 86400000);

/**
 * Prevedie dáta stránky na letáky v tvare, ktorý číta appka – jeden leták na každý týždenný cyklus.
 *
 * Platnosť je tu najdôležitejšia vec, preto sa nikdy nehádá:
 *  - platnosť letáku = rozsah dátumov, ktorý má väčšina ponúk cyklu (aspoň 60 %); ojedinelé dlhodobé ponuky ju nenatiahnu,
 *  - každá ponuka má vlastné dátumy od Kauflandu; ak platí kratšie než leták (napr. len 17.–18. 11.), uloží sa to
 *    k nej (vf = platí od, vt = platí do) a appka ju ukáže len v tie dni,
 *  - cyklus s nejasnou platnosťou sa neuloží vôbec (radšej žiadny leták než zlý).
 */
export function offersToLeaflets(ssr) {
  const out = [];
  for (const cycle of ssr.props.offerData.cycles) {
    const cats = cycle.categories.filter((c) => c.main && !SKIP_CATEGORY.test(c.displayName));
    const counts = new Map();
    let total = 0;
    for (const c of cats) {
      if (!isIso(c.dateFrom) || !isIso(c.dateTo)) continue;
      const key = `${c.dateFrom}|${c.dateTo}`;
      counts.set(key, (counts.get(key) ?? 0) + c.offers.length);
      total += c.offers.length;
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) continue;
    const [validFrom, validTo] = best[0].split("|");
    const span = dayNum(validTo) - dayNum(validFrom);
    if (best[1] / total < 0.6 || span < 0 || span > 13) {
      console.error(`  [kaufland] cyklus s nejasnou platnosťou (${validFrom} až ${validTo}, ${best[1]}/${total} ponúk) – neukladám`);
      continue;
    }

    const seen = new Set();
    const deals = [];
    for (const cat of cats) {
      for (const o of cat.offers) {
        if (seen.has(o.offerId) || !(o.price > 0)) continue;
        // Vlastná platnosť ponuky (ak ju Kaufland uvádza), inak platnosť kategórie.
        const from = isIso(o.dateFrom) ? o.dateFrom : cat.dateFrom;
        const to = isIso(o.dateTo) ? o.dateTo : cat.dateTo;
        if (!isIso(from) || !isIso(to) || from > validTo || to < validFrom) continue; // ponuka s týmto týždňom nesúvisí
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
        const cond = conditionOf(o);
        if (cond) deal.q = cond;
        const cs = recategorize("kaufland", name, detail, categoryFor(cat.displayName, `${name} ${detail}`.toLowerCase()));
        if (cs) deal.c = cs;
        if (from > validFrom) deal.vf = from; // ponuka začína neskôr než leták
        if (to < validTo) deal.vt = to; // ponuka končí skôr než leták
        deals.push(deal);
      }
    }
    if (deals.length) out.push({ validFrom, validTo, deals });
  }
  // Týždne nesmú zasahovať jeden do druhého.
  out.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  for (let i = 1; i < out.length; i++) {
    if (out[i].validFrom <= out[i - 1].validTo) {
      throw new Error(`Kaufland: letáky sa prekrývajú (${out[i - 1].validFrom}–${out[i - 1].validTo} a ${out[i].validFrom}–${out[i].validTo})`);
    }
  }
  return out;
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
        for (const lf of offersToLeaflets(await getSsr(url))) {
          if (lf.validFrom && lf.deals.length) out.set(lf.validFrom, { source: `${url.split("?")[0]}#${lf.validFrom}`, ...lf });
        }
      } catch (err) {
        console.warn(`  [kaufland] ${err.message}`);
      }
    }
    return [...out.values()];
  },
};
