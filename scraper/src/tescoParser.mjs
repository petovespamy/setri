// Čítanie PDF letáku Tesca (záložný parser; hlavné čítanie robí AI, tento sa použije, keď AI zlyhá).
//
// Každá ponuka má veľkú cenu (písmo ≥ 17). Tá je "kotva" ponuky: ku každej veľkej cene hľadáme
//   1. značku zľavy "−NN %" a pôvodnú cenu (menšie písmo) – ak ju má,
//   2. blok s názvom a popisom (riadky písma ~8,4) – najbližší voľný blok.
// Ponuka bez značky zľavy (len cena) sa tiež berie, nič sa netratí. Čo sa nedá spárovať, sa nahlási v `lastReport`.
import { guessCategory } from "./parseFlyer.mjs";

const clean = (s) => s.replace(/\s+/g, " ").trim();
function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => {
    const k = `${i.s}|${i.x}|${i.y}|${i.fs}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const DECIMAL = /^\d{1,3},\d{2}$/;
const num = (s) => Number(s.replace(",", "."));
// Cena za kilogram / liter v zátvorke ("(1 kg = 3,58)") nie je súčasť názvu ani popisu.
const UNIT_PRICE = /\(\s*1\s*(kg|l|ks|pd|dávka|dávku)\s*=[^)]*\)/gi;
// Riadky, ktoré nepatria do názvu ani popisu.
const DROP_LINE = /^(bežná cena|s clubcard|s kupónom|cena pre|záloha|1 (kg|l|ks|pd)\s*=|\*|ceny platia|od\b|do\b|alebo do|novinka$)|^\d{1,2}\. \d{1,2}\./i;
const NUMERIC_ONLY = /^([−-]?\d+([.,]\d+)?\s*%?|[−%-]+)$/;

/** Výsledok poslednej kontroly: koľko ponúk sa našlo a čo sa nepodarilo spárovať. */
export const lastReport = { anchors: 0, parsed: 0, unresolved: [] };

const bbox = (arr) => ({
  x0: Math.min(...arr.map((i) => i.x)),
  x1: Math.max(...arr.map((i) => i.x + Math.max(28, i.s.length * i.fs * 0.5))),
  y0: Math.min(...arr.map((i) => i.y - 10)),
  y1: Math.max(...arr.map((i) => i.y + 2)),
});
/**
 * Vzdialenosť ceny a bloku s názvom. Názov býva hneď VPRAVO od ceny, alebo nad/pod ňou; názov vľavo od ceny
 * býva názvom susednej ponuky, preto sa trestá (inak by si susedné ponuky kradli názvy).
 */
const gap = (a, b) => {
  const dy = Math.max(0, b.y0 - a.y1, a.y0 - b.y1);
  if (b.x0 >= a.x1 - 8) return Math.max(0, b.x0 - a.x1) + dy; // názov vpravo od ceny
  if (b.x1 <= a.x0 + 8) return a.x0 - b.x1 + dy + 40;          // názov vľavo od ceny
  return dy;                                                    // názov nad alebo pod cenou
};

/** Všetky ponuky na strane: veľká cena + (nepovinne) značka zľavy a pôvodná cena. */
export function anchors(items) {
  const decimals = items.filter((i) => DECIMAL.test(i.s));
  const bigs = decimals.filter((i) => i.fs >= 17);
  const markers = items.filter((i) => /^[−-]$/.test(i.s) || /^[−-]\s*\d{1,2}\s*%?$/.test(i.s));
  const info = new Map(bigs.map((b) => [b, { price: b, old: null, disc: null, marker: null }]));

  for (const m of markers) {
    let disc;
    if (m.s.length > 1) disc = parseInt(m.s.replace(/\D/g, ""), 10);
    else {
      const n = items
        .filter((i) => /^\d{1,2}%?$/.test(i.s) && i.x - m.x >= -2 && i.x - m.x <= 28 && Math.abs(i.y - m.y) <= 3)
        .sort((a, b) => a.x - b.x)[0];
      if (!n) continue;
      disc = parseInt(n.s, 10);
    }
    const near = decimals.filter((i) => i.x >= m.x - 35 && i.x <= m.x + 70 && i.y - m.y >= -32 && i.y - m.y <= 75);
    const price =
      near.filter((i) => i.fs >= 17 && i.y - m.y >= 3).sort((a, b) => b.fs - a.fs || Math.abs(a.y - m.y) - Math.abs(b.y - m.y))[0] ||
      near.filter((i) => i.fs >= 8.5 && i.y - m.y >= 3).sort((a, b) => b.fs - a.fs)[0];
    if (!price) continue;
    const old = near
      .filter((i) => i !== price && i.fs < price.fs && i.fs >= 7 && i.y <= price.y)
      .sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
    if (!info.has(price)) info.set(price, { price, old: null, disc: null, marker: null });
    const cur = info.get(price);
    // Ak si cenu nárokujú dve značky, ostane bližšia.
    if (cur.marker && Math.hypot(cur.marker.x - price.x, cur.marker.y - price.y) <= Math.hypot(m.x - price.x, m.y - price.y)) continue;
    Object.assign(cur, { old: old ?? null, disc, marker: m });
  }
  return [...info.values()].map((a) => ({
    price: num(a.price.s),
    old: a.old ? num(a.old.s) : null,
    disc: a.disc,
    box: bbox([a.price, a.old, a.marker].filter(Boolean)),
  }));
}

/** Bloky riadkov s názvom a popisom (písmo ~8,4). Do blokov idú aj riadky, ktoré sa potom vyhodia, aby sa blok nerozpadol. */
export function blocks(items) {
  const lines = items.filter((i) => i.fs >= 8.3 && i.fs <= 8.5).sort((a, b) => a.x - b.x || a.y - b.y);
  const out = [];
  for (const l of lines) {
    const b = out.find((g) => Math.abs(g.x - l.x) <= 4 && l.y - g.last.y > 0 && l.y - g.last.y <= 13);
    if (b) {
      b.lines.push(l);
      b.last = l;
    } else out.push({ x: l.x, lines: [l], last: l });
  }
  return out
    .map((b) => {
      const kept = [];
      let afterDeposit = false;
      for (const l of b.lines) {
        const s = clean(l.s.replace(UNIT_PRICE, ""));
        if (!s) continue;
        if (/^záloha/i.test(s)) { afterDeposit = true; continue; }
        if (afterDeposit && /^obal\b/i.test(s)) { afterDeposit = false; continue; }
        afterDeposit = false;
        if (DROP_LINE.test(s) || NUMERIC_ONLY.test(s)) continue;
        kept.push({ ...l, s });
      }
      const hasCouponLine = b.lines.some((l) => /^(s kupónom|s clubcard|\$ clubcard|clubcard)/i.test(l.s.trim()));
      return { x: b.x, lines: kept, hasCouponLine, box: { x0: b.x, x1: b.x + 75, y0: b.lines[0].y - 10, y1: b.last.y + 2 } };
    })
    .filter((b) => b.lines.length);
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

export function parsePage(rawItems) {
  const items = dedupe(rawItems);
  const as = anchors(items);
  const bs = blocks(items);
  const pairs = [];
  as.forEach((a, ai) => bs.forEach((b, bi) => pairs.push({ ai, bi, d: gap(a.box, b.box) })));
  pairs.sort((x, y) => x.d - y.d);
  const usedA = new Set();
  const usedB = new Set();
  const out = [];
  for (const p of pairs) {
    if (p.d > 70 || usedA.has(p.ai) || usedB.has(p.bi)) continue;
    usedA.add(p.ai);
    usedB.add(p.bi);
    out.push({ ...as[p.ai], ...splitName(bs[p.bi].lines), blockIndex: p.bi });
  }
  // Produkt s dvoma cenami (bežná a s kupónom / Clubcard) má jeden názov. Druhá, nižšia cena sa pripojí k tomu istému bloku.
  const lost = [];
  as.forEach((a, ai) => {
    if (usedA.has(ai)) return;
    const best = bs
      .map((b, bi) => ({ b, bi, d: gap(a.box, b.box) }))
      .filter((c) => c.b.hasCouponLine && usedB.has(c.bi) && c.d <= 150)
      .sort((x, y) => x.d - y.d)[0];
    const first = best && out.find((o) => o.blockIndex === best.bi);
    if (first && a.price !== first.price) {
      usedA.add(ai);
      // Nižšia z dvoch cien je cena s kupónom / Clubcard, vyššia je bežná.
      if (a.price < first.price) {
        out.push({ ...a, ...splitName(best.b.lines), blockIndex: best.bi, coupon: true, regularOld: first.old });
      } else {
        Object.assign(first, { coupon: true, regularOld: a.old });
        out.push({ ...a, ...splitName(best.b.lines), blockIndex: best.bi });
      }
    } else lost.push(a);
  });
  return { out, lost, anchors: as.length };
}

/** Strany z PDF -> zľavy v tvare, ktorý číta appka. Výsledok kontroly je v `lastReport`. */
export function parseTesco(pages) {
  const out = [];
  const seen = new Set();
  lastReport.anchors = 0;
  lastReport.parsed = 0;
  lastReport.unresolved = [];
  for (const pg of pages) {
    const { out: found, lost, anchors: n } = parsePage(pg.items);
    lastReport.anchors += n;
    for (const a of lost) lastReport.unresolved.push(`strana ${pg.n}: cena ${a.price} bez názvu`);
    for (const r of found) {
      r.name = clean(r.name.replace(/\*+/g, "")).replace(/^novinka\b[\s:,-]*/i, "");
      r.detail = r.detail.replace(/\*+/g, "").replace(/,\s*$/, "").trim();
      if (!/\p{L}{3}/u.test(r.name) || /=|^\d|^obal\b/i.test(r.name) || !(r.price > 0)) {
        lastReport.unresolved.push(`strana ${pg.n}: cena ${r.price}, názov "${r.name}" nevyzerá správne`);
        continue;
      }
      const key = `${r.name}|${r.price}|${r.old ?? ""}|${r.coupon ? "k" : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const category = guessCategory(`${r.name} ${r.detail}`);
      const deal = { n: r.name.slice(0, 60), p: r.price };
      if (r.detail) deal.d = r.detail.slice(0, 70);
      const old = r.old ?? (r.coupon ? r.regularOld : null);
      if (old && old > r.price) deal.o = old;
      if (r.coupon) deal.q = "s kupónom v aplikácii";
      if (r.disc) deal.x = r.disc;
      if (category) deal.c = category;
      out.push(deal);
    }
  }
  lastReport.parsed = out.length;
  return out;
}
