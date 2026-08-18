import sharp from 'sharp'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = 'C:/Users/princeb/Downloads/Ometto/ometto favicon new.png'
const out = path.resolve(__dirname, '../public/assets/images/favicon.png')
const size = 256
const radius = Math.round(size * 0.22)

const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
  </svg>`
)

const info = await sharp(src)
  .resize(size, size, { fit: 'cover', position: 'center' })
  .ensureAlpha()
  .composite([{ input: mask, blend: 'dest-in' }])
  .png({ compressionLevel: 9 })
  .toFile(out)

console.log('Saved:', out, info)
