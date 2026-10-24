// Čítanie PDF letáku Tesca. Zľava = zhluk "−NN %" + nová cena (väčšie písmo) + pôvodná cena (menšie písmo).
// Názov a popis sú samostatný blok riadkov (písmo ~8,4) niekde pri zhluku; priradíme ho podľa vzdialenosti.
import { guessCategory } from "./parseFlyer.mjs";

const clean = (s) => s.replace(/\s+/g, " ").trim();
const UNIT = /\b\d+([.,]\d+)?\s*(g|kg|ml|l|ks)\b|\b1 (kg|ks|l)\b|cena za 100 g/i;
const DECIMAL = /^\d{1,3},\d{2}$/;
const DROP_LINE = /^(bežná cena|s clubcard|s kupónom|cena pre|záloha|1 kg\s*=|1 l\s*=|\*|ceny platia|od\b|do\b|alebo do)|\(\s*1 (kg|l)\s*=|^\d{1,2}\. \d{1,2}\./i;
const num = (s) => Number(s.replace(",", "."));

function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => {
    const k = `${i.s}|${i.x}|${i.y}|${i.fs}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const bbox = (arr, w = 30) => ({
  x0: Math.min(...arr.map((i) => i.x)),
  x1: Math.max(...arr.map((i) => i.x + w)),
  y0: Math.min(...arr.map((i) => i.y - 10)),
  y1: Math.max(...arr.map((i) => i.y + 2)),
});
const gap = (a, b) =>
  Math.max(0, b.x0 - a.x1, a.x0 - b.x1) + Math.max(0, b.y0 - a.y1, a.y0 - b.y1);

function clusters(items) {
  const decimals = items.filter((i) => DECIMAL.test(i.s));
  const out = [];
  // "−" + "NN%" alebo "−NN" + "%"
  for (const m of items.filter((i) => /^[−-]$/.test(i.s) || /^[−-]\d{1,2}%?$/.test(i.s))) {
    let disc;
    if (m.s.length > 1) disc = parseInt(m.s.slice(1), 10);
    else {
      const n = items
        .filter((i) => /^\d{1,2}%?$/.test(i.s) && i.x - m.x >= -2 && i.x - m.x <= 28 && Math.abs(i.y - m.y) <= 3)
        .sort((a, b) => a.x - b.x)[0];
      if (!n) continue;
      disc = parseInt(n.s, 10);
    }
    const near = decimals.filter((i) => i.x >= m.x - 35 && i.x <= m.x + 70 && i.y - m.y >= -32 && i.y - m.y <= 75);
    const price = near
      .filter((i) => i.fs >= 17 && i.y - m.y >= 3)
      .sort((a, b) => b.fs - a.fs || Math.abs(a.y - m.y) - Math.abs(b.y - m.y))[0] ||
      near.filter((i) => i.fs >= 8.5 && i.y - m.y >= 3).sort((a, b) => b.fs - a.fs)[0];
    if (!price) continue;
    const old = near
      .filter((i) => i !== price && i.fs < price.fs && i.fs >= 7 && i.y <= price.y)
      .sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
    out.push({ price: num(price.s), old: old ? num(old.s) : null, disc, box: bbox([price, old, m].filter(Boolean), 28) });
  }
  return out;
}

function blocks(items) {
  const lines = items
    .filter((i) => i.fs >= 8.3 && i.fs <= 8.5 && !DROP_LINE.test(i.s))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const out = [];
  for (const l of lines) {
    const b = out.find((g) => Math.abs(g.x - l.x) <= 4 && l.y - g.last.y > 0 && l.y - g.last.y <= 13);
    if (b) {
      b.lines.push(l);
      b.last = l;
    } else out.push({ x: l.x, lines: [l], last: l });
  }
  return out.map((b) => ({ ...b, box: { x0: b.x, x1: b.x + 75, y0: b.lines[0].y - 10, y1: b.last.y + 2 } }));
}

function splitName(lines) {
  const name = [];
  let i = 0;
  for (; i < lines.length && i < 3; i++) {
    const s = lines[i].s;
    if (i > 0 && (/,|\d/.test(s) || /^(chladen|mrazen|balen|pultov)/i.test(s))) break;
    name.push(s);
  }
  return { name: clean(name.join(" ")), detail: clean(lines.slice(i).map((l) => l.s).join(" ")) };
}

function parsePage(rawItems) {
  const items = dedupe(rawItems);
  const cs = clusters(items);
  const bs = blocks(items);
  const pairs = [];
  cs.forEach((c, ci) => bs.forEach((b, bi) => pairs.push({ ci, bi, d: gap(c.box, b.box) })));
  pairs.sort((a, b) => a.d - b.d);
  const usedC = new Set();
  const usedB = new Set();
  const out = [];
  for (const p of pairs) {
    if (p.d > 70 || usedC.has(p.ci) || usedB.has(p.bi)) continue;
    usedC.add(p.ci);
    usedB.add(p.bi);
    out.push({ ...cs[p.ci], ...splitName(bs[p.bi].lines) });
  }
  return out;
}

/** Strany z PDF -> zľavy v tvare, ktorý číta appka. Nepotravinový tovar sa vynecháva. */
export function parseTesco(pages) {
  const out = [];
  const seen = new Set();
  for (const pg of pages) {
    for (const r of parsePage(pg.items)) {
      r.name = clean(r.name.replace(/\*+/g, ""));
      r.detail = r.detail.replace(/\*+/g, "").replace(/,\s*$/, "").trim();
      // Preskočí zle prečítané "názvy" typu "−", "1 ks = 0,89" alebo "6,29".
      if (!/\p{L}{3}/u.test(r.name) || /=|^\d/.test(r.name) || !(r.price > 0)) continue;
      const text = `${r.name} ${r.detail}`;
      const category = guessCategory(text);
      if (!category && !UNIT.test(text)) continue;
      const key = `${r.name}|${r.price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const deal = { n: r.name.slice(0, 60), p: r.price };
      if (r.detail) deal.d = r.detail.slice(0, 70);
      if (r.old && r.old > r.price) deal.o = r.old;
      if (r.disc) deal.x = r.disc;
      if (category) deal.c = category;
      out.push(deal);
    }
  }
  return out;
}
