// Lead tool, run once: fetch the OpenFreeMap z14 vector tiles over the SAMPLE town's area (the same tiles the map shows),
// at most one request per second with a clear User-Agent, and save each raw tile plus a manifest (URL + fetched time) in
// data/sources/openfreemap-tiles/. Usage: node tools/fetch-tiles.mjs <south> <west> <north> <east>
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'data', 'sources', 'openfreemap-tiles')
const UA = 'APCO-Software-Tools-research/1.0 (+https://apcosoftwaretools.ca)'
const [south, west, north, east] = process.argv.slice(2).map(Number)
const Z = 14
const tilejson = JSON.parse(readFileSync(join(ROOT, 'data', 'sources', 'openfreemap-planet-tilejson.json'), 'utf8'))
const template = tilejson.tiles[0]
const lon2x = (lng) => Math.floor(((lng + 180) / 360) * 2 ** Z)
const lat2y = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z) }
mkdirSync(OUT, { recursive: true })
const manifestPath = join(OUT, 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { tiles: [] }
for (let x = lon2x(west); x <= lon2x(east); x++) {
  for (let y = lat2y(north); y <= lat2y(south); y++) {
    const file = `${Z}-${x}-${y}.pbf`
    if (existsSync(join(OUT, file))) continue
    const url = template.replace('{z}', Z).replace('{x}', x).replace('{y}', y)
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    const buf = Buffer.from(await res.arrayBuffer())
    console.log(res.status, url, buf.length)
    if (res.ok) {
      writeFileSync(join(OUT, file), buf)
      manifest.tiles.push({ file, url, fetched_at: new Date().toISOString(), bytes: buf.length })
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    }
    await new Promise((r) => setTimeout(r, 1200))
  }
}
