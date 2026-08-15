import { strFromU8, strToU8, unzipSync, zipSync, type UnzipFileInfo } from "fflate";

export const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const MAX_DOCX_BYTES = 5_000_000;
const MAX_DOCX_ENTRY_BYTES = 5_000_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 20_000_000;
const MAX_DOCX_ENTRIES = 256;
const MAX_DOCX_TEXT_CHARACTERS = 120_000;
const MAX_SECTIONS = 20;
const MAX_BLOCKS = 80;
const MAX_TABLE_ROWS = 100;
const MAX_TABLE_COLUMNS = 8;
const TABLE_WIDTH_DXA = 9_360;
const TABLE_MIN_COLUMN_DXA = 900;
const FIXED_ZIP_TIME = new Date("1980-01-01T00:00:00.000Z");

export interface DocxArtifactMetadataRow {
  label: string;
  value: string;
}

export interface DocxParagraphBlock {
  type: "paragraph";
  text: string;
}

export interface DocxBulletListBlock {
  type: "bullets";
  items: readonly string[];
}

export interface DocxTableBlock {
  type: "table";
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}

export type DocxArtifactBlock = DocxParagraphBlock | DocxBulletListBlock | DocxTableBlock;

export interface DocxArtifactSection {
  heading: string;
  blocks: readonly DocxArtifactBlock[];
}

export interface DocxArtifactSpec {
  version: 1;
  title: string;
  subtitle?: string;
  metadata?: readonly DocxArtifactMetadataRow[];
  revisionNote?: string;
  sections: readonly DocxArtifactSection[];
}

export interface DocxArtifactInspection {
  version: 1;
  title?: string;
  text: string;
  paragraphCount: number;
  sectionCount: number;
  tableCount: number;
  tableRowCount: number;
}

export function normalizeDocxArtifactSpec(input: unknown): DocxArtifactSpec {
  const root = expectObject(input, "DOCX document");
  if (root.version !== 1) throw new Error("DOCX document version must be 1");
  const title = boundedText(root.title, "DOCX title", 200);
  const subtitle = optionalBoundedText(root.subtitle, "DOCX subtitle", 500);
  const revisionNote = optionalBoundedText(root.revisionNote, "DOCX revision note", 2_000);
  const metadata = normalizeMetadata(root.metadata);
  if (!Array.isArray(root.sections) || root.sections.length < 1 || root.sections.length > MAX_SECTIONS) {
    throw new Error(`DOCX sections must contain between 1 and ${MAX_SECTIONS} entries`);
  }
  let blockCount = 0;
  const sections = root.sections.map((value, sectionIndex) => {
    const section = expectObject(value, `DOCX sections[${sectionIndex}]`);
    const heading = boundedText(section.heading, `DOCX sections[${sectionIndex}].heading`, 200);
    if (!Array.isArray(section.blocks) || section.blocks.length < 1) {
      throw new Error(`DOCX sections[${sectionIndex}].blocks must be a non-empty array`);
    }
    blockCount += section.blocks.length;
    if (blockCount > MAX_BLOCKS) throw new Error(`DOCX document exceeds the ${MAX_BLOCKS}-block limit`);
    return {
      heading,
      blocks: section.blocks.map((block, blockIndex) =>
        normalizeBlock(block, `DOCX sections[${sectionIndex}].blocks[${blockIndex}]`)),
    } satisfies DocxArtifactSection;
  });
  const normalized = {
    version: 1 as const,
    title,
    ...(subtitle === undefined ? {} : { subtitle }),
    ...(metadata.length === 0 ? {} : { metadata }),
    ...(revisionNote === undefined ? {} : { revisionNote }),
    sections,
  };
  if (docxArtifactText(normalized).length > MAX_DOCX_TEXT_CHARACTERS) {
    throw new Error(`DOCX document exceeds the ${MAX_DOCX_TEXT_CHARACTERS}-character text limit`);
  }
  return normalized;
}

