// Čítanie PDF letáku Kraj potravín (Publitas). Karta zľavy: cena ("0,89", veľké písmo), pôvodná cena (menšia),
// "-NN %" a názov (VEĽKÝMI písmenami, písmo ~10) s údajom o balení (písmo ~8). Názvy priradíme k cenám
// optimálnym spárovaním podľa vzdialenosti, lebo ich poloha vzhľadom na cenu sa na stránkach mení.
import { guessCategory } from "./parseFlyer.mjs";

const clean = (s) => s.replace(/\s+/g, " ").trim();
const UNIT = /\b\d+([.,]\d+)?\s*(g|kg|ml|l|ks|cl)\b/i;
const BAD_NAME = /^(1 (kg|l)\b|pre držiteľov|bio$|cena s|tento propag|karta$)|=|^\d/i;
const PRICE = /^\d{1,3},\d{2}$/;

function hungarian(cost) {
  const n = cost.length, m = cost[0].length, INF = 1e9;
  const u = Array(n + 1).fill(0), v = Array(m + 1).fill(0), p = Array(m + 1).fill(0), way = Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(m + 1).fill(INF), used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const res = Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
  return res;
}

const num = (s) => Number(s.replace(",", "."));

function parsePage(raw) {
  // duplicity (text vykreslený dvakrát kvôli tieňu)
  const seenKey = new Set();
  const items = raw.filter((i) => {
    const k = `${i.s}|${i.x}|${i.y}|${i.fs}`;
    if (seenKey.has(k)) return false;
    seenKey.add(k);
    return true;
  });

  const prices = items.filter((i) => PRICE.test(i.s));
  const mains = prices.filter((i) => i.fs >= 20);
  const olds = prices.filter((i) => i.fs >= 6 && i.fs < 20);
  const discs = items.filter((i) => /^-\s?\d{1,2}$/.test(i.s) && i.fs >= 12);
  if (!mains.length) return [];

  const near = (arr, m, maxDist) =>
    arr
      .map((a) => ({ a, d: Math.hypot(a.x - m.x, a.y - m.y) }))
      .filter((t) => t.d <= maxDist)
      .sort((p, q) => p.d - q.d)[0]?.a;

  // riadky textu názvu (~10) a údajov o balení (~8)
  const lines = items
    .filter((i) => i.fs >= 7.4 && i.fs <= 10.6 && /\p{L}{2}|\d\s?(g|kg|ml|l|ks)/iu.test(i.s) && !PRICE.test(i.s))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const cx = (l) => l.x + l.s.length * (l.fs >= 9.5 ? 3 : 2.3);
  const blocks = [];
  for (const l of lines) {
    const b = blocks.find((g) => {
      const dy = l.y - g.last.y;
      return dy > 2 && dy <= 14 && Math.abs(cx(l) - cx(g.last)) <= 70;
    });
    if (b) { b.lines.push(l); b.last = l; } else blocks.push({ lines: [l], last: l });
  }
  const bl = blocks.filter((b) => b.lines.some((l) => l.fs >= 9.5 && /\p{Lu}{2}/u.test(l.s)));
  if (!bl.length) return [];
  for (const b of bl) {
    b.cx = b.lines.reduce((s, l) => s + cx(l), 0) / b.lines.length;
    b.cy = b.lines.reduce((s, l) => s + l.y, 0) / b.lines.length;
  }

  const cards = mains.map((m) => {
    const o = near(olds.filter((x) => num(x.s) > num(m.s)), m, 55);
    const d = near(discs, m, 70);
    return { m, price: num(m.s), old: o ? num(o.s) : null, disc: d ? Math.abs(parseInt(d.s.replace(/\s/g, ""), 10)) : null };
  });

  const dist = (c, b) => Math.hypot((b.cx - (c.m.x + 12)) * 0.85, b.cy - c.m.y);
  const cost = cards.map((c) => bl.map((b) => dist(c, b)));
  const MAX = 130;
  const pairs = [];
  if (cards.length <= bl.length) {
    hungarian(cost).forEach((j, i) => j >= 0 && cost[i][j] <= MAX && pairs.push([cards[i], bl[j]]));
  } else {
    const t = bl.map((_, j) => cards.map((__, i) => cost[i][j]));
    hungarian(t).forEach((i, j) => i >= 0 && cost[i][j] <= MAX && pairs.push([cards[i], bl[j]]));
  }
  return pairs.map(([c, b]) => ({ ...c, raw: clean(b.lines.map((l) => l.s).join(" ")) }));
}

const titleCase = (s) =>
  s.toLowerCase().replace(/(^|[\s(\/-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());

function splitNameDetail(raw) {
  const s = clean(
    raw
      .replace(/1\s?(kg|l|ks|g)\s?=\s?[\d, ]+€?/gi, "")
      .replace(/\s*[–-]\s*\d[\d, ]*€/g, "")
      .replace(/\s+,/g, ",")
  );
  const m = s.match(/\s(\d+(?:[.,]\d+)?(?:\s?-\s?\d+(?:[.,]\d+)?)?\s?(?:g|kg|ml|l|ks|cl)\b.*|1\s?(?:kg|l|ks)\b.*)$/i);
  if (m && m.index > 2) return { name: s.slice(0, m.index).trim(), detail: s.slice(m.index).trim() };
  return { name: s, detail: "" };
}

/** Strany z PDF -> zľavy v tvare, ktorý číta appka. */
export function parseKraj(pages) {
  const byKey = new Map();
  for (const pg of pages) {
    for (const r of parsePage(pg.items)) {
      const { name: rawName, detail } = splitNameDetail(r.raw);
      if (rawName.length < 4 || BAD_NAME.test(rawName) || !(r.price > 0)) continue;
      const name = titleCase(rawName);
      const text = `${name} ${detail}`;
      const category = guessCategory(text);
      if (!category && !UNIT.test(text)) continue;
      const deal = { n: name.slice(0, 60), p: r.price };
      if (detail) deal.d = detail.slice(0, 70);
      if (r.old && r.old > r.price) deal.o = r.old;
      const disc = r.disc || (r.old && r.old > r.price ? Math.round((1 - r.price / r.old) * 100) : null);
      if (disc) deal.x = disc;
      if (category) deal.c = category;
      // ten istý produkt s dvoma cenami (bežná a s kartou): nechaj nižšiu
      const prev = byKey.get(name);
      if (!prev || deal.p < prev.p) byKey.set(name, deal);
    }
  }
  return [...byKey.values()];
}
