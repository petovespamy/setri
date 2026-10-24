import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Prečíta PDF a vráti pre každú stranu zoznam textov s polohou a veľkosťou písma.
 * Súradnice: x zľava, y zhora (v bodoch PDF).
 */
export async function readPdfPages(buffer) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const height = page.view[3];
    const content = await page.getTextContent();
    const items = content.items
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({
        s: i.str.trim(),
        x: Math.round(i.transform[4]),
        y: Math.round(height - i.transform[5]),
        fs: Math.round(Math.abs(i.transform[0]) * 10) / 10,
      }));
    pages.push({ n, items });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}
