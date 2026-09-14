// Lead tool: build data/town.json (the SAMPLE town) and data/test-points.json from the saved OpenFreeMap tiles.
// The boundary and wards are simple hand-drawn SAMPLE shapes, not a real municipal boundary. Streets are the named roads of the
// transportation_name layer (same data the map draws), clipped to the boundary: a segment is kept when both ends are inside.
// Coordinates are [lat, lng] everywhere in this project (Leaflet order), 6 decimals.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'data', 'sources', 'openfreemap-tiles')
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'))
const r6 = (n) => Math.round(n * 1e6) / 1e6

const boundary = [
  [49.1615, -55.3640], [49.1600, -55.3420], [49.1545, -55.3330], [49.1420, -55.3290], [49.1260, -55.3280],
  [49.1170, -55.3380], [49.1150, -55.3700], [49.1300, -55.3760], [49.1480, -55.3770],
]
const band = (s, n) => [[s, -55.40], [n, -55.40], [n, -55.30], [s, -55.30]]
const wards = [
  { id: 'north', name: 'North Ward (SAMPLE)', polygon: band(49.1445, 49.1700) },
  { id: 'centre', name: 'Centre Ward (SAMPLE)', polygon: band(49.1300, 49.1445) },
  { id: 'south', name: 'South Ward (SAMPLE)', polygon: band(49.1000, 49.1300) },
]

// Ray casting on [lat, lng] rings (treating lng as x, lat as y).
export function inside([lat, lng], ring) {
  let yes = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]; const [yj, xj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) yes = !yes
  }
  return yes
}

const KEEP = new Set(['primary', 'secondary', 'tertiary', 'minor', 'service'])
const streets = new Map()
const seen = new Set()
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.pbf')).sort()) {
  const [z, x, y] = file.replace('.pbf', '').split('-').map(Number)
  const layer = new VectorTile(new PbfReader(readFileSync(join(DIR, file)))).layers.transportation_name
  if (!layer) continue
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i)
    const { name, class: cls } = f.properties
    if (!name || !KEEP.has(cls)) continue
    const g = f.toGeoJSON(x, y, z).geometry
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
    for (const line of lines) {
      // Split the line into runs of consecutive inside points (both ends of each kept segment are inside).
      let run = []
      const flush = () => {
        if (run.length >= 2) {
          const key = name + JSON.stringify(run)
          if (!seen.has(key)) {
            seen.add(key)
            const s = streets.get(name) || { name, class: cls, lines: [] }
            s.lines.push(run)
            streets.set(name, s)
          }
        }
        run = []
      }
      for (const [lng, lat] of line) {
        const p = [r6(lat), r6(lng)]
        if (inside(p, boundary)) run.push(p)
        else flush()
      }
      flush()
    }
  }
}

const out = [...streets.values()].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
  const longest = s.lines.reduce((a, b) => (b.length > a.length ? b : a))
  return { name: s.name, class: s.class, point: longest[Math.floor(longest.length / 2)], lines: s.lines }
})

const town = {
  name: 'SAMPLE Town of Harbour Pond (demo)',
  note: 'SAMPLE town for the demo. The boundary and wards are simple hand-drawn shapes, not a real municipal boundary. Street names and shapes are real map data under the pins (OpenFreeMap tiles: OpenMapTiles schema, data from OpenStreetMap, ODbL). Coordinates are [lat, lng].',
  center: [49.1395, -55.352],
  zoom: 15,
  boundary,
  wards,
  streets: out,
  source: {
    tiles: manifest.tiles.map((t) => ({ url: t.url, fetched_at: t.fetched_at })),
    layer: 'transportation_name',
    attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
  },
}
writeFileSync(join(ROOT, 'data', 'town.json'), JSON.stringify(town, null, 1) + '\n')

// Reference points for tests (both slices read this file; never shipped to residents).
// Point-to-segment distance on an equirectangular projection centred on the point (the same rule the Worker uses).
const R = 6371008.8
function segDist([lat, lng], a, b) {
  const k = (Math.PI / 180) * R
  const cx = Math.cos((lat * Math.PI) / 180)
  const P = (q) => [(q[1] - lng) * k * cx, (q[0] - lat) * k]
  const [ax, ay] = P(a); const [bx, by] = P(b)
  const dx = bx - ax; const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len))
  return Math.hypot(ax + t * dx, ay + t * dy)
}
const distTo = (p, s) => Math.min(...s.lines.flatMap((l) => l.slice(1).map((q, i) => segDist(p, l[i], q))))
// on_street: a middle vertex of some street's longest run whose nearest OTHER street is at least 60 m away (no junction ties).
let onStreet = null
for (const s of out) {
  const longest = s.lines.reduce((a, b) => (b.length > a.length ? b : a))
  for (let i = 1; i < longest.length - 1 && !onStreet; i++) {
    const p = longest[i]
    const other = Math.min(...out.filter((o) => o !== s).map((o) => distTo(p, o)))
    if (other >= 60) onStreet = { point: p, street: s.name, nearest_other_street_m: Math.round(other) }
  }
  if (onStreet) break
}
// far_from_streets_inside: a grid point inside the boundary more than 250 m from every street.
let far = null
for (let lat = 49.117; lat < 49.161 && !far; lat += 0.0005) {
  for (let lng = -55.376; lng < -55.329 && !far; lng += 0.0005) {
    const p = [r6(lat), r6(lng)]
    if (!inside(p, boundary)) continue
    const d = Math.min(...out.map((s) => distTo(p, s)))
    if (d > 250) far = { point: p, nearest_street_m: Math.round(d) }
  }
}
const testPoints = {
  note: 'Fixed points for tests. [lat, lng]. Offsets for the 40 m / 60 m nearby tests are made in the tests by moving north: 1 metre = 1 / 111195.0797 degrees of latitude on the 6 371 008.8 m sphere.',
  inside_centre: town.center,
  outside_south: [49.1000, -55.3520],
  outside_east_of_boundary: [49.1420, -55.3200],
  on_street: onStreet,
  far_from_streets_inside: far,
}
writeFileSync(join(ROOT, 'data', 'test-points.json'), JSON.stringify(testPoints, null, 2) + '\n')
console.log(out.length, 'streets inside;', out.reduce((n, s) => n + s.lines.length, 0), 'lines;', out.reduce((n, s) => n + s.lines.reduce((m, l) => m + l.length, 0), 0), 'points')
console.log(out.map((s) => s.name).join(' | '))
console.log('centre inside:', inside(town.center, boundary), 'outside_south inside:', inside(testPoints.outside_south, boundary), 'east inside:', inside(testPoints.outside_east_of_boundary, boundary))
console.log('test points', JSON.stringify(testPoints))