export function buildDocxArtifact(input: unknown): Buffer {
  const spec = normalizeDocxArtifactSpec(input);
  const files = {
    "[Content_Types].xml": encoded(contentTypesXml()),
    "_rels/.rels": encoded(packageRelationshipsXml()),
    "docProps/app.xml": encoded(appPropertiesXml()),
    "docProps/core.xml": encoded(corePropertiesXml()),
    "word/document.xml": encoded(documentXml(spec)),
    "word/_rels/document.xml.rels": encoded(documentRelationshipsXml()),
    "word/fontTable.xml": encoded(fontTableXml()),
    "word/footer1.xml": encoded(footerXml()),
    "word/numbering.xml": encoded(numberingXml()),
    "word/settings.xml": encoded(settingsXml()),
    "word/styles.xml": encoded(stylesXml()),
  };
  const result = Buffer.from(zipSync(files, { level: 6, mtime: FIXED_ZIP_TIME }));
  if (result.length > MAX_DOCX_BYTES) {
    throw new Error(`generated DOCX exceeds the ${MAX_DOCX_BYTES}-byte limit`);
  }
  const inspection = inspectDocxArtifact(result);
  const expectedText = docxArtifactText(spec);
  if (inspection.text !== expectedText) {
    throw new Error("generated DOCX failed its structural round-trip check");
  }
  return result;
}

export function docxArtifactSpecFromMarkdown(input: unknown): DocxArtifactSpec {
  const markdown = boundedText(input, "DOCX Markdown content", MAX_DOCX_TEXT_CHARACTERS);
  const lines = markdown.split("\n");
  const titleIndex = lines.findIndex((line) => line.trim().length > 0);
  const titleMatch = titleIndex < 0 ? undefined : /^#\s+(.+)$/u.exec(lines[titleIndex]!.trim());
  if (titleMatch?.[1] === undefined) {
    throw new Error("DOCX Markdown must begin with one # title");
  }
  const title = cleanMarkdownText(titleMatch[1]);
  const sections: DocxArtifactSection[] = [];
  let heading = "正文";
  let sectionLines: string[] = [];
  let sawExplicitSection = false;
  const flush = () => {
    const blocks = markdownSectionBlocks(sectionLines);
    if (blocks.length > 0) sections.push({ heading, blocks });
    sectionLines = [];
  };
  for (const line of lines.slice(titleIndex + 1)) {
    const sectionMatch = /^##\s+(.+)$/u.exec(line.trim());
    if (sectionMatch?.[1] !== undefined) {
      flush();
      heading = cleanMarkdownText(sectionMatch[1]);
      sawExplicitSection = true;
      continue;
    }
    sectionLines.push(line);
  }
  flush();
  if (sections.length === 0) {
    throw new Error("DOCX Markdown must contain body content");
  }
  if (!sawExplicitSection && sections[0]?.heading !== "正文") {
    throw new Error("DOCX Markdown section parsing failed");
  }
  return normalizeDocxArtifactSpec({ version: 1, title, sections });
}

