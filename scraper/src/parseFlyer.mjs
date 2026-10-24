// Prevod textu z PDF letáku (Publitas) na zoznam zliav.
// Každá zľava má veľkú cenu (písmo ~24 + halier ~15), pôvodnú cenu (~8 + ~5),
// percento (~27, začína "-") a pri sebe názov (~9) a popis (~7).

const near = (v, a, b) => v >= a && v <= b;

const CATEGORY_RULES = [
  ["frozen", /zmrzlin|mrazen/],
  ["alcohol", /pivo|pilsner|víno|vodka|whisk|rum\b|likér|becherovka|\bgin\b|prosecco|šumivé|brandy|borovič|slivovic|guinness|radler|koňak|vermut|aperol|cider/],
  ["household", /prací|aviváž|čistiac|toalet|utierk|savo\b|prášok do|tablety do|sáčky|sviečk|fairy|persil|silan|bielidl|kapsule na pranie|papier/],
  ["drugstore", /šampón|sprch|zubn|dezodor|krém|mydlo|tampón|vložky|holiac|kozmet|ústna voda|vlasov|telov|hygiena/],
  ["pets", /pre psov|pre mačk|granule|krmivo|whiskas|pedigree|felix/],
  ["baby", /plienk|detská|bábät|detsk|príkrmy/],
  ["bakery", /bageta|bagetka|chlieb|rožok|pečivo|croissant|dalamán|koláč|buchta|vianočk|šiška|slimák|mriežka/],
  ["meat", /kurča|kuracie|bravčov|hovädz|mleté|ryba|losos|kapor|steak|krkovič|stehn|rezne|mäso|pstruh|morčac|krevety|panenka|držky/],
  ["deli", /šunk|saláma|salám|klobás|párky|párok|údený|údenin|pečienka|slanin|lahôd|tlačenk|špek|mortadel|prosciutto|paštéta|uzeniny/],
  ["dairy", /mlieko|maslo|jogurt|syr\b|syry|tvaroh|smotan|vajc|parenic|eidam|cheddar|mozzarel|kefír|bryndz|termix|nátierk|mascarpone|žervé|skyr|puding|margarín/],
  ["drinks", /nápoj|džús|voda|minerál|cola|limonád|sirup|energetick|kofola|nektár|čaj\b|ľadový|fanta|pepsi/],
  ["sweets", /čokolád|cukrík|guľky|tyčink|keks|sušienk|oplátk|bonbón|chips|snack|žuvač|marcipán|praclík|arašid|sladkost|nutella|lupienky|popcorn|karamel/],
  ["fruitveg", /banán|malin|jablk|hrozno|mandarín|citrón|gaštan|hurmik|zázvor|rajč|brokol|zemiak|cvikl|cibu|karfiol|karot|cesnak|šampiň|tekvic|zelenin|ovoc|uhork|paprik|kapust|šalát|avokád|pomaranč|hruš|broskyn|kiwi|ananás|slivky|špenát|zeler/],
  ["ready", /hotové|pizza|pinsa|knedľ|halušk|polievk|sendvič|wrap/],
  ["pantry", /olej|múka|cestovin|ryža|tuniak|konzerv|kečup|cukor|soľ\b|káva|kávy|med\b|cesto|strukov|oriešk|vločk|kukuric|zaváran|omáčk|ocot|instantn|müsli|džem|kakao|fazuľ|šošovic|cereáli|olivy|horčica/],
];

/** Odhadne kategóriu produktu podľa slov v názve (spoločné pre viac obchodov). */
export function guessCategory(text) {
  const key = text.toLowerCase();
  return (CATEGORY_RULES.find(([, re]) => re.test(key)) || [null])[0] || undefined;
}

const JUNK_NAME = /^(rôzne|cena\b|chladen|pultov|vákuovo|voľn|parená|zľava|servíruje|\d)/i;

