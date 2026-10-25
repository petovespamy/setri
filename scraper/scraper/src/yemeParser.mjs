// YEME (e-shop): akcie sú v sekcii "Hrdinovia" priamo v HTML (bez PDF). Stránka ukazuje v každej kategórii
// len prvých 12 produktov, preto prechádzame kategórie a podkategórie, kým nemáme všetky.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const BASE = "https://www.yeme.sk";

const clean = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();
const num = (s) => Number(s.replace(/\s/g, "").replace(",", "."));

export function parseCards(html) {
  const out = [];
  for (const m of html.matchAll(/<article class="b-product"[\s\S]*?<\/article>/g)) {
    const a = m[0];
    const id = a.match(/data-product-id="(\d+)"/)?.[1];
    const title = a.match(/b-product__title">[\s\S]*?<a[^>]*>\s*([^<]+?)\s*<\/a>/)?.[1];
    const old = a.match(/btn__discount">\s*([\d ,]+?)\s*(?:€|&euro;)/)?.[1];
    const price = a.match(/<\/span>\s*([\d ,]+?)\s*<span class="btn__unit">/)?.[1];
    const unit = a.match(/btn__unit">\s*(?:€|&euro;)\s*\/\s*([^<]+?)\s*</)?.[1];
    const supplier = a.match(/b-product__supplier[^>]*>\s*([^<]+?)\s*</)?.[1];
    if (!id || !title || !price) continue;
    out.push({
      id,
      title: clean(title),
      price: num(price),
      old: old ? num(old) : null,
      unit: unit ? clean(unit) : "",
      supplier: supplier ? clean(supplier) : "",
    });
  }
  return out;
}

/** Hlavičky sekcií: názov, počet produktov v kategórii, odkaz a koľko kariet je už na tejto stránke. */
export function parseSections(html) {
  const parts = html.split('class="crossroad-header"').slice(1);
  return parts.map((p) => {
    const head = p.slice(0, 900);
    const text = clean(head.replace(/<[^>]+>/g, " "));
    const total = Number(text.match(/\((\d+)\)/)?.[1] ?? 0);
    const href = head.match(/href="(\/[^"]+-c\d+)"/)?.[1];
    const shown = (p.match(/<article class="b-product"/g) || []).length;
    return { total, href, shown };
  });
}

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "sk-SK,sk;q=0.9" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** Všetky akciové produkty zo sekcie Hrdinovia. */
export async function crawlHeroes() {
  const products = new Map();
  const visited = new Set();
  async function visit(path, depth) {
    if (visited.has(path) || depth > 4) return;
    visited.add(path);
    const html = await get(BASE + path);
    for (const c of parseCards(html)) products.set(c.id, c);
    for (const s of parseSections(html)) {
      if (s.href && s.total > s.shown) await visit(`/hrdinovia${s.href}`, depth + 1);
    }
  }
  await visit("/hrdinovia", 0);
  return [...products.values()];
}
