// Teta drogérie: akciové produkty ("letak=true") sú v HTML e-shopu, v stránkach po ~60 kusov.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const BASE = "https://www.tetadrogerie.sk";

const clean = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();
const num = (s) => Number(s.replace(/\s/g, "").replace("*", "").replace(",", "."));

export function parseTetaCards(html) {
  const out = [];
  const chunks = html.split(/<div class="dlazdice(?: [^"]*)?"/).slice(1);
  for (const c of chunks) {
    const name = c.match(/data-prod_name>\s*([^<]+?)\s*<\/a>/)?.[1];
    const sale = c.match(/akciova_cena">\s*([\d ,]+?)\s*</)?.[1];
    const old = c.match(/old_price">\s*([\d ,]+?)\s*</)?.[1];
    const club = c.match(/teta_klub_cena">\s*([\d ,]+\*?)\s*</)?.[1];
    const clubNote = c.match(/pocet_na_zlavu">\s*([^<]*?)\s*</)?.[1];
    const onlineOnly = /stav_iba_online/.test(c);
    if (!name || !sale) continue;
    out.push({
      name: clean(name),
      price: num(sale),
      old: old ? num(old) : null,
      club: club ? num(club) : null,
      clubNote: clubNote ? clean(clubNote) : "",
      onlineOnly,
    });
  }
  return out;
}

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": UA, "accept-language": "sk-SK,sk;q=0.9" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const END_MARK = /nevyhovuje žiadny výrobok/;

/** Jedna stránka; pri chybe alebo bez kariet ju skúsi znova. `end` = web sám napísal, že ďalšie produkty nie sú. */
async function getPage(page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const html = await get(`${BASE}/produkty/?nparams=page;${page};letak;true`);
      const cards = parseTetaCards(html);
      if (cards.length) return { cards, end: false };
      if (END_MARK.test(html)) return { cards, end: true };
      console.warn(`[teta] strana ${page}: 0 kariet bez potvrdenia konca, pokus ${attempt}/3`);
    } catch (e) {
      console.warn(`[teta] strana ${page}: ${e.message}, pokus ${attempt}/3`);
    }
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
  return { cards: [], end: false };
}

/** Všetky akciové produkty zo stránok letak=true. `complete` = koniec zoznamu potvrdil web (nie chyba/limit). */
export async function crawlTeta() {
  const seen = new Set();
  const all = [];
  const started = Date.now();
  let complete = false;
  for (let page = 0; page < 80; page++) {
    if (Date.now() - started > 8 * 60_000) { console.warn(`[teta] limit 8 min, končím na strane ${page}`); break; }
    const { cards, end } = await getPage(page);
    for (const c of cards) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      all.push(c);
    }
    console.log(`[teta] strana ${page}: ${all.length} produktov doteraz`);
    if (end) { complete = true; break; }
    if (!cards.length) break;
  }
  all.complete = complete;
  return all;
}
