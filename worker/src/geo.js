// Pure geometry. Points are [lat, lng]. Distances are metres on a sphere of radius 6 371 008.8 m (docs/API.md).

export const EARTH_RADIUS_M = 6371008.8
export const STREET_LABEL_MAX_M = 150
export const NO_STREET_LABEL = 'Not near a named street'

const rad = deg => deg * Math.PI / 180

export function haversine ([lat1, lng1], [lat2, lng2]) {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Ray casting with lng as x and lat as y. Points exactly on an edge are not defined (tests never use one). */
export function pointInRing ([lat, lng], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]
    const [yj, xj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The id of the first ward whose polygon contains the point, else null. */
export function wardOf (point, wards) {
  return wards.find(w => pointInRing(point, w.polygon))?.id ?? null
}

/** Point-to-segment distance in metres on an equirectangular projection centred on the point. */
function segmentDistance ([lat0, lng0], a, b) {
  const kx = rad(1) * EARTH_RADIUS_M * Math.cos(rad(lat0))
  const ky = rad(1) * EARTH_RADIUS_M
  const ax = (a[1] - lng0) * kx; const ay = (a[0] - lat0) * ky
  const bx = (b[1] - lng0) * kx; const by = (b[0] - lat0) * ky
  const dx = bx - ax; const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
  return Math.hypot(ax + t * dx, ay + t * dy)
}

/** Distance in metres from the point to the nearest segment of a street. */
export function streetDistance (point, street) {
  let best = Infinity
  for (const line of street.lines) {
    if (line.length === 1) best = Math.min(best, segmentDistance(point, line[0], line[0]))
    for (let i = 1; i < line.length; i++) best = Math.min(best, segmentDistance(point, line[i - 1], line[i]))
  }
  return best
}

/** The streets sorted by distance from the point (ties alphabetical), each with `distance_m` unrounded. */
export function streetsByDistance (point, streets) {
  return streets.map(s => ({ name: s.name, distance_m: streetDistance(point, s) }))
    .sort((a, b) => a.distance_m - b.distance_m || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** The location label: the nearest street's name within 150 m, else "Not near a named street". */
export function locationLabel (point, streets) {
  const nearest = streetsByDistance(point, streets)[0]
  return nearest && nearest.distance_m <= STREET_LABEL_MAX_M ? nearest.name : NO_STREET_LABEL
}
