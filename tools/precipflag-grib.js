/* Build an MRMS PrecipFlag GRIB2 message (for tests and TEST REPLAY checks only): the fields assets/threats-radar.js and
   functions/api/mrms check, with the grid PNG-packed (template 5.41, 8-bit greyscale, value = byte - 3 as NOAA's file).
   Also: replace the pixel data of a real PrecipFlag file, keeping its other sections. */
"use strict";
const zlib = require("zlib");
const crcT = []; for (let k = 0; k < 256; k++) { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[k] = c >>> 0; }
function chunk(type, data) { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); let x = 0xffffffff; for (const b of Buffer.concat([t, data])) x = crcT[(x ^ b) & 255] ^ (x >>> 8); c.writeUInt32BE((x ^ 0xffffffff) >>> 0); return Buffer.concat([len, t, data, c]); }
/* bytes: Uint8Array(width*height), row 0 = north */
function greyPng(w, h, bytes) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w + 1)] = y % 2 ? 2 : 1; for (let x = 0; x < w; x++) { const v = bytes[y * w + x], pr = y % 2 ? (y ? bytes[(y - 1) * w + x] : 0) : (x ? bytes[y * w + x - 1] : 0); raw[y * (w + 1) + 1 + x] = (v - pr) & 255; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function sec(n, body) { const b = Buffer.alloc(5 + body.length); b.writeUInt32BE(b.length, 0); b[4] = n; body.copy(b, 5); return b; }
function build({ scan, width = 7000, height = 3500, bytes, la1 = 54.995, lo1 = 230.005, d = 0.01, discipline = 209, centre = 161, cat = 6, num = 0, template = 41 }) {
  const t = new Date(scan), s1 = Buffer.alloc(16); s1.writeUInt16BE(centre, 0); s1[6] = 3; s1.writeUInt16BE(t.getUTCFullYear(), 7); s1[9] = t.getUTCMonth() + 1; s1[10] = t.getUTCDate(); s1[11] = t.getUTCHours(); s1[12] = t.getUTCMinutes(); s1[13] = t.getUTCSeconds();
  const s3 = Buffer.alloc(67); s3.writeUInt32BE(width * height, 1); s3.writeUInt16BE(0, 7); s3.writeUInt32BE(width, 25); s3.writeUInt32BE(height, 29);
  s3.writeInt32BE(Math.round(la1 * 1e6), 41); s3.writeUInt32BE(Math.round(lo1 * 1e6), 45); s3.writeInt32BE(Math.round((la1 - (height - 1) * d) * 1e6), 50); s3.writeUInt32BE(Math.round((lo1 + (width - 1) * d) * 1e6), 54); s3.writeUInt32BE(Math.round(d * 1e6), 58); s3.writeUInt32BE(Math.round(d * 1e6), 62); s3[66] = 0;
  const s4 = Buffer.alloc(29); s4[4] = cat; s4[5] = num; s4[17] = 102;
  const s5 = Buffer.alloc(16); s5.writeUInt32BE(width * height, 0); s5.writeUInt16BE(template, 4); s5.writeFloatBE(-3, 6); s5[14] = 8;
  const s6 = Buffer.from([255]), s7 = greyPng(width, height, bytes);
  const body = Buffer.concat([sec(1, s1), sec(3, s3), sec(4, s4), sec(5, s5), sec(6, s6), sec(7, s7), Buffer.from("7777")]);
  const s0 = Buffer.alloc(16); s0.write("GRIB", 0); s0[6] = discipline; s0[7] = 2; s0.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return Buffer.concat([s0, body]);
}
/* a real file's message with its pixels replaced and (optionally) a new scan time */
function replacePixels(g, bytes, scan) {
  g = Buffer.from(g); const secs = []; for (let o = 16; o < g.length - 4;) { const len = g.readUInt32BE(o); secs.push([g[o + 4], o, len]); o += len; }
  const s3 = secs.find((s) => s[0] === 3)[1], w = g.readUInt32BE(s3 + 30), h = g.readUInt32BE(s3 + 34);
  const out = []; for (const [n, o, len] of secs) out.push(n === 7 ? sec(7, greyPng(w, h, bytes)) : Buffer.from(g.subarray(o, o + len)));
  if (scan != null) { const s1 = out[secs.findIndex((s) => s[0] === 1)], t = new Date(scan); s1.writeUInt16BE(t.getUTCFullYear(), 12); s1[14] = t.getUTCMonth() + 1; s1[15] = t.getUTCDate(); s1[16] = t.getUTCHours(); s1[17] = t.getUTCMinutes(); s1[18] = t.getUTCSeconds(); }
  const body = Buffer.concat([...out, Buffer.from("7777")]), s0 = Buffer.from(g.subarray(0, 16)); s0.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return Buffer.concat([s0, body]);
}
module.exports = { build, replacePixels, greyPng };
