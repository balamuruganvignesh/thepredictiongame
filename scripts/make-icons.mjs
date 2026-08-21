// Generates the PWA's home-screen icons.
//
// Committed OUTPUT, reproducible script -- the icons are checked in (a build
// shouldn't need to render images) but the thing that drew them is here, so
// changing the mark doesn't mean hand-editing a binary.
//
// Writes the PNG bytes directly: no image library, for the same reason
// server/logger.ts isn't a logging framework. A PNG is a signature, three
// chunks and a CRC, and zlib ships with Node.
//
//   node scripts/make-icons.mjs

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/client/public')

// Matches the app's own tokens: --bg-top behind, --card-red for the mark.
const BG = [15, 15, 20]
const HEART = [200, 32, 38]
const CARD = [250, 250, 246]

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** RGBA pixel buffer -> a real PNG. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10-12: compression, filter, interlace -- all 0.

  // Each scanline is prefixed with its filter byte. Filter 0 (none) keeps this
  // honest and simple; deflate still gets these down to a few KB.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * The implicit heart curve: (x^2 + y^2 - 1)^3 - x^2 * y^3 <= 0.
 * Sampled rather than traced, so there's no path geometry to get wrong.
 */
const insideHeart = (x, y) => {
  const a = x * x + y * y - 1
  return a * a * a - x * x * y * y * y <= 0
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  // Everything stays inside a maskable icon's safe zone -- the inner 80%
  // circle, i.e. radius 0.4 * size from the centre -- so a launcher can crop
  // this to a circle, a squircle or a rounded square without clipping the
  // card. The card's far corner sits at hypot(0.23, 0.30) = 0.378 of the
  // canvas, comfortably inside that.
  const cardW = size * 0.48
  const cardH = size * 0.62
  const radius = size * 0.06

  // The heart curve spans roughly x in [-1.2, 1.2], so its drawn width is
  // 2.4 * scale. Sized to a bit over half the card's width, the way a real
  // court-card pip sits on a face.
  const scale = (0.56 * cardW) / 2.4
  const cx = size / 2
  const cy = size * 0.5

  // 3x3 supersampling: no anti-aliasing library, just more samples.
  const SS = 3

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cardHits = 0
      let heartHits = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS

          // Rounded-rect card face -- the standard rounded-box distance
          // field: inset the half-extents by the corner radius, measure, then
          // put the radius back.
          const dx = Math.abs(px - size / 2) - (cardW / 2 - radius)
          const dy = Math.abs(py - size / 2) - (cardH / 2 - radius)
          const outside =
            Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) +
            Math.min(Math.max(dx, dy), 0) -
            radius
          if (outside <= 0) cardHits++

          // Heart, in the curve's own coordinate space (y up).
          const hx = (px - cx) / scale
          const hy = -(py - cy) / scale
          if (insideHeart(hx, hy)) heartHits++
        }
      }

      const samples = SS * SS
      const cardA = cardHits / samples
      const heartA = heartHits / samples

      // Background, then the card over it, then the heart over that.
      let [r, g, b] = BG
      if (cardA > 0) {
        r = r + (CARD[0] - r) * cardA
        g = g + (CARD[1] - g) * cardA
        b = b + (CARD[2] - b) * cardA
      }
      if (heartA > 0) {
        r = r + (HEART[0] - r) * heartA
        g = g + (HEART[1] - g) * heartA
        b = b + (HEART[2] - b) * heartA
      }

      const i = (y * size + x) * 4
      rgba[i] = Math.round(r)
      rgba[i + 1] = Math.round(g)
      rgba[i + 2] = Math.round(b)
      rgba[i + 3] = 255 // fully opaque: maskable icons must fill their canvas
    }
  }

  return encodePng(size, size, rgba)
}

for (const size of [192, 512]) {
  const file = path.join(OUT_DIR, `icon-${size}.png`)
  writeFileSync(file, drawIcon(size))
  console.log(`wrote ${file}`)
}