export function inspectDocxArtifact(content: Uint8Array): DocxArtifactInspection {
  if (content.length < 4 || content.length > MAX_DOCX_BYTES) {
    throw new Error(`DOCX package must contain between 4 and ${MAX_DOCX_BYTES} bytes`);
  }
  if (content[0] !== 0x50 || content[1] !== 0x4b) {
    throw new Error("DOCX package must be a ZIP archive");
  }
  const required = new Set([
    "[Content_Types].xml",
    "word/document.xml",
    "word/_rels/document.xml.rels",
  ]);
  let entryCount = 0;
  let totalOriginalSize = 0;
  const seen = new Set<string>();
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(content, {
      filter(file: UnzipFileInfo) {
        validateDocxEntry(file.name);
        entryCount += 1;
        if (entryCount > MAX_DOCX_ENTRIES) {
          throw new Error(`DOCX package exceeds the ${MAX_DOCX_ENTRIES}-entry limit`);
        }
        if (seen.has(file.name)) throw new Error(`DOCX package contains a duplicate entry: ${file.name}`);
        seen.add(file.name);
        if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0
          || file.originalSize > MAX_DOCX_ENTRY_BYTES) {
          throw new Error(`DOCX entry exceeds the ${MAX_DOCX_ENTRY_BYTES}-byte limit: ${file.name}`);
        }
        totalOriginalSize += file.originalSize;
        if (totalOriginalSize > MAX_DOCX_UNCOMPRESSED_BYTES) {
          throw new Error(`DOCX package exceeds the ${MAX_DOCX_UNCOMPRESSED_BYTES}-byte expanded limit`);
        }
        rejectUnsupportedDocxEntry(file.name);
        return required.has(file.name)
          || file.name.endsWith(".rels")
          || /^word\/footer\d+\.xml$/u.test(file.name);
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("DOCX ")) throw error;
    throw new Error("DOCX package could not be safely decompressed", { cause: error });
  }
  const contentTypes = requiredXml(archive, "[Content_Types].xml");
  if (contentTypes.includes("macroEnabled") || contentTypes.includes("vbaProject")) {
    throw new Error("DOCX macro-enabled packages are not supported");
  }
  if (!contentTypes.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")) {
    throw new Error("DOCX package is missing the standard Word document content type");
  }
  for (const [name, value] of Object.entries(archive)) {
    if (!name.endsWith(".rels")) continue;
    const relationships = strFromU8(value);
    if (/\bTargetMode\s*=/iu.test(relationships)) {
      throw new Error(`DOCX external relationships are not supported: ${name}`);
    }
    for (const match of relationships.matchAll(/\bTarget\s*=\s*["']([^"']+)["']/giu)) {
      const target = decodeXml(match[1] ?? "").trim();
      if (
        target.length === 0
        || target.startsWith("/")
        || target.includes("\\")
        || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target)
        || target.split("/").some((segment) => segment === "." || segment === "..")
      ) {
        throw new Error(`DOCX relationship contains an unsafe target: ${name}`);
      }
    }
  }
  for (const [name, value] of Object.entries(archive)) {
    if (!/^word\/footer\d+\.xml$/u.test(name)) continue;
    if (/<w:t\b[^>]*>[\s\S]*?\S[\s\S]*?<\/w:t>/iu.test(strFromU8(value))) {
      throw new Error(`DOCX footer text is not supported: ${name}`);
    }
  }
  const document = requiredXml(archive, "word/document.xml");
  const wordNamespaceBindings = [...document.matchAll(/xmlns:([A-Za-z_][\w.-]*)=["']http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main["']/giu)]
    .map((match) => match[1]);
  if (wordNamespaceBindings.length !== 1 || wordNamespaceBindings[0] !== "w") {
    throw new Error("DOCX document.xml must use one standard WordprocessingML namespace binding");
  }
  if (/<(?:w:altChunk|w:ins|w:del|w:moveFrom|w:moveTo|w:drawing|w:object|w:pict|w:txbxContent|w:sdt|w:customXml|w:subDoc|w:smartTag|w:hyperlink|w:fldSimple|w:fldChar|w:instrText|w:vanish|w:webHidden|mc:AlternateContent)\b/iu.test(document)) {
    throw new Error("DOCX contains unsupported rich, revision, or embedded content");
  }
  return extractDocumentInspection(document);
}

export function docxArtifactText(input: DocxArtifactSpec): string {
  const lines: string[] = [`# ${input.title}`];
  if (input.subtitle !== undefined) lines.push(input.subtitle);
  for (const row of input.metadata ?? []) lines.push(`${row.label}: ${row.value}`);
  for (const section of input.sections) {
    lines.push(`## ${section.heading}`);
    for (const block of section.blocks) {
      if (block.type === "paragraph") {
        lines.push(block.text);
      } else if (block.type === "bullets") {
        lines.push(...block.items.map((item) => `- ${item}`));
      } else {
        lines.push(block.columns.join("\t"));
        lines.push(...block.rows.map((row) => row.join("\t")));
      }
    }
  }
  if (input.revisionNote !== undefined) lines.push("## 本轮修改说明", input.revisionNote);
  return lines.join("\n");
}

function markdownSectionBlocks(lines: readonly string[]): DocxArtifactBlock[] {
  const blocks: DocxArtifactBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (line.length === 0) {
      index += 1;
      continue;
    }
    if (isMarkdownTableStart(lines, index)) {
      const columns = markdownTableCells(lines[index]!);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.trim().startsWith("|")) {
        const cells = markdownTableCells(lines[index]!);
        if (cells.length !== columns.length) {
          throw new Error(`DOCX Markdown table row must contain exactly ${columns.length} cells`);
        }
        rows.push(cells);
        index += 1;
      }
      if (rows.length === 0) throw new Error("DOCX Markdown table must contain at least one data row");
      blocks.push({ type: "table", columns, rows });
      continue;
    }
    if (isTabTableStart(lines, index)) {
      const columns = tabTableCells(lines[index]!);
      const rows: string[][] = [];
      index += 1;
      while (index < lines.length && tabTableCells(lines[index]!).length === columns.length) {
        rows.push(tabTableCells(lines[index]!));
        index += 1;
      }
      blocks.push({ type: "table", columns, rows });
      continue;
    }
    if (/^[-*]\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/u.test(lines[index]!.trim())) {
        items.push(cleanMarkdownText(lines[index]!.trim().replace(/^[-*]\s+/u, "")));
        index += 1;
      }
      for (let offset = 0; offset < items.length; offset += 50) {
        blocks.push({ type: "bullets", items: items.slice(offset, offset + 50) });
      }
      continue;
    }
    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index]!.trim();
      if (candidate.length === 0
        || /^[-*]\s+/u.test(candidate)
        || isMarkdownTableStart(lines, index)
        || isTabTableStart(lines, index)) break;
      paragraphLines.push(candidate.replace(/^#{3,6}\s+/u, ""));
      index += 1;
    }
    const paragraph = cleanMarkdownText(paragraphLines.join(" "));
    for (const chunk of boundedParagraphChunks(paragraph)) {
      blocks.push({ type: "paragraph", text: chunk });
    }
  }
  return blocks;
}

