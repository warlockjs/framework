import { brotliDecompressSync, inflateSync } from "node:zlib";
import { latinWeightings } from "./latin-weightings";

export type FontMetrics = {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  xWidthAvg: number;
};

export type ReadFontMetrics = FontMetrics & {
  hhea: { ascent: number; descent: number; lineGap: number };
  typo?: { ascent: number; descent: number; lineGap: number };
  xAvgCharWidth?: number;
  widthSource: "hmtx" | "OS/2";
};

// W3C WOFF2 §4.1: directory tags, Base128 lengths and transform versions.
// https://www.w3.org/TR/2024/REC-WOFF2-20240808/#table_dir_format
// Explicit entries avoid whitespace ambiguity for three-character/padded tags.
const knownTags = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
];

const MAX_FONT_BYTES = 32 * 1024 * 1024;

function slice(data: Buffer, offset: number, length: number): Buffer {
  if (offset < 0 || length < 0 || offset + length > data.length)
    throw new Error("Truncated font table");
  return data.subarray(offset, offset + length);
}

function tablesFrom(data: Buffer): Map<string, Buffer> {
  const tables = new Map<string, Buffer>();
  const signature = data.toString("ascii", 0, 4);
  if (signature === "wOF2") {
    if (data.readUInt32BE(4) === 0x74746366) throw new Error("Font collections are unsupported");
    let cursor = 48;
    const byte = () => slice(data, cursor++, 1).readUInt8(0);
    const base128 = () => {
      let value = 0;
      for (let i = 0; i < 5; i++) {
        const next = byte();
        if ((i === 0 && next === 0x80) || value > 0x1ffffff)
          throw new Error("Invalid WOFF2 length");
        value = value * 128 + (next & 127);
        if (!(next & 128)) return value;
      }
      throw new Error("Invalid WOFF2 length");
    };
    const directory: { tag: string; length: number; transformed: boolean }[] = [];
    let total = 0;
    for (let i = 0; i < data.readUInt16BE(12); i++) {
      const flags = byte();
      const index = flags & 63;
      const tag = index === 63 ? slice(data, cursor, 4).toString("ascii") : knownTags[index];
      if (index === 63) cursor += 4;
      if (!tag) throw new Error("Invalid WOFF2 tag");
      const original = base128();
      const version = flags >>> 6;
      if (tag === "hmtx" && version > 1) throw new Error("Unsupported WOFF2 hmtx transform");
      const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
      const length = transformed ? base128() : original;
      total += length;
      if (total > MAX_FONT_BYTES) throw new Error("Font tables exceed size limit");
      directory.push({ tag, length, transformed });
    }
    const decoded = brotliDecompressSync(slice(data, cursor, data.readUInt32BE(20)), {
      maxOutputLength: MAX_FONT_BYTES,
    });
    if (decoded.length !== total) throw new Error("Invalid WOFF2 table data length");
    let offset = 0;
    for (const entry of directory) {
      // The metrics tables are untransformed; transformed hmtx starts with
      // flags followed by the unchanged advanceWidth array (WOFF2 §5.4).
      const table = slice(decoded, offset, entry.length);
      if (!entry.transformed || entry.tag === "hmtx") tables.set(entry.tag, table);
      if (entry.tag === "hmtx" && entry.transformed) tables.set("hmtx-transformed", table);
      offset += entry.length;
    }
    return tables;
  }
  if (signature === "wOFF") {
    for (let i = 0; i < data.readUInt16BE(12); i++) {
      const entry = slice(data, 44 + i * 20, 20);
      const compressed = slice(data, entry.readUInt32BE(4), entry.readUInt32BE(8));
      const length = entry.readUInt32BE(12);
      if (length > MAX_FONT_BYTES) throw new Error("Font table exceeds size limit");
      const table =
        compressed.length === length
          ? compressed
          : inflateSync(compressed, { maxOutputLength: MAX_FONT_BYTES });
      if (table.length !== length) throw new Error("Invalid WOFF table length");
      tables.set(entry.toString("ascii", 0, 4), table);
    }
    return tables;
  }
  if (data.readUInt32BE(0) !== 0x00010000 && signature !== "OTTO" && signature !== "true") {
    throw new Error("Unsupported font container; use a single TTF, OTF, WOFF or WOFF2 face");
  }
  for (let i = 0; i < data.readUInt16BE(4); i++) {
    const entry = slice(data, 12 + i * 16, 16);
    tables.set(
      entry.toString("ascii", 0, 4),
      slice(data, entry.readUInt32BE(8), entry.readUInt32BE(12)),
    );
  }
  return tables;
}

