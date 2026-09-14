// Pure geometry: haversine, point in ring, nearest street, ward. No Worker needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { haversine, pointInRing, wardOf, locationLabel, streetsByDistance, NO_STREET_LABEL } from '../src/geo.js'
import { TOWN } from '../src/town-data.js'
import { POINTS } from './test-points.js'

const METRE_LAT = 1 / 111195.0797
const north = ([lat, lng], m) => [lat + m * METRE_LAT, lng]

test('haversine matches the formula written out', () => {
  const a = [47.5615, -52.7126]
  const b = POINTS.inside_centre
  // d = 2R asin( sqrt( sin²(Δφ/2) + cos φ1 cos φ2 sin²(Δλ/2) ) ), R = 6 371 008.8 m
  const R = 6371008.8
  const toRad = Math.PI / 180
  const phi1 = a[0] * toRad
  const phi2 = b[0] * toRad
  const dPhi = (b[0] - a[0]) * toRad
  const dLambda = (b[1] - a[1]) * toRad
  const inner = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2)
  const expected = 2 * R * Math.asin(Math.sqrt(inner))
  assert.ok(expected > 250000 && expected < 300000, `sanity: ${expected}`)
  assert.ok(Math.abs(haversine(a, b) - expected) < 1e-6)
  assert.equal(haversine(b, b), 0)
})

test('a point moved north by 40 m and 60 m measures 40 and 60', () => {
  const p = POINTS.inside_centre
  assert.ok(Math.abs(haversine(p, north(p, 40)) - 40) <= 0.01, String(haversine(p, north(p, 40))))
  assert.ok(Math.abs(haversine(p, north(p, 60)) - 60) <= 0.01, String(haversine(p, north(p, 60))))
})

test('town boundary: inside_centre inside, outside_south and outside_east_of_boundary outside', () => {
  assert.equal(pointInRing(POINTS.inside_centre, TOWN.boundary), true)
  assert.equal(pointInRing(POINTS.outside_south, TOWN.boundary), false)
  assert.equal(pointInRing(POINTS.outside_east_of_boundary, TOWN.boundary), false)
  assert.equal(pointInRing(POINTS.on_street.point, TOWN.boundary), true)
  assert.equal(pointInRing(POINTS.far_from_streets_inside.point, TOWN.boundary), true)
})

test('point in ring: a square and a concave U shape', () => {
  // [lat, lng] with lng as x: the square x 0..3, y 0..3
  const square = [[0, 0], [0, 3], [3, 3], [3, 0]]
  assert.equal(pointInRing([1.5, 1.5], square), true)
  assert.equal(pointInRing([1.5, 4], square), false)
  assert.equal(pointInRing([-1, 1.5], square), false)
  // A U open to the east: the notch x 1..3, y 1..2 is outside.
  const u = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]]
  assert.equal(pointInRing([1.5, 0.5], u), true, 'the west bar')
  assert.equal(pointInRing([0.5, 2], u), true, 'the south arm')
  assert.equal(pointInRing([2.5, 2], u), true, 'the north arm')
  assert.equal(pointInRing([1.5, 2], u), false, 'inside the notch')
  assert.equal(pointInRing([1.5, 4], u), false, 'east of everything')
  assert.equal(pointInRing([1.5, -1], u), false, 'west of everything')
})

test('location label: on_street gets its street, far_from_streets_inside is not near a named street', () => {
  const on = POINTS.on_street
  assert.equal(locationLabel(on.point, TOWN.streets), on.street)
  const [first, second] = streetsByDistance(on.point, TOWN.streets)
  assert.equal(first.name, on.street)
  assert.ok(first.distance_m < 5, `on the street: ${first.distance_m}`)
  assert.equal(Math.round(second.distance_m), on.nearest_other_street_m)

  const far = POINTS.far_from_streets_inside
  assert.equal(locationLabel(far.point, TOWN.streets), NO_STREET_LABEL)
  assert.equal(NO_STREET_LABEL, 'Not near a named street')
  assert.equal(Math.round(streetsByDistance(far.point, TOWN.streets)[0].distance_m), far.nearest_street_m)
})

test('location label: the 150 m limit is inclusive and ties go alphabetical', () => {
  const street = (name, lat) => ({ name, lines: [[[lat, -55.36], [lat, -55.34]]] })
  const p = [49.14, -55.35]
  assert.equal(locationLabel(p, [street('Far Road', 49.14 + 151 * METRE_LAT)]), NO_STREET_LABEL)
  assert.equal(locationLabel(p, [street('Near Road', 49.14 + 149 * METRE_LAT)]), 'Near Road')
  assert.equal(locationLabel(p, [street('Zed Road', 49.14 + 20 * METRE_LAT), street('Ash Road', 49.14 - 20 * METRE_LAT)]), 'Ash Road')
})

test('ward lookup: one point per ward, and none outside every ward', () => {
  assert.equal(wardOf([49.15, -55.35], TOWN.wards), 'north')
  assert.equal(wardOf(POINTS.inside_centre, TOWN.wards), 'centre')
  assert.equal(wardOf([49.12, -55.35], TOWN.wards), 'south')
  assert.equal(wardOf([49.3, -55.35], TOWN.wards), null)
})