function isMarkdownTableStart(lines: readonly string[], index: number): boolean {
  const header = lines[index]?.trim() ?? "";
  const separator = lines[index + 1]?.trim() ?? "";
  if (!header.startsWith("|") || !separator.startsWith("|")) return false;
  const cells = markdownTableCells(separator);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function markdownTableCells(line: string): string[] {
  const normalized = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return normalized.split("|").map((cell) => cleanMarkdownText(cell));
}

function isTabTableStart(lines: readonly string[], index: number): boolean {
  const columns = tabTableCells(lines[index] ?? "");
  const next = tabTableCells(lines[index + 1] ?? "");
  return columns.length >= 2 && next.length === columns.length;
}

function tabTableCells(line: string): string[] {
  if (!line.includes("\t")) return [];
  return line.trim().split("\t").map((cell) => cleanMarkdownText(cell));
}

function cleanMarkdownText(value: string): string {
  return value
    .trim()
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1");
}

function boundedParagraphChunks(value: string): string[] {
  const characters = [...value];
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += 4_000) {
    chunks.push(characters.slice(index, index + 4_000).join(""));
  }
  return chunks;
}

function normalizeMetadata(value: unknown): DocxArtifactMetadataRow[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) {
    throw new Error("DOCX metadata must be an array with at most 10 entries");
  }
  return value.map((item, index) => {
    const row = expectObject(item, `DOCX metadata[${index}]`);
    return {
      label: boundedText(row.label, `DOCX metadata[${index}].label`, 80),
      value: boundedText(row.value, `DOCX metadata[${index}].value`, 500),
    };
  });
}

function normalizeBlock(value: unknown, label: string): DocxArtifactBlock {
  const block = expectObject(value, label);
  if (block.type === "paragraph") {
    return { type: "paragraph", text: boundedText(block.text, `${label}.text`, 4_000) };
  }
  if (block.type === "bullets") {
    if (!Array.isArray(block.items) || block.items.length < 1 || block.items.length > 50) {
      throw new Error(`${label}.items must contain between 1 and 50 entries`);
    }
    return {
      type: "bullets",
      items: block.items.map((item, index) => boundedText(item, `${label}.items[${index}]`, 1_000)),
    };
  }
  if (block.type === "table") {
    if (!Array.isArray(block.columns) || block.columns.length < 2 || block.columns.length > MAX_TABLE_COLUMNS) {
      throw new Error(`${label}.columns must contain between 2 and ${MAX_TABLE_COLUMNS} entries`);
    }
    const columns = block.columns.map((item, index) => boundedText(item, `${label}.columns[${index}]`, 200));
    if (!Array.isArray(block.rows) || block.rows.length < 1 || block.rows.length > MAX_TABLE_ROWS) {
      throw new Error(`${label}.rows must contain between 1 and ${MAX_TABLE_ROWS} entries`);
    }
    const rows = block.rows.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== columns.length) {
        throw new Error(`${label}.rows[${rowIndex}] must contain exactly ${columns.length} cells`);
      }
      return row.map((cell, columnIndex) =>
        boundedText(cell, `${label}.rows[${rowIndex}][${columnIndex}]`, 1_000));
    });
    return { type: "table", columns, rows };
  }
  throw new Error(`${label}.type must be paragraph, bullets, or table`);
}