const clean = (s) =>
  s
    .replace(/^.*produkty\.\s*/, "")
    .replace(/^[\s*]+/, "")
    .replace(/[\s*]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

function sortJoin(items) {
  return items
    .sort((p, q) => p.y - q.y || p.x - q.x)
    .map((i) => i.s)
    .join(" ");
}

/** Nájde zľavy na jednej strane. */
function parsePage(pg) {
  const it = pg.items;
  const cards = it
    .filter((i) => near(i.fs, 23, 25) && /^\d{1,3}$/.test(i.s))
    .map((a) => {
      const cents = it
        .filter((i) => near(i.fs, 15, 16) && /^\d{2}$/.test(i.s) && i.x > a.x && i.x - a.x < 40 && Math.abs(i.y - a.y) < 14)
        .sort((p, q) => p.x - q.x)[0];
      const oldInt = it.filter(
        (i) => near(i.fs, 7.5, 8.6) && /^\d{1,3}$/.test(i.s) && i.x - a.x > 8 && i.x - a.x < 55 && Math.abs(i.y - a.y) < 16
      )[0];
      const oldCents =
        oldInt &&
        it.filter(
          (i) => near(i.fs, 5, 5.6) && /^\d{2}$/.test(i.s) && i.x > oldInt.x && i.x - oldInt.x < 22 && Math.abs(i.y - oldInt.y) < 8
        )[0];
      const disc = it.filter(
        (i) => near(i.fs, 26, 28) && /^-\d+$/.test(i.s) && Math.abs(i.x - a.x) < 70 && Math.abs(i.y - a.y) < 70
      )[0];
      return {
        a,
        price: cents ? Number(`${a.s}.${cents.s}`) : Number(a.s),
        old: oldInt ? Number(`${oldInt.s}.${oldCents ? oldCents.s : "00"}`) : null,
        disc: disc ? Math.abs(parseInt(disc.s, 10)) : null,
        names: [],
        descs: [],
      };
    });

  for (const t of it) {
    const isName = near(t.fs, 8.9, 9.1) || near(t.fs, 13.5, 14.5);
    const isDesc = near(t.fs, 6.9, 7.1);
    if (!isName && !isDesc) continue;
    let best = null;
    let bestCost = Infinity;
    for (const c of cards) {
      const dx = Math.abs(t.x - c.a.x);
      const dy = c.a.y - t.y;
      if (dy < -40 || dy > 330 || dx > 115) continue;
      const cost = dx * 1.2 + Math.abs(dy);
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    if (best) (isName ? best.names : best.descs).push(t);
  }

  return cards.map((c) => ({
    name: sortJoin(c.names),
    desc: sortJoin(c.descs),
    price: c.price,
    old: c.old,
    disc: c.disc,
  }));
}

function finalize(raw) {
  let name = clean(raw.name);
  let detail = clean(raw.desc).replace(/dopečené v našej peci/g, "").replace(/\s+/g, " ").trim();
  if (!name && !detail) return null;
  if (!name) {
    const words = detail.split(" ");
    name = words.slice(0, 2).join(" ");
    detail = words.slice(2).join(" ");
  }
  if (name.length < 3 || name.length > 60 || JUNK_NAME.test(name) || !(raw.price > 0)) return null;

  const key = `${name} ${detail}`.toLowerCase();
  const category = (CATEGORY_RULES.find(([, re]) => re.test(key)) || [null])[0];
  let discount = raw.disc;
  if (!discount && raw.old) discount = Math.round((1 - raw.price / raw.old) * 100);

  const deal = { n: name, p: raw.price };
  if (detail) deal.d = detail.slice(0, 70);
  if (raw.old) deal.o = raw.old;
  if (discount) deal.x = discount;
  if (category) deal.c = category;
  return deal;
}

/** Hlavná funkcia: strany z PDF -> zoznam zliav v tvare, ktorý číta appka. */
export function parseFlyer(pages) {
  const seen = new Set();
  const deals = [];
  for (const pg of pages) {
    for (const raw of parsePage(pg)) {
      const deal = finalize(raw);
      if (!deal) continue;
      const key = `${deal.n}|${deal.p}|${deal.o ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deals.push(deal);
    }
  }
  return deals;
}

const pad = (n) => String(n).padStart(2, "0");

/**
 * Nájde dátumy platnosti vo vete typu "Akciová ponuka platí od stredy 21. 10. do utorka 27. 10. 2026".
 * Vráti { validFrom, validTo } vo formáte YYYY-MM-DD alebo null.
 */
export function extractValidity(text) {
  const re =
    /Akciov[áa] ponuka plat[íi] od(?:\s+\p{L}+)?\s+(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?\s+do(?:\s+\p{L}+)?\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/iu;
  const m = text.match(re);
  if (!m) return null;
  const endYear = Number(m[6]);
  let startYear = m[3] ? Number(m[3]) : endYear;
  // Leták cez Nový rok: "od 30. 12. do 5. 1. 2027"
  if (!m[3] && Number(m[2]) > Number(m[5])) startYear = endYear - 1;
  return {
    validFrom: `${startYear}-${pad(m[2])}-${pad(m[1])}`,
    validTo: `${endYear}-${pad(m[5])}-${pad(m[4])}`,
  };
}

/** Text prvej strany (na hľadanie dátumov platnosti). */
export function pageText(page) {
  return page.items.map((i) => i.s).join(" ");
}
