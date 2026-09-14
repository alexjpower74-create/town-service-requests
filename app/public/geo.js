// Pure geometry shared by the resident page and the mock (no DOM, importable from Node). Rules from docs/API.md.

export const EARTH_RADIUS_M = 6371008.8
const rad = (d) => (d * Math.PI) / 180

// Haversine distance in metres between two [lat, lng] points.
export function haversine([lat1, lng1], [lat2, lng2]) {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Inside the town boundary: ray casting on the ring with lng as x and lat as y (the Worker's rule).
export function insideRing([lat, lng], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]
    const [yj, xj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// The Worker's location label: the street whose nearest segment is closest (equirectangular projection centred on the pin),
// if within 150 m, ties alphabetical; else null. Needs street `lines` (the mock has them; GET /api/town does not send them).
export function nearestStreetByLines([lat, lng], streets, maxMetres = 150) {
  const kx = rad(1) * EARTH_RADIUS_M * Math.cos(rad(lat))
  const ky = rad(1) * EARTH_RADIUS_M
  let best = null
  for (const street of [...streets].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    for (const run of street.lines || []) {
      for (let i = 0; i < run.length; i++) {
        const ax = (run[i][1] - lng) * kx
        const ay = (run[i][0] - lat) * ky
        const [bx, by] = run.length === 1 ? [ax, ay] : i + 1 < run.length ? [(run[i + 1][1] - lng) * kx, (run[i + 1][0] - lat) * ky] : [ax, ay]
        const dx = bx - ax
        const dy = by - ay
        const len2 = dx * dx + dy * dy
        const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
        const d = Math.hypot(ax + t * dx, ay + t * dy)
        if (!best || d < best.d) best = { d, name: street.name }
      }
    }
  }
  return best && best.d <= maxMetres ? best.name : null
}

// The phone's own hint under the map: GET /api/town sends one point per street (no lines), so this is the street whose point
// is nearest, within maxMetres. The stored label is the Worker's (by segments) and is what the status link shows.
export function nearestStreetByPoint(point, streets, maxMetres = 250) {
  let best = null
  for (const s of streets) {
    const d = haversine(point, s.point)
    if (!best || d < best.d) best = { d, name: s.name }
  }
  return best && best.d <= maxMetres ? best.name : null
}

// A point moved north by `metres` (1 m = 1 / 111195.0797 degrees of latitude on the 6 371 008.8 m sphere).
export const north = ([lat, lng], metres) => [lat + metres / 111195.0797, lng]
