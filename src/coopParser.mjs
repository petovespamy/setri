// COOP Jednota: leták je publikovaný cez Adobe InDesign a jeho textové rámce (content.json) idú v poradí
// názov -> cena (v centoch, napr. "249" = 2,49) -> zľava ("46%").
import { guessCategory } from "./parseFlyer.mjs";

const UNIT = /\b\d+([.,]\d+)?\s*(g|kg|ml|l|ks|cl)\b|1 bal\./i;
const SKIP = /^(zľava|super výhodne|ilustračné foto|nad cenovkou|ceny niektorých|\d{1,3})$|^nad cenovkou|^ceny niektorých|^\*+/i;

const SKIP_NAME = /náhrobn|kahanec|chryzant|kvetin|sviečk|vresov|hrob/i;

const clean = (s) => s.replace(/\s+/g, " ").trim();

function frameText(frame) {
  return clean(
    (frame.textBoundary || [])
      .flat()
      .map((t) => t[0])
      .join("")
      .replace(/\u0007/g, " ")
  );
}

function splitNameDetail(raw) {
  let s = clean(raw.replace(/jednotková cena.*$/i, "").replace(/ilustračné foto/gi, ""));
  const m = s.match(/\s(\d+(?:[.,]\d+)?\s?(?:g|kg|ml|l|ks|cl)\b|\d+\s?x\s?\d|zväzok|od \d)/i);
  if (m && m.index > 2) return { name: s.slice(0, m.index).trim(), detail: s.slice(m.index).trim() };
  return { name: s, detail: "" };
}

/** content.json -> zľavy v tvare, ktorý číta appka. */
export function parseCoop(content) {
  const deals = [];
  const seen = new Set();
  for (const group of content.framesData) {
    let pending = null;
    let last = null;
    for (const frame of group.frameData) {
      const t = frameText(frame);
      if (!t) continue;
      if (/^\d{3,4}$/.test(t)) {
        if (pending) {
          last = { ...splitNameDetail(pending), price: Number(t) / 100 };
          pending = null;
          deals.push(last);
        }
      } else if (/^\d{1,2}\s?%$/.test(t)) {
        if (last && !last.disc) last.disc = parseInt(t, 10);
      } else if (!SKIP.test(t) && /\p{L}{3}/u.test(t)) {
        pending = t;
        last = null;
      }
    }
  }
  const out = [];
  for (const d of deals) {
    if (!d.name || d.name.length < 3 || !(d.price > 0) || SKIP_NAME.test(d.name)) continue;
    const text = `${d.name} ${d.detail}`;
    const category = guessCategory(text);
    if (!category && !UNIT.test(text)) continue;
    const key = `${d.name}|${d.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const deal = { n: d.name.slice(0, 60), p: d.price };
    if (d.detail) deal.d = d.detail.slice(0, 70);
    if (d.disc) deal.x = d.disc;
    if (category) deal.c = category;
    out.push(deal);
  }
  return out;
}
