// Builds submission/Dibs-writeup.pdf from docs/WRITEUP.md. One command, no dependencies, no network:
//   node submission/build-writeup.mjs        (set CHROME=<path> if Chrome is not at the macOS default)
// Renders HTML with headless Chrome (--print-to-pdf), then counts the pages in the PDF itself and fails above 6.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = new URL(".", import.meta.url);
const md = readFileSync(new URL("../docs/WRITEUP.md", here), "utf8");
const MAX_PAGES = 6;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(raw) {
  const codes = [];
  let s = esc(raw).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="key">$1</span>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/==([^=]+)==/g, '<span class="hl">$1</span>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(?<![">=])(https?:\/\/[^\s<)]*[^\s<).,])/g, '<a href="$1">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

function render(src) {
  const lines = src.split("\n");
  const out = [];
  let i = 0, titleDone = false;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith("# ")) {
      out.push(`<h1>${inline(l.slice(2))}</h1>`); i++;
      if (!titleDone) { titleDone = true; out.push(`<p class="hand tag">${inline(lines[i + 1] ?? "")}</p>`); i += 2; }
    } else if (l.startsWith("## ")) { out.push(`<h2><span>${inline(l.slice(3))}</span></h2>`); i++; }
    else if (l.startsWith("> ")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("> ")) rows.push(inline(lines[i++].slice(2)));
      out.push(`<div class="box">${rows.map((r) => `<p>${r}</p>`).join("")}</div>`);
    } else if (l.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++].split("|").slice(1, -1).map((c) => c.trim()));
      const [head, , ...body] = rows;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table>`);
    } else if (l.startsWith("- ")) {
      const items = [];
      while (i < lines.length && lines[i].startsWith("- ")) items.push(inline(lines[i++].slice(2)));
      out.push(`<ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>`);
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#|>|\||- )/.test(lines[i])) para.push(lines[i++]);
      out.push(`<p>${inline(para.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dibs - write-up</title>
<style>
  @page { size: A4; margin: 13mm 15mm; background: #fbf8f0; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Archivo, "Helvetica Neue", Arial, sans-serif; color: #111; background: #fbf8f0; font-size: 9.8pt; line-height: 1.38; margin: 0; }
  .hand { font-family: "Patrick Hand", "Marker Felt", "Bradley Hand", cursive; }
  h1 { font-family: "Patrick Hand", "Marker Felt", "Bradley Hand", cursive; font-size: 38pt; font-weight: 700; margin: 0; line-height: 1; letter-spacing: -0.5pt; }
  .tag { font-size: 16pt; margin: 1.5mm 0 3mm; }
  h2 { font-size: 13pt; font-weight: 800; margin: 5mm 0 1.8mm; break-after: avoid; }
  h2 span, .hl { background: linear-gradient(transparent 55%, #c8ff00 55%, #c8ff00 92%, transparent 92%); padding: 0 1mm; }
  .tag .hl { padding: 0 0.3mm; }
  p { margin: 0 0 2.2mm; orphans: 3; widows: 3; }
  ul { margin: 0 0 2.4mm; padding-left: 5mm; } li { margin-bottom: 0.9mm; }
  code { font-family: "JetBrains Mono", Menlo, monospace; font-size: 8.6pt; background: #efe9d8; padding: 0 0.8mm; }
  a { color: #d6166f; text-decoration: none; word-break: break-all; }
  b { font-weight: 800; }
  .box { border: 0.7mm solid #111; border-radius: 4mm 1.5mm 4mm 1.5mm / 1.5mm 4mm 1.5mm 4mm; padding: 2.5mm 4mm 0.5mm; margin: 3mm 0; box-shadow: 1.2mm 1.2mm 0 #ff2e93; background: #fff; break-inside: avoid; }
  .box p { margin-bottom: 1.8mm; }
  .key { font-family: "JetBrains Mono", Menlo, monospace; font-weight: 700; font-size: 11pt; background: #c8ff00; padding: 0.3mm 1.8mm; border: 0.4mm solid #111; }
  table { border-collapse: collapse; width: 100%; margin: 2mm 0 3mm; font-size: 8.6pt; background: #fff; }
  tr { break-inside: avoid; }
  th, td { border-bottom: 0.25mm solid #111; padding: 1.1mm 1.8mm; text-align: left; vertical-align: top; }
  th { font-family: "Patrick Hand", "Marker Felt", "Bradley Hand", cursive; font-size: 10.5pt; font-weight: 700; border-bottom: 0.6mm solid #111; }
</style></head><body>
${render(md)}
</body></html>`;

const htmlPath = tmpdir() + "/Dibs-writeup.html"; // intermediate file stays out of the repo
const pdfPath = fileURLToPath(new URL("Dibs-writeup.pdf", here));
writeFileSync(htmlPath, html);

const chrome = process.env.CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
if (!chrome) throw new Error("Chrome not found. Set CHROME=<path to Chrome or Chromium>.");
execFileSync(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, "file://" + htmlPath], { stdio: "ignore", timeout: 90_000 });

const pages = (readFileSync(pdfPath, "latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
console.log(`wrote ${pdfPath}\npages: ${pages} (limit ${MAX_PAGES})`);
if (pages > MAX_PAGES) { console.error("Too many pages."); process.exit(1); }