function documentXml(spec: DocxArtifactSpec): string {
  const body: string[] = [styledParagraph("Title", spec.title)];
  if (spec.subtitle !== undefined) body.push(styledParagraph("Subtitle", spec.subtitle));
  for (const row of spec.metadata ?? []) body.push(metadataParagraph(row));
  for (const section of spec.sections) {
    body.push(styledParagraph("Heading1", section.heading));
    for (const block of section.blocks) {
      if (block.type === "paragraph") body.push(styledParagraph("Normal", block.text));
      if (block.type === "bullets") body.push(...block.items.map(bulletParagraph));
      if (block.type === "table") body.push(tableXml(block));
    }
  }
  if (spec.revisionNote !== undefined) {
    body.push(styledParagraph("Heading1", "本轮修改说明"), styledParagraph("Normal", spec.revisionNote));
  }
  body.push([
    "<w:sectPr>",
    '<w:footerReference w:type="default" r:id="rId5"/>',
    '<w:pgSz w:w="12240" w:h="15840"/>',
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>',
    "</w:sectPr>",
  ].join(""));
  return xml([
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<w:body>${body.join("")}</w:body>`,
    "</w:document>",
  ].join(""));
}

function styledParagraph(style: string, text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${textRun(text)}</w:p>`;
}

function metadataParagraph(row: DocxArtifactMetadataRow): string {
  return [
    '<w:p><w:pPr><w:pStyle w:val="Metadata"/></w:pPr>',
    `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(`${row.label}: `)}</w:t></w:r>`,
    textRun(row.value),
    "</w:p>",
  ].join("");
}

function bulletParagraph(text: string): string {
  return [
    "<w:p><w:pPr>",
    '<w:pStyle w:val="Normal"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>',
    "</w:pPr>",
    textRun(text),
    "</w:p>",
  ].join("");
}

function textRun(text: string): string {
  const lines = text.split("\n");
  return `<w:r>${lines.map((line, index) =>
    `${index === 0 ? "" : "<w:br/>"}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`).join("")}</w:r>`;
}

function tableXml(block: DocxTableBlock): string {
  const widths = tableColumnWidths(block);
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const header = tableRowXml(block.columns, widths, true);
  const rows = block.rows.map((row) => tableRowXml(row, widths, false)).join("");
  return [
    "<w:tbl><w:tblPr>",
    `<w:tblW w:w="${TABLE_WIDTH_DXA}" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/>`,
    '<w:tblLayout w:type="fixed"/>',
    '<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>',
    '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9DDE3"/><w:left w:val="single" w:sz="4" w:color="D9DDE3"/><w:bottom w:val="single" w:sz="4" w:color="D9DDE3"/><w:right w:val="single" w:sz="4" w:color="D9DDE3"/><w:insideH w:val="single" w:sz="4" w:color="D9DDE3"/><w:insideV w:val="single" w:sz="4" w:color="D9DDE3"/></w:tblBorders>',
    `</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${header}${rows}</w:tbl>`,
  ].join("");
}

function tableRowXml(cells: readonly string[], widths: readonly number[], header: boolean): string {
  return [
    "<w:tr>",
    header ? "<w:trPr><w:tblHeader/></w:trPr>" : "",
    ...cells.map((cell, index) => [
      "<w:tc><w:tcPr>",
      `<w:tcW w:w="${widths[index]}" w:type="dxa"/>`,
      header ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F4F7"/>' : "",
      '<w:vAlign w:val="center"/></w:tcPr>',
      '<w:p><w:pPr><w:pStyle w:val="TableText"/></w:pPr><w:r>',
      header ? "<w:rPr><w:b/></w:rPr>" : "",
      `<w:t xml:space="preserve">${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`,
    ].join("")),
    "</w:tr>",
  ].join("");
}

function tableColumnWidths(block: DocxTableBlock): number[] {
  const weights = block.columns.map((column, index) => {
    const values = [column, ...block.rows.map((row) => row[index] ?? "")];
    return Math.max(4, Math.min(40, ...values.map((value) => [...value].length)));
  });
  const available = TABLE_WIDTH_DXA - TABLE_MIN_COLUMN_DXA * weights.length;
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const widths = weights.map((weight) =>
    TABLE_MIN_COLUMN_DXA + Math.floor(available * weight / weightTotal));
  widths[widths.length - 1] = (widths.at(-1) ?? 0)
    + TABLE_WIDTH_DXA - widths.reduce((sum, value) => sum + value, 0);
  return widths;
}

function extractDocumentInspection(document: string): DocxArtifactInspection {
  const body = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/iu.exec(document)?.[1];
  if (body === undefined) throw new Error("DOCX document.xml is missing w:body");
  const lines: string[] = [];
  let title: string | undefined;
  let paragraphCount = 0;
  let sectionCount = 0;
  let tableCount = 0;
  let tableRowCount = 0;
  const blocks = body.match(/<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>/giu) ?? [];
  for (const block of blocks) {
    if (block.startsWith("<w:tbl")) {
      const rows = block.match(/<w:tr\b[\s\S]*?<\/w:tr>/giu) ?? [];
      if (rows.length === 0) continue;
      tableCount += 1;
      tableRowCount += Math.max(0, rows.length - 1);
      for (const row of rows) {
        const cells = (row.match(/<w:tc\b[\s\S]*?<\/w:tc>/giu) ?? [])
          .map((cell) => (cell.match(/<w:p\b[\s\S]*?<\/w:p>/giu) ?? [])
            .map(extractParagraphText)
            .filter(Boolean)
            .join(" / "));
        if (cells.length > 0) lines.push(cells.join("\t"));
      }
      continue;
    }
    const text = extractParagraphText(block);
    if (text.length === 0) continue;
    paragraphCount += 1;
    const style = /<w:pStyle\b[^>]*w:val=["']([^"']+)["']/iu.exec(block)?.[1];
    if (style === "Title") {
      title ??= text;
      lines.push(`# ${text}`);
    } else if (style === "Heading1") {
      sectionCount += 1;
      lines.push(`## ${text}`);
    } else if (style === "Heading2") {
      lines.push(`### ${text}`);
    } else if (/<w:numPr\b/iu.test(block)) {
      lines.push(`- ${text}`);
    } else {
      lines.push(text);
    }
  }
  const text = lines.join("\n");
  if (text.length === 0) throw new Error("DOCX contains no extractable text or table content");
  if (text.length > MAX_DOCX_TEXT_CHARACTERS) {
    throw new Error(`DOCX extracted text exceeds the ${MAX_DOCX_TEXT_CHARACTERS}-character limit`);
  }
  return { version: 1, title, text, paragraphCount, sectionCount, tableCount, tableRowCount };
}

function extractParagraphText(paragraph: string): string {
  const parts: string[] = [];
  const tokens = paragraph.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/giu) ?? [];
  for (const token of tokens) {
    if (/^<w:tab\b/iu.test(token)) parts.push("\t");
    else if (/^<w:br\b/iu.test(token)) parts.push("\n");
    else parts.push(decodeXml(token.replace(/^<w:t\b[^>]*>/iu, "").replace(/<\/w:t>$/iu, "")));
  }
  return parts.join("").trim();
}

function validateDocxEntry(name: string): void {
  if (name.length === 0 || name.includes("\0") || name.includes("\\") || name.startsWith("/")) {
    throw new Error("DOCX package contains an unsafe entry name");
  }
  const segments = name.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("DOCX package contains an unsafe entry path");
  }
}

