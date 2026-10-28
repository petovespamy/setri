// Podmienky, za ktorých zľava platí (napr. "pri kúpe od 2 ks", "Kúp 2 za 1").
// Billa ich dostáva od AI; pre ostatné obchody ich odvodíme z textu ponuky.

const RULES = [
  // "kúp 2 za 1", "kup 3 za 2"
  [/k[úu]p\s*(\d)\s*za\s*(\d)/i, (m) => `Kúp ${m[1]} za ${m[2]}`],
  // "1/2 ceny", "1/2 CENA!"
  [/\b1\s*\/\s*2\s*cen/i, () => "1/2 ceny"],
  // "za kus pri kúpe 2 KS", "pri kúpe od 2 ks", "pri kúpe 4 ks"
  [/pri\s+k[úu]pe\s*(?:od\s*)?(\d+)\s*ks/i, (m) => `pri kúpe ${/od\s*\d/i.test(m[0]) ? "od " : ""}${m[1]} ks`],
  // "od 2 ks" (cena za kus platí od určitého počtu)
  [/\bod\s*(\d+)\s*ks\b/i, (m) => `od ${m[1]} ks`],
  // "2 + 1 zadarmo", "3+1 grátis"
  [/(\d)\s*\+\s*(\d)\s*(?:zdarma|gr[áa]tis|gratis)/i, (m) => `${m[1]} + ${m[2]} zadarmo`],
];

/** Z textu vyberie podmienky v poradí, v akom sú pravidlá; vráti reťazec alebo undefined. */
export function conditionFromText(text) {
  const found = [];
  for (const [re, make] of RULES) {
    const m = String(text ?? "").match(re);
    if (!m) continue;
    const c = make(m);
    // "pri kúpe od 2 ks" a "od 2 ks" sú to isté – nepridávame dvakrát.
    if (!found.some((f) => f.includes(c) || c.includes(f))) found.push(c);
  }
  return found.length ? found.join(", ").slice(0, 60) : undefined;
}

/** Doplní deal.q, ak chýba, z názvu a popisu ponuky. Vráti true, ak sa niečo zmenilo. */
export function fillCondition(deal) {
  if (deal.q) return false;
  const c = conditionFromText(`${deal.n ?? ""} ${deal.d ?? ""}`);
  if (!c) return false;
  deal.q = c;
  return true;
}

const QUANTITY = /pri\s+k[úu]pe|\bod\s*\d+\s*(?:ks|bal)|k[úu]p\s*\d\s*za\s*\d|\d\s*\+\s*\d|1\s*\/\s*2\s*cen/i;
const CARD_OR_BONUS = /bonus|kart|kup[óo]n|\bkup\b|aplik[áa]ci|klub|bez\s+kup/i;

/**
 * Pri podmienke na počet kusov ("pri kúpe od 2 ks") nepíšeme, že sa viaže na kartu alebo bonus.
 * Podmienky bez počtu kusov (napr. "s BILLA Bonus") a ostatné informácie ostávajú tak, ako sú.
 */
export function cleanCondition(q) {
  if (!q || !QUANTITY.test(q)) return q;
  const parts = String(q).split(/[;,()]/).map((p) => p.trim()).filter(Boolean);
  const kept = [];
  for (const part of parts) {
    if (!CARD_OR_BONUS.test(part)) {
      kept.push(part);
    } else if (QUANTITY.test(part)) {
      // Jedna časť obsahuje obe informácie: necháme len počet kusov.
      const only = conditionFromText(part);
      if (only) kept.push(only);
    }
  }
  const out = [...new Set(kept)].join(", ").slice(0, 60);
  return out || q;
}

/** Očistí deal.q (pozri cleanCondition). Vráti true, ak sa niečo zmenilo. */
export function tidyCondition(deal) {
  if (!deal.q) return false;
  const cleaned = cleanCondition(deal.q);
  if (cleaned === deal.q) return false;
  deal.q = cleaned;
  return true;
}
