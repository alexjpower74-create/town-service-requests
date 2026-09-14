// Unit test for map.js placeLabelLayerIds, against OpenFreeMap's positron style saved in data/sources (no network).
// It must hide every place-name label (label_town, label_village, label_city and the other place label_* layers) and keep the
// street and water name layers. Run: node --test app/tests/unit/map-labels.test.mjs
// The checker is itself shown to fail: a function that hides too little and one that hides too much must both be caught.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { placeLabelLayerIds } from '../../public/map.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STYLE = JSON.parse(readFileSync(path.join(HERE, '..', '..', '..', 'data', 'sources', 'openfreemap-positron-style.json'), 'utf8'))

// Everything wrong with a hide function's answer for a style, as sentences. [] means right.
function problems(fn, style) {
  const out = []
  const hidden = new Set(fn(style))
  const byId = new Map(style.layers.map((l) => [l.id, l]))
  for (const id of ['label_town', 'label_village', 'label_city']) if (!hidden.has(id)) out.push(`${id} is not hidden`)
  for (const l of style.layers) {
    if (l['source-layer'] === 'place' && !hidden.has(l.id)) out.push(`place layer ${l.id} is not hidden`)
    if (/^label_/.test(l.id) && !hidden.has(l.id)) out.push(`${l.id} is not hidden`)
    const keep = l['source-layer'] === 'transportation_name' || l['source-layer'] === 'water_name' || l['source-layer'] === 'waterway'
    if (keep && hidden.has(l.id)) out.push(`street/water name layer ${l.id} is hidden`)
    if (l.type !== 'symbol' && hidden.has(l.id)) out.push(`non-label layer ${l.id} is hidden`)
  }
  for (const id of hidden) if (!byId.has(id)) out.push(`${id} is not a layer in the style`)
  return out
}

test('the saved positron style has the layers this test is about', () => {
  const ids = STYLE.layers.map((l) => l.id)
  for (const id of ['label_town', 'label_village', 'label_city', 'label_other', 'highway-name-minor', 'highway-name-major', 'water_name_point_label', 'water_name_line_label']) {
    assert.ok(ids.includes(id), `style has ${id}`)
  }
})

test('hides every place label and keeps street and water names', () => {
  assert.deepEqual(problems(placeLabelLayerIds, STYLE), [])
  const hidden = placeLabelLayerIds(STYLE)
  for (const id of ['label_town', 'label_village', 'label_city', 'label_other', 'label_state', 'label_city_capital', 'label_country_1', 'label_country_2', 'label_country_3']) {
    assert.ok(hidden.includes(id), `${id} hidden`)
  }
  for (const id of ['highway-name-path', 'highway-name-minor', 'highway-name-major', 'water_name_point_label', 'water_name_line_label', 'waterway_line_label']) {
    assert.ok(!hidden.includes(id), `${id} kept`)
  }
})

test('negative control: the checker catches a function that hides too little, and one that hides too much', () => {
  const tooLittle = () => ['label_town']
  const tooMuch = (style) => style.layers.filter((l) => l.type === 'symbol').map((l) => l.id)
  const noPlaceSourceCheck = (style) => style.layers.filter((l) => ['label_town', 'label_village', 'label_city'].includes(l.id)).map((l) => l.id)
  assert.ok(problems(tooLittle, STYLE).length > 0, 'hiding only label_town is caught')
  assert.ok(problems(tooMuch, STYLE).some((p) => p.includes('highway-name')), 'hiding street names is caught')
  assert.ok(problems(noPlaceSourceCheck, STYLE).some((p) => p.includes('label_other')), 'missing label_other is caught')
})

test('odd styles answer an empty list', () => {
  assert.deepEqual(placeLabelLayerIds(undefined), [])
  assert.deepEqual(placeLabelLayerIds({}), [])
  assert.deepEqual(placeLabelLayerIds({ layers: [{ id: 'background', type: 'background' }] }), [])
  assert.deepEqual(placeLabelLayerIds({ layers: [{ id: 'label_town', type: 'symbol' }] }), ['label_town'], 'a label_ id without source-layer')
})
