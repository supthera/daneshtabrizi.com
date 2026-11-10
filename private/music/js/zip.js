/** Minimal store-only ZIP writer (no compression, no dependency). */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function u16(n) {
  const b = new Uint8Array(2);
  b[0] = n & 255;
  b[1] = (n >>> 8) & 255;
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  b[0] = n & 255;
  b[1] = (n >>> 8) & 255;
  b[2] = (n >>> 16) & 255;
  b[3] = (n >>> 24) & 255;
  return b;
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function encodeName(name) {
  return new TextEncoder().encode(String(name).replace(/\\/g, "/"));
}

/**
 * @param {Array<{ name: string, data: Uint8Array|ArrayBuffer|string }>} files
 * @returns {Blob}
 */
export function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encodeName(file.name);
    let data;
    if (typeof file.data === "string") data = new TextEncoder().encode(file.data);
    else if (file.data instanceof ArrayBuffer) data = new Uint8Array(file.data);
    else data = file.data;

    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  }

  const centralDir = concat(centralParts);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);

  return new Blob([concat([...localParts, centralDir, end])], { type: "application/zip" });
}

/** Very small ZIP reader for store-method backups we create. */
export async function readZip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const files = new Map();
  let i = 0;
  while (i + 30 <= buf.length) {
    const sig = buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24);
    if (sig !== 0x04034b50) break;
    const compression = buf[i + 8] | (buf[i + 9] << 8);
    const compSize = buf[i + 18] | (buf[i + 19] << 8) | (buf[i + 20] << 16) | (buf[i + 21] << 24);
    const nameLen = buf[i + 26] | (buf[i + 27] << 8);
    const extraLen = buf[i + 28] | (buf[i + 29] << 8);
    const name = new TextDecoder().decode(buf.slice(i + 30, i + 30 + nameLen));
    const dataStart = i + 30 + nameLen + extraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    if (compression !== 0) {
      throw new Error(`Unsupported ZIP compression for ${name} (need store-only export)`);
    }
    files.set(name, data);
    i = dataStart + compSize;
  }
  return files;
}