/** Unicode cmap formats 4 and 12 cover Latin in both TrueType and CFF faces. */
function glyphFor(cmap: Buffer, code: number): number {
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const record = 4 + i * 8;
    const platform = cmap.readUInt16BE(record);
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(cmap.readUInt16BE(record + 2))))
      continue;
    const offset = cmap.readUInt32BE(record + 4);
    const format = cmap.readUInt16BE(offset);
    if (format === 12) {
      for (let j = 0; j < cmap.readUInt32BE(offset + 12); j++) {
        const group = offset + 16 + j * 12;
        if (code >= cmap.readUInt32BE(group) && code <= cmap.readUInt32BE(group + 4)) {
          return cmap.readUInt32BE(group + 8) + code - cmap.readUInt32BE(group);
        }
      }
    } else if (format === 4) {
      const count = cmap.readUInt16BE(offset + 6) / 2;
      for (let j = 0; j < count; j++) {
        const end = cmap.readUInt16BE(offset + 14 + j * 2);
        const start = cmap.readUInt16BE(offset + 16 + count * 2 + j * 2);
        if (code < start || code > end) continue;
        const delta = cmap.readInt16BE(offset + 16 + count * 4 + j * 2);
        const rangePosition = offset + 16 + count * 6 + j * 2;
        const range = cmap.readUInt16BE(rangePosition);
        if (range === 0) return (code + delta) & 0xffff;
        const glyph = cmap.readUInt16BE(rangePosition + range + (code - start) * 2);
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
      }
    }
  }
  return 0;
}

/** Reads only metrics, never outlines. USE_TYPO_METRICS selects OS/2 vertical values. */
export function readFontMetrics(data: Buffer): ReadFontMetrics {
  if (data.length > MAX_FONT_BYTES) throw new Error("Font exceeds size limit");
  const tables = tablesFrom(data);
  const required = (tag: string, minimum: number) => {
    const table = tables.get(tag);
    if (!table || table.length < minimum) throw new Error(`Missing or truncated ${tag} font table`);
    return table;
  };
  const head = required("head", 20);
  const hhea = required("hhea", 36);
  const unitsPerEm = head.readUInt16BE(18);
  if (!unitsPerEm) throw new Error("Invalid font unitsPerEm");
  const vertical = {
    ascent: hhea.readInt16BE(4),
    descent: hhea.readInt16BE(6),
    lineGap: hhea.readInt16BE(8),
  };
  const os2 = tables.get("OS/2");
  const typo =
    os2 && os2.length >= 74
      ? { ascent: os2.readInt16BE(68), descent: os2.readInt16BE(70), lineGap: os2.readInt16BE(72) }
      : undefined;
  const xAvgCharWidth = os2 && os2.length >= 4 ? os2.readInt16BE(2) : undefined;
  let xWidthAvg = xAvgCharWidth ?? 0;
  let widthSource: ReadFontMetrics["widthSource"] = "OS/2";
  const cmap = tables.get("cmap");
  const hmtx = tables.get("hmtx");
  const count = hhea.readUInt16BE(34);
  if (cmap && hmtx && count > 0) {
    const transformed = tables.has("hmtx-transformed");
    let sum = 0;
    let frequency = 0;
    for (const [character, weight] of Object.entries(latinWeightings)) {
      const glyph = glyphFor(cmap, character.charCodeAt(0));
      const index = Math.min(glyph, count - 1);
      const width = hmtx.readUInt16BE(transformed ? 1 + index * 2 : index * 4);
      sum += width * weight;
      frequency += weight;
    }
    if (frequency > 0) {
      xWidthAvg = Math.round(sum);
      widthSource = "hmtx";
    }
  }
  if (!(xWidthAvg > 0)) throw new Error("Font has no usable average advance width");
  const useTypo = os2 && os2.length >= 64 && (os2.readUInt16BE(62) & 128) !== 0;
  return {
    unitsPerEm,
    ...(useTypo && typo ? typo : vertical),
    xWidthAvg,
    hhea: vertical,
    typo,
    xAvgCharWidth,
    widthSource,
  };
}