function rejectUnsupportedDocxEntry(name: string): void {
  if (
    name === "word/vbaProject.bin"
    || name === "word/comments.xml"
    || name === "word/footnotes.xml"
    || name === "word/endnotes.xml"
    || name.startsWith("word/activeX/")
    || name.startsWith("customXml/")
    || name.startsWith("word/charts/")
    || name.startsWith("word/diagrams/")
    || name.startsWith("word/drawings/")
    || name.startsWith("word/embeddings/")
    || name.startsWith("word/media/")
    || /^word\/header\d+\.xml$/u.test(name)
  ) {
    throw new Error(`DOCX contains an unsupported package part: ${name}`);
  }
}

function requiredXml(archive: Record<string, Uint8Array>, name: string): string {
  const value = archive[name];
  if (value === undefined) throw new Error(`DOCX package is missing ${name}`);
  return strFromU8(value);
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalBoundedText(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  return boundedText(value, label, maximum);
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error(`${label} must contain between 1 and ${maximum} characters`);
  }
  if (/\p{Cc}/u.test(normalized.replaceAll("\n", "").replaceAll("\t", ""))) {
    throw new Error(`${label} contains unsupported control characters`);
  }
  return normalized;
}

function encoded(value: string): Uint8Array {
  return strToU8(value);
}

