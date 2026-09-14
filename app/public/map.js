// The one place maps are set up. Leaflet draws the map; the base map is OpenFreeMap's vector style drawn by MapLibre GL inside
// Leaflet (L.maplibreGL), with OpenFreeMap's attribution markup always visible. Once the style loads, its place-name label
// layers are hidden so the SAMPLE town is not read as the real place underneath; street and water names stay.
// No WebGL: a plain background, still with the attribution, and pins and taps still work.
// Leaflet, MapLibre and the binding are classic scripts (globals L and maplibregl). Nothing here touches them at import time,
// so Node can import placeLabelLayerIds for its unit test.

export const FALLBACK_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

// OpenFreeMap's attribution, exactly as its quick start shows it.
export const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'

// Symbol layers that name places: every layer drawn from the OpenMapTiles `place` source layer (label_town, label_village,
// label_city, label_other, label_state, label_country_*), any other `label_*` id, and airport names (they carry the real town's
// name). Street names (transportation_name), water names (water_name, waterway) and road shields are kept.
const PLACE_SOURCE_LAYERS = new Set(['place', 'aerodrome_label'])
export function placeLabelLayerIds(style) {
  const layers = Array.isArray(style?.layers) ? style.layers : []
  return layers
    .filter((l) => l && l.type === 'symbol' && (PLACE_SOURCE_LAYERS.has(l['source-layer']) || /^label_/.test(String(l.id))))
    .map((l) => l.id)
}

export function hasWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')))
  } catch {
    return false
  }
}

function hideLabels(glMap, el) {
  const apply = () => {
    const style = glMap.getStyle()
    if (!style) return
    const ids = placeLabelLayerIds(style).filter((id) => glMap.getLayer(id))
    for (const id of ids) glMap.setLayoutProperty(id, 'visibility', 'none')
    el.dataset.labelsHidden = ids.join(',')
    el.dataset.styleLoaded = '1'
  }
  glMap.on('style.load', apply)
  glMap.on('load', apply)
  if (glMap.isStyleLoaded()) apply()
}

// The boundary as a harbour-blue line with everything outside it dimmed. Neither layer takes taps: they reach the map.
function drawBoundary(map, boundary) {
  if (!boundary?.length) return
  const world = [[85, -179.9], [85, 179.9], [-85, 179.9], [-85, -179.9]]
  L.polygon([world, boundary], { stroke: false, fillColor: '#14212b', fillOpacity: 0.22, interactive: false }).addTo(map)
  L.polygon(boundary, { color: '#0a5c8a', weight: 3, opacity: 1, fill: false, interactive: false }).addTo(map)
}

// town: GET /api/town. Answers the Leaflet map.
export function townMap(el, town, { boundary = true } = {}) {
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(town.center, town.zoom)
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank">Leaflet</a>')
  let vector = false
  if (hasWebGL() && typeof L.maplibreGL === 'function') {
    try {
      const layer = L.maplibreGL({ style: town.map_style_url || FALLBACK_STYLE_URL, attributionControl: { customAttribution: ATTRIBUTION } }).addTo(map)
      hideLabels(layer.getMaplibreMap(), el)
      vector = true
    } catch {
      vector = false
    }
  }
  if (!vector) {
    map.attributionControl.addAttribution(ATTRIBUTION)
    el.classList.add('map-plain')
  }
  el.dataset.baseMap = vector ? 'vector' : 'unavailable'
  if (boundary) drawBoundary(map, town.boundary)
  return map
}

export function pinIcon() {
  return L.divIcon({
    className: 'pin-icon',
    html: '<svg viewBox="0 0 36 48" width="36" height="48" aria-hidden="true"><path d="M18 46S33 28.5 33 17A15 15 0 0 0 3 17c0 11.5 15 29 15 29z" fill="#0a5c8a" stroke="#ffffff" stroke-width="3"/><circle cx="18" cy="17" r="6" fill="#ffffff"/></svg>',
    iconSize: [36, 48],
    iconAnchor: [18, 46],
  })
}
