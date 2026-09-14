// Lead tool: decode the saved tiles and print place labels and named streets (to choose the SAMPLE town's area).
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
const Pbf = PbfReader
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sources', 'openfreemap-tiles')
const streets = new Map()
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.pbf'))) {
  const [z, x, y] = file.replace('.pbf', '').split('-').map(Number)
  const tile = new VectorTile(new Pbf(readFileSync(join(DIR, file))))
  for (const name of ['place', 'transportation_name']) {
    const layer = tile.layers[name]
    if (!layer) continue
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i)
      const g = f.toGeoJSON(x, y, z)
      if (name === 'place') console.log('place', f.properties.class, f.properties.name, JSON.stringify(g.geometry.coordinates).slice(0, 60))
      else if (f.properties.name) {
        const s = streets.get(f.properties.name) || { cls: f.properties.class, n: 0, pt: g.geometry.coordinates.flat(3).slice(0, 2) }
        s.n++; streets.set(f.properties.name, s)
      }
    }
  }
}
console.log(streets.size, 'named streets')
for (const [k, v] of [...streets].sort()) console.log(' ', k, v.cls, v.pt.map((n) => n.toFixed(4)).join(','))