function xml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([a-f0-9]+)|amp|lt|gt|quot|apos);/giu, (entity, decimal, hexadecimal) => {
    if (decimal !== undefined) return String.fromCodePoint(Number.parseInt(decimal, 10));
    if (hexadecimal !== undefined) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
    return ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" } as Record<string, string>)[entity] ?? entity;
  });
}

function contentTypesXml(): string {
  return xml([
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
    '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>',
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    "</Types>",
  ].join(""));
}

function packageRelationshipsXml(): string {
  return xml([
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
    "</Relationships>",
  ].join(""));
}

function documentRelationshipsXml(): string {
  return xml([
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>',
    '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
    "</Relationships>",
  ].join(""));
}

function corePropertiesXml(): string {
  return xml([
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"',
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    "<dc:creator>LocalBuddy</dc:creator><cp:lastModifiedBy>LocalBuddy</cp:lastModifiedBy>",
    '<dcterms:created xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:created>',
    '<dcterms:modified xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:modified>',
    "</cp:coreProperties>",
  ].join(""));
}

function appPropertiesXml(): string {
  return xml('<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>LocalBuddy</Application><AppVersion>1.0</AppVersion></Properties>');
}

function stylesXml(): string {
  return xml([
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="PingFang SC"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>',
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>',
    paragraphStyle("Normal", "Normal", '<w:spacing w:after="120" w:line="264" w:lineRule="auto"/>', '<w:sz w:val="22"/><w:color w:val="000000"/>', true),
    paragraphStyle("Title", "Title", '<w:spacing w:before="0" w:after="80"/><w:keepNext/>', '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="PingFang SC"/><w:b/><w:sz w:val="46"/><w:color w:val="000000"/>'),
    paragraphStyle("Subtitle", "Subtitle", '<w:spacing w:before="0" w:after="240"/>', '<w:sz w:val="28"/><w:color w:val="555555"/>'),
    paragraphStyle("Metadata", "Metadata", '<w:spacing w:before="0" w:after="40" w:line="264" w:lineRule="auto"/>', '<w:sz w:val="22"/><w:color w:val="000000"/>'),
    paragraphStyle("Heading1", "Heading 1", '<w:keepNext/><w:spacing w:before="320" w:after="160"/>', '<w:b/><w:sz w:val="32"/><w:color w:val="2E74B5"/>'),
    paragraphStyle("Heading2", "Heading 2", '<w:keepNext/><w:spacing w:before="240" w:after="120"/>', '<w:b/><w:sz w:val="26"/><w:color w:val="2E74B5"/>'),
    paragraphStyle("TableText", "Table Text", '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="21"/><w:color w:val="000000"/>'),
    "</w:styles>",
  ].join(""));
}

function paragraphStyle(id: string, name: string, paragraphProperties: string, runProperties: string, isDefault = false): string {
  return `<w:style w:type="paragraph" w:styleId="${id}"${isDefault ? ' w:default="1"' : ""}><w:name w:val="${name}"/><w:pPr>${paragraphProperties}</w:pPr><w:rPr>${runProperties}</w:rPr></w:style>`;
}

function numberingXml(): string {
  return xml([
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0">',
    '<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>',
    '<w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="160" w:line="280" w:lineRule="auto"/></w:pPr>',
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:lvl></w:abstractNum>',
    '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>',
    "</w:numbering>",
  ].join(""));
}

function settingsXml(): string {
  return xml('<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/></w:settings>');
}

function fontTableXml(): string {
  return xml('<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="Calibri"/><w:font w:name="PingFang SC"/><w:font w:name="Arial"/></w:fonts>');
}

function footerXml(): string {
  return xml([
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:before="0" w:after="0"/></w:pPr>',
    '<w:r><w:rPr><w:color w:val="777777"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>',
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>',
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>',
  ].join(""));
}
