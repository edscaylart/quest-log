import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Each page's text, joined by spaces. */
export async function pdfPages(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes.slice() }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  return pages;
}
