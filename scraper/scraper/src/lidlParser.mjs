// Čítanie PDF letáku Lidla. Každá zľava má veľkú cenu (písmo ~50), vedľa nej nepovinnú pôvodnú cenu
// (písmo ~10), nad ňou "-NN ﹪" a vpravo od ceny názov (písmo ~10) a popis (písmo ~8).
import { guessCategory } from "./parseFlyer.mjs";

const clean = (s) => s.replace(/\s+/g, " ").trim();
const UNIT = /\b\d+([.,]\d+)?\s*(g|kg|ml|l|ks)\b|cena za 1 kg|\bkus\b/i;
const UNIT_PRICE = /^\(.*=.*\)$|^\(LP:/;
const NOISE = /^(aj online|ešte viac|online|ušetri|s lidl plus|platí od|dlhodobo|zlacnené|cenový|trhák|x\.xx|\*|nad|20€|vrátane)/i;

function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => {
    const k = `${i.s}|${i.x}|${i.y}|${i.fs}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parsePage(rawItems) {
  const items = dedupe(rawItems);
  const prices = items.filter((i) => i.fs >= 47 && i.fs <= 52 && /^\d{1,3}\.\d{2}$/.test(i.s));
  const cards = prices.map((p) => ({ p, price: Number(p.s), lines: [], det: [] }));

  const discounts = items.filter((i) => i.fs >= 19 && i.fs <= 22 && /^-\d{1,2}$/.test(i.s));
  const slots = items.filter((i) => i.fs >= 10 && i.fs <= 10.6 && /^(\d{1,3}\.\d{2}|x\.xx)$/.test(i.s));

  for (const c of cards) {
    const d = discounts
      .filter((i) => Math.abs(i.x - c.p.x) < 50 && c.p.y - i.y > 0 && c.p.y - i.y < 95)
      .sort((a, b) => Math.abs(c.p.y - a.y) - Math.abs(c.p.y - b.y))[0];
    c.disc = d ? Math.abs(parseInt(d.s, 10)) : null;
    const o = slots
      .filter((i) => i.x - c.p.x >= 15 && i.x - c.p.x <= 80 && i.y - c.p.y >= -60 && i.y - c.p.y <= 10 && i.s !== "x.xx")
      .sort((a, b) => Math.hypot(a.x - c.p.x - 45, a.y - c.p.y + 30) - Math.hypot(b.x - c.p.x - 45, b.y - c.p.y + 30))[0];
    c.old = o ? Number(o.s) : null;
  }

  for (const t of items) {
    const isName = t.fs >= 9.8 && t.fs <= 10.2;
    const isDet = t.fs >= 7.8 && t.fs <= 8.2;
    if (!isName && !isDet) continue;
    let best = null;
    let cost = Infinity;
    for (const c of cards) {
      const dx = t.x - c.p.x;
      const dy = t.y - c.p.y;
      if (dx < 55 || dx > 100 || dy < -62 || dy > 30) continue;
      const k = Math.abs(dx - 80) + Math.abs(dy + 30) * 0.5;
      if (k < cost) {
        cost = k;
        best = c;
      }
    }
    if (best) (isName ? best.lines : best.det).push(t);
  }

  return cards.map((c) => {
    const sort = (a) => a.sort((p, q) => p.y - q.y || p.x - q.x).map((i) => i.s);
    return { price: c.price, old: c.old, disc: c.disc, name: clean(sort(c.lines).join(" ")), det: sort(c.det) };
  });
}

/** Strany z PDF -> zľavy v tvare, ktorý číta appka. Nepotravinový tovar sa vynecháva. */
export function parseLidl(pages) {
  const out = [];
  const seen = new Set();
  for (const pg of pages) {
    for (const r of parsePage(pg.items)) {
      if (!r.name || r.name.length < 3 || NOISE.test(r.name)) continue;
      const detLines = r.det.filter((l) => !UNIT_PRICE.test(l) && !/^\+ záloh/i.test(l) && !NOISE.test(l));
      const detail = clean(detLines.join(", "));
      const category = guessCategory(`${r.name} ${detail}`);
      if (!category && !UNIT.test(`${r.name} ${detail}`)) continue; // nepotravinový tovar
      let disc = r.disc;
      if (!disc && r.old) disc = Math.round((1 - r.price / r.old) * 100);
      const key = `${r.name}|${r.price}|${r.old ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const deal = { n: r.name.slice(0, 60), p: r.price };
      if (detail) deal.d = detail.slice(0, 70);
      if (r.old && r.old > r.price) deal.o = r.old;
      if (disc) deal.x = disc;
      if (category) deal.c = category;
      out.push(deal);
    }
  }
  return out;
}
