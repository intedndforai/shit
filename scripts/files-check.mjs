/**
 * Attachment pipeline checks (Milestone 4).
 *
 * Builds fixtures in memory — plain text, CSV, PNG, a minimal PDF and .docx,
 * plus a real .xlsx via SheetJS — uploads them to /api/files, and asserts the
 * extracted payload that the model would receive.
 *
 *   node scripts/files-check.mjs [appUrl]
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const appUrl = process.argv[2] ?? "http://localhost:3000";
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function upload(name, mime, bytes) {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: mime }));
  const response = await fetch(`${appUrl}/api/files`, { method: "POST", body: form });
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  return { status: response.status, body };
}

/** A tiny but structurally valid single-page PDF with correct xref offsets. */
function minimalPdf(text) {
  const parts = [];
  const offsets = [];
  let cursor = 0;
  const push = (chunk) => {
    parts.push(chunk);
    cursor += Buffer.byteLength(chunk, "latin1");
  };

  push("%PDF-1.4\n");
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length + 40} >>\nstream\nBT /F1 18 Tf 20 120 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  bodies.forEach((body, index) => {
    offsets.push(cursor);
    push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefStart = cursor;
  let xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  push(xref);

  return Buffer.from(parts.join(""), "latin1");
}

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** Minimal stored-entry .docx writer (enough for mammoth to read text). */
function minimalDocx(text) {
  const entries = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: "word/document.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    },
  ];

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

const txt = await upload("notes.txt", "text/plain", new TextEncoder().encode("Hello conduit attachment body"));
check("text upload stored", txt.status === 201 && txt.body?.file?.kind === "text", txt.body?.file?.kind);
check("text is extracted", String(txt.body?.file?.text ?? "").includes("conduit attachment"));

const csv = await upload("table.csv", "text/csv", new TextEncoder().encode("name,qty\nwidget,4\n"));
check("csv classified as a spreadsheet", csv.status === 201 && csv.body?.file?.kind === "spreadsheet", csv.body?.file?.kind);

const png = await upload("pixel.png", "image/png", Buffer.from(PNG_1X1, "base64"));
check(
  "image upload returns a data url",
  png.status === 201 && String(png.body?.file?.dataUrl ?? "").startsWith("data:image/png;base64,"),
  png.body?.file?.kind
);

const pdf = await upload("hello.pdf", "application/pdf", minimalPdf("Hello PDF attachment"));
check(
  "pdf text extraction",
  pdf.status === 201 && String(pdf.body?.file?.text ?? "").includes("Hello PDF"),
  String(pdf.body?.file?.text ?? pdf.body?.error ?? "").slice(0, 48)
);

const docx = await upload(
  "report.docx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  minimalDocx("Conduit reads Word documents")
);
check(
  "docx text extraction",
  docx.status === 201 && String(docx.body?.file?.text ?? "").includes("Conduit reads Word"),
  String(docx.body?.file?.text ?? docx.body?.error ?? "").slice(0, 48)
);

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["name", "qty"], ["widget", 4]]), "Sheet1");
const sheet = await upload(
  "book.xlsx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })
);
check(
  "xlsx becomes markdown table text",
  sheet.status === 201 && String(sheet.body?.file?.text ?? "").includes("| widget | 4 |"),
  String(sheet.body?.file?.text ?? sheet.body?.error ?? "").slice(0, 48)
);

const unsupported = await upload("archive.bin", "application/octet-stream", new Uint8Array([1, 2, 3]));
check("unsupported type rejected with 415", unsupported.status === 415, String(unsupported.body?.error ?? "").slice(0, 48));

if (txt.body?.file?.id) {
  const fetched = await fetch(`${appUrl}/api/files/${txt.body.file.id}`);
  const served = await fetched.text();
  check(
    "stored bytes are served back",
    fetched.status === 200 && served.includes("conduit attachment"),
    fetched.headers.get("content-type") ?? ""
  );
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} attachment checks passed`);
process.exitCode = failed ? 1 : 0;