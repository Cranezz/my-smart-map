// =============================================================================
// US Property Map — app.js  (v2)
// =============================================================================
// Layer stack (bottom → top):
//   1. ESRI Satellite
//   2. OSM Building footprints  (every house, zoom 15+)
//   3. Idaho/Regrid Parcel fills  (hover gold)
//   4. Parcel outlines  (grey → white on hover)
//   5. US State boundary lines
//   6. ESRI Transportation overlay  (roads + road names)
//   7. ESRI Boundaries & Places overlay  (city names, state names)
// =============================================================================

// ---------------------------------------------------------------------------
// 1. Config & constants
// ---------------------------------------------------------------------------

const CONFIG        = window.MAP_CONFIG || {};
const REGRID_TOKEN  = CONFIG.REGRID_TOKEN  || '';
const USE_REGRID    = REGRID_TOKEN.length  > 0;

// Idaho as the default view
const DEFAULT_CENTER    = CONFIG.DEFAULT_CENTER    || [-114.7420, 44.0682];
const DEFAULT_ZOOM      = CONFIG.DEFAULT_ZOOM      || 6.5;
const PARCEL_MIN_ZOOM   = CONFIG.PARCEL_MIN_ZOOM   || 11;  // show lines earlier
const BUILDING_MIN_ZOOM = 15;  // OSM buildings appear at street level

// Source / layer IDs
const SOURCE_ID          = 'parcels';
const PRICE_FILL_ID      = 'price-fills';   // value gradient fill (new)
const FILL_LAYER_ID      = 'parcel-fills';
const OUTLINE_LAYER_ID   = 'parcel-outlines';
const BUILDING_SOURCE_ID = 'osm-buildings';
const BUILDING_FILL_ID   = 'buildings-fill';
const BUILDING_LINE_ID   = 'buildings-outline';
const REGRID_SOURCE_LAYER = 'parcels';

// Idaho bounding box — used to guard IDWR demo queries
const IDAHO_BOUNDS = { west: -117.24, east: -111.04, south: 41.99, north: 49.00 };

// IDWR statewide Idaho parcel API (free, no key required)
const IDWR_URL =
  'https://gis.idwr.idaho.gov/hosting/rest/services/Reference/Parcels/FeatureServer/0/query';

// OpenStreetMap Overpass API for building footprints
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// ---------------------------------------------------------------------------
// 2. Map initialisation
// ---------------------------------------------------------------------------

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {},
    layers: [],
    // Glyph font for state/label text rendering
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  },
  center: DEFAULT_CENTER,
  zoom: DEFAULT_ZOOM,
  minZoom: 3,
  maxZoom: 21,
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'imperial' }), 'bottom-left');

map.on('load', addLayers);
map.on('zoom', updateZoomHint);

// ---------------------------------------------------------------------------
// 3. Layer setup — order here defines visual stack
// ---------------------------------------------------------------------------

function addLayers() {
  // -- Raster base --
  addSatelliteLayer();

  // -- Vector data (buildings → price gradient → hover fill → outlines → state) --
  addBuildingLayers();
  addParcelSource();
  addPriceFillLayer();    // NEW: red/green gradient by assessed value
  addParcelFillLayer();   // hover gold (sits above price fill)
  addParcelOutlineLayer();
  addStateLinesLayer();

  // -- Raster reference overlays (roads + labels sit on top of everything) --
  addTransportationOverlay();
  addLabelsOverlay();

  // -- Interactivity --
  setupHoverHandlers();
  setupDynamicLoading();

  // -- UI --
  updateDataModeBadge();
  updateZoomHint();
  buildLegend();
}

// 3a — ESRI World Imagery satellite base
function addSatelliteLayer() {
  map.addSource('esri-satellite', {
    type: 'raster',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    ],
    tileSize: 256,
    attribution:
      'Imagery &copy; Esri, Maxar, GeoEye, Earthstar Geographics, ' +
      'CNES/Airbus DS, USDA, USGS, AeroGRID, IGN',
  });
  map.addLayer({ id: 'satellite', type: 'raster', source: 'esri-satellite' });
}

// 3b — OSM building footprint layers (every house, loaded dynamically)
function addBuildingLayers() {
  // Empty collection — gets populated by loadBuildings() as user pans
  map.addSource(BUILDING_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Subtle orange/amber fill so buildings are visible on satellite
  map.addLayer({
    id: BUILDING_FILL_ID,
    type: 'fill',
    source: BUILDING_SOURCE_ID,
    minzoom: BUILDING_MIN_ZOOM,
    paint: {
      'fill-color': '#E8A44A',
      'fill-opacity': 0.25,
    },
  });

  map.addLayer({
    id: BUILDING_LINE_ID,
    type: 'line',
    source: BUILDING_SOURCE_ID,
    minzoom: BUILDING_MIN_ZOOM,
    paint: {
      'line-color': '#E8A44A',
      'line-width': 0.7,
      'line-opacity': 0.7,
    },
  });
}

// 3c — Parcel source: Regrid MVT tiles (nationwide) OR IDWR dynamic GeoJSON (Idaho)
function addParcelSource() {
  if (USE_REGRID) {
    map.addSource(SOURCE_ID, {
      type: 'vector',
      tiles: [
        `https://tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt?token=${REGRID_TOKEN}`
      ],
      minzoom: PARCEL_MIN_ZOOM,
      maxzoom: 20,
      attribution: 'Parcels &copy; <a href="https://regrid.com" target="_blank">Regrid</a>',
    });
  } else {
    // Demo: empty GeoJSON source, populated dynamically by loadIdahoParcels()
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      generateId: true,
    });
  }
}

// 3d — Price gradient fill — semi-transparent red/green overlay per parcel.
//      Uses assessed land+improvement value (Regrid) or sale price on a log10
//      scale so the gradient is meaningful across a wide range of property values.
//      Falls back to near-transparent grey when no value data is available (IDWR).
function addPriceFillLayer() {
  const def = {
    id: PRICE_FILL_ID,
    type: 'fill',
    source: SOURCE_ID,
    minzoom: PARCEL_MIN_ZOOM,
    paint: {
      'fill-color':   priceColorExpr(),
      'fill-opacity': 1,  // opacity is baked into the rgba() colors in the expression
    },
  };
  if (USE_REGRID) def['source-layer'] = REGRID_SOURCE_LAYER;
  map.addLayer(def);
}

/**
 * MapLibre expression: maps assessed property value → rgba color.
 *
 * Scale (log10):
 *   0   = $1      → near-transparent grey  (no data)
 *   3   = $1 K    → green
 *   4   = $10 K   → yellow-green
 *   4.7 = $50 K   → yellow
 *   5.2 = $150 K  → orange
 *   5.7 = $500 K  → red-orange
 *   6+  = $1 M+   → deep red
 *
 * Regrid value fields used (in priority order):
 *   saleprice  → most recent recorded sale price
 *   landval + improvval → county-assessed total value
 */
function priceColorExpr() {
  // Total value: prefer sale price, fall back to assessed land + improvement
  const totalValue = [
    'coalesce',
    ['get', 'saleprice'],
    ['+',
      ['coalesce', ['get', 'landval'],   0],
      ['coalesce', ['get', 'improvval'], 0],
    ],
    0,
  ];

  // log10 of max(1, value) so log is always ≥ 0
  const logVal = ['log10', ['max', 1, totalValue]];

  return ['interpolate', ['linear'], logVal,
    0,    'rgba(160, 160, 160, 0.07)',  // no data — nearly invisible grey
    2.5,  'rgba(34,  197,  94, 0.42)',  // ~$300     — green
    3.5,  'rgba(101, 220, 50,  0.44)',  // ~$3 K     — bright green
    4.3,  'rgba(220, 220, 30,  0.46)',  // ~$20 K    — yellow
    4.7,  'rgba(255, 165, 0,   0.48)',  // ~$50 K    — orange
    5.2,  'rgba(255, 90,  30,  0.50)',  // ~$160 K   — red-orange
    5.7,  'rgba(230, 40,  40,  0.52)',  // ~$500 K   — red
    6.5,  'rgba(139, 0,   0,   0.55)',  // ~$3 M+    — deep red
  ];
}

// 3e — Parcel fill (transparent → gold on hover)
function addParcelFillLayer() {
  const def = {
    id: FILL_LAYER_ID,
    type: 'fill',
    source: SOURCE_ID,
    minzoom: PARCEL_MIN_ZOOM,
    paint: {
      'fill-color': [
        'case', ['boolean', ['feature-state', 'hover'], false],
        '#FFD700', 'rgba(0,0,0,0)',
      ],
      'fill-opacity': [
        'case', ['boolean', ['feature-state', 'hover'], false],
        0.35, 0,
      ],
    },
  };
  if (USE_REGRID) def['source-layer'] = REGRID_SOURCE_LAYER;
  map.addLayer(def);
}

// 3e — Parcel outline — color-coded by land use type when Regrid provides the
//      usedesc field; falls back to grey when no land use data is available (IDWR).
//      Brightens to white on hover regardless of land use color.
function addParcelOutlineLayer() {
  const def = {
    id: OUTLINE_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    minzoom: PARCEL_MIN_ZOOM,
    paint: {
      'line-color': landUseColorExpr(),
      'line-width': [
        'case', ['boolean', ['feature-state', 'hover'], false],
        2.5, 1,
      ],
      'line-opacity': [
        'case', ['boolean', ['feature-state', 'hover'], false],
        1, 0.8,
      ],
    },
  };
  if (USE_REGRID) def['source-layer'] = REGRID_SOURCE_LAYER;
  map.addLayer(def);
}

/**
 * Returns a MapLibre expression that maps land-use description strings
 * to colors. Works on Regrid's `usedesc` field. Falls back to grey
 * when the field is absent (IDWR demo data has no land-use field).
 *
 * Color key:
 *   Blue    (#4A9EFF) — Residential
 *   Gold    (#FFD700) — Commercial
 *   Red     (#FF6B6B) — Industrial
 *   Green   (#4CAF50) — Agricultural / Rural / Timber
 *   Cyan    (#26C6DA) — Public / Government / Exempt
 *   Grey    (#888888) — Vacant / Undeveloped
 *   Lt grey (#AAAAAA) — Unknown / No data
 */
function landUseColorExpr() {
  // desc evaluates to a lowercase string; we repeat it in each branch.
  // MapLibre's `in` operator: ['in', substring, string_expr] → boolean
  function d() {
    return ['downcase', ['coalesce', ['get', 'usedesc'], ['get', 'USEDESC'], '']];
  }

  return [
    'case',
    // Hover always wins → white
    ['boolean', ['feature-state', 'hover'], false], '#FFFFFF',

    // --- Residential (blue) ---
    ['any',
      ['in', 'residential',  d()],
      ['in', 'single family', d()],
      ['in', 'single-family', d()],
      ['in', 'duplex',        d()],
      ['in', 'triplex',       d()],
      ['in', 'condo',         d()],
      ['in', 'townhouse',     d()],
      ['in', 'mobile home',   d()],
      ['in', 'multi family',  d()],
      ['in', 'apartment',     d()],
    ], '#4A9EFF',

    // --- Commercial (gold) ---
    ['any',
      ['in', 'commercial', d()],
      ['in', 'retail',     d()],
      ['in', 'office',     d()],
      ['in', 'hotel',      d()],
      ['in', 'motel',      d()],
      ['in', 'shopping',   d()],
      ['in', 'restaurant', d()],
    ], '#FFD700',

    // --- Industrial (red) ---
    ['any',
      ['in', 'industrial',     d()],
      ['in', 'warehouse',      d()],
      ['in', 'manufacturing',  d()],
      ['in', 'quarry',         d()],
      ['in', 'mining',         d()],
      ['in', 'utility',        d()],
    ], '#FF6B6B',

    // --- Agricultural / Rural / Timber (green) ---
    ['any',
      ['in', 'agricultural', d()],
      ['in', 'agriculture',  d()],
      ['in', 'farm',         d()],
      ['in', 'ranch',        d()],
      ['in', 'rural',        d()],
      ['in', 'cropland',     d()],
      ['in', 'pasture',      d()],
      ['in', 'timber',       d()],
      ['in', 'forest',       d()],
      ['in', 'grazing',      d()],
      ['in', 'orchard',      d()],
    ], '#4CAF50',

    // --- Public / Government / Exempt (cyan) ---
    ['any',
      ['in', 'government', d()],
      ['in', 'public',     d()],
      ['in', 'exempt',     d()],
      ['in', 'park',       d()],
      ['in', 'school',     d()],
      ['in', 'church',     d()],
      ['in', 'cemetery',   d()],
      ['in', 'hospital',   d()],
    ], '#26C6DA',

    // --- Vacant / Undeveloped (medium grey) ---
    ['any',
      ['in', 'vacant',       d()],
      ['in', 'undeveloped',  d()],
    ], '#888888',

    // --- Default: no land-use data or unrecognized type ---
    '#AAAAAA',
  ];
}

// 3f — US State boundary lines (GeoJSON from CDN)
function addStateLinesLayer() {
  map.addSource('us-states', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',
  });

  // State border lines — bright orange so they stand out on satellite
  map.addLayer({
    id: 'state-lines',
    type: 'line',
    source: 'us-states',
    paint: {
      'line-color': '#FF7A00',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.5, 8, 2.5],
      'line-opacity': 0.9,
    },
  });

  // State name text labels from the GeoJSON 'name' property
  map.addLayer({
    id: 'state-name-labels',
    type: 'symbol',
    source: 'us-states',
    maxzoom: 7,   // hide once zoomed in — ESRI overlay takes over
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9, 6, 14],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.12,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': 'rgba(0,0,0,0.75)',
      'text-halo-width': 1.8,
    },
  });
}

// 3g — ESRI World Transportation raster overlay (roads + road names)
function addTransportationOverlay() {
  map.addSource('esri-transportation', {
    type: 'raster',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'
    ],
    tileSize: 256,
    attribution: 'Roads &copy; Esri',
  });
  map.addLayer({
    id: 'transportation',
    type: 'raster',
    source: 'esri-transportation',
    paint: { 'raster-opacity': 0.9 },
  });
}

// 3h — ESRI World Boundaries & Places raster overlay
//      (city names, state names, country names — sits on top of everything)
function addLabelsOverlay() {
  map.addSource('esri-labels', {
    type: 'raster',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
    ],
    tileSize: 256,
    attribution: 'Labels &copy; Esri',
  });
  map.addLayer({
    id: 'reference-labels',
    type: 'raster',
    source: 'esri-labels',
    paint: { 'raster-opacity': 1 },
  });
}

// ---------------------------------------------------------------------------
// 4. Dynamic data loading — fires on map move/zoom
// ---------------------------------------------------------------------------

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function setupDynamicLoading() {
  const onMove = debounce(() => {
    loadIdahoParcels();
    loadBuildings();
  }, 600);

  map.on('moveend', onMove);
  // Trigger once immediately for the initial view
  setTimeout(onMove, 300);
}

// 4a — Load Idaho parcel boundaries from IDWR for the current viewport
//      Only runs in demo mode (Regrid handles its own tiles)
async function loadIdahoParcels() {
  if (USE_REGRID) return;
  const zoom = map.getZoom();
  if (zoom < PARCEL_MIN_ZOOM) return;

  const b = map.getBounds();

  // Skip if the viewport doesn't overlap with Idaho at all
  if (b.getEast()  < IDAHO_BOUNDS.west ||
      b.getWest()  > IDAHO_BOUNDS.east ||
      b.getNorth() < IDAHO_BOUNDS.south ||
      b.getSouth() > IDAHO_BOUNDS.north) {
    return;
  }

  // Clamp query envelope to Idaho so we don't request outside data
  const env = {
    xmin: Math.max(b.getWest(),  IDAHO_BOUNDS.west),
    ymin: Math.max(b.getSouth(), IDAHO_BOUNDS.south),
    xmax: Math.min(b.getEast(),  IDAHO_BOUNDS.east),
    ymax: Math.min(b.getNorth(), IDAHO_BOUNDS.north),
    spatialReference: { wkid: 4326 },
  };

  const params = new URLSearchParams({
    geometry:         JSON.stringify(env),
    geometryType:     'esriGeometryEnvelope',
    spatialRel:       'esriSpatialRelIntersects',
    outFields:        'OBJECTID,PIN,COUNTY,OWNER,Shape__Area',
    resultRecordCount: 2000,  // IDWR max — more coverage when zoomed out
    f:                'geojson',
    outSR:            '4326',
  });

  try {
    setLoadingState(true, 'Loading Idaho parcels…');
    const res = await fetch(`${IDWR_URL}?${params}`);
    if (!res.ok) throw new Error(`IDWR ${res.status}`);
    const geojson = await res.json();
    const src = map.getSource(SOURCE_ID);
    if (src && geojson.features) src.setData(geojson);
  } catch (err) {
    console.warn('IDWR parcel load failed:', err);
  } finally {
    setLoadingState(false);
  }
}

// 4b — Load OSM building footprints via Overpass API for current viewport
//      Shows every individual house/building shape
async function loadBuildings() {
  const zoom = map.getZoom();
  if (zoom < BUILDING_MIN_ZOOM) {
    // Clear buildings when zoomed out to avoid stale data
    const src = map.getSource(BUILDING_SOURCE_ID);
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  const b = map.getBounds();
  // Clamp area to avoid querying huge regions (Overpass has a timeout)
  const bbox = [
    Math.max(b.getSouth(), b.getNorth() - 0.08).toFixed(5),
    Math.max(b.getWest(),  b.getEast()  - 0.12).toFixed(5),
    Math.min(b.getNorth(), b.getSouth() + 0.08).toFixed(5),
    Math.min(b.getEast(),  b.getWest()  + 0.12).toFixed(5),
  ].join(',');

  // Overpass QL: residential buildings + all buildings in viewport
  const query =
    `[out:json][timeout:20][bbox:${bbox}];` +
    `(way["building"];);` +
    `out geom;`;

  try {
    setLoadingState(true, 'Loading buildings…');
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const data = await res.json();
    const geojson = overpassToGeoJSON(data);
    const src = map.getSource(BUILDING_SOURCE_ID);
    if (src) src.setData(geojson);
  } catch (err) {
    console.warn('Building load failed:', err);
  } finally {
    setLoadingState(false);
  }
}

// 4c — Convert Overpass JSON → GeoJSON FeatureCollection
function overpassToGeoJSON(data) {
  return {
    type: 'FeatureCollection',
    features: (data.elements || [])
      .filter(el =>
        el.type === 'way' &&
        Array.isArray(el.geometry) &&
        el.geometry.length >= 3
      )
      .map(el => ({
        type: 'Feature',
        id: el.id,
        geometry: {
          type: 'Polygon',
          // OSM geometry uses lat/lon; GeoJSON needs [lon, lat]
          coordinates: [el.geometry.map(pt => [pt.lon, pt.lat])],
        },
        properties: {
          osm_id:    el.id,
          building:  (el.tags && el.tags.building)  || 'yes',
          name:      (el.tags && el.tags.name)       || null,
          addr:      formatOsmAddr(el.tags),
          levels:    (el.tags && el.tags['building:levels']) || null,
        },
      })),
  };
}

function formatOsmAddr(tags) {
  if (!tags) return null;
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:city'],
  ].filter(Boolean);
  return parts.length > 1 ? parts.join(' ') : null;
}

// ---------------------------------------------------------------------------
// 5. Hover interaction (parcels only — buildings are visual reference only)
// ---------------------------------------------------------------------------

let hoveredFeatureId = null;

function featureStateRef(id) {
  const ref = { source: SOURCE_ID, id };
  if (USE_REGRID) ref.sourceLayer = REGRID_SOURCE_LAYER;
  return ref;
}

function setupHoverHandlers() {
  map.on('mousemove', FILL_LAYER_ID, (e) => {
    if (!e.features || e.features.length === 0) return;

    const feature = e.features[0];

    if (hoveredFeatureId !== null) {
      map.setFeatureState(featureStateRef(hoveredFeatureId), { hover: false });
    }
    hoveredFeatureId = feature.id;
    map.setFeatureState(featureStateRef(hoveredFeatureId), { hover: true });

    showPopup(e.point, feature.properties);
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', FILL_LAYER_ID, () => {
    if (hoveredFeatureId !== null) {
      map.setFeatureState(featureStateRef(hoveredFeatureId), { hover: false });
    }
    hoveredFeatureId = null;
    hidePopup();
    map.getCanvas().style.cursor = '';
  });
}

// ---------------------------------------------------------------------------
// 6. Popup rendering
// ---------------------------------------------------------------------------

const popupEl      = document.getElementById('popup');
const popupAddress = document.getElementById('popup-address');
const popupOwner   = document.getElementById('popup-owner');
const popupSize    = document.getElementById('popup-size');

function showPopup(point, props) {
  // ---- Address / Identifier ----
  // Regrid: 'address'
  // IDWR:   parcel PIN + county (no address field in IDWR)
  // SF demo: street components
  const address =
    props.address ||
    props.ADDRESS ||
    buildAddressFromParts(props) ||
    (props.PIN ? `Parcel ${props.PIN}` : null) ||
    props.blklot ||
    'Address unavailable';

  // ---- Owner ----
  // Regrid: 'owner' field
  // IDWR: OWNER field exists but is blank by Idaho law (Idaho Code 74-120)
  const owner =
    props.owner      ||
    props.OWNER      ||
    props.OwnerName  ||
    props.owner_name ||
    null;

  // ---- Size ----
  // Regrid:  'll_gisacre'
  // IDWR:    'Shape__Area' (sq ft in native projection)
  // SF demo: 'Shape_Area'
  const rawArea =
    props.ll_gisacre  ||
    props.GIS_ACRES   ||
    props.ACRES       ||
    props.Shape__Area ||
    props.Shape_Area  ||
    null;

  let sizeText = null;
  if (rawArea !== null) {
    const n = parseFloat(rawArea);
    if (!isNaN(n) && n > 0) {
      // IDWR Shape__Area is in sq ft (Idaho State Plane is foot-based).
      // Heuristic: values > 1000 are almost certainly sq ft.
      const acres = n > 1000 ? n / 43560 : n;
      sizeText = `${acres.toFixed(4)} acres`;
    }
  }

  // ---- Property Value (Regrid fields) ----
  const salePrice  = parseFloat(props.saleprice)  || 0;
  const landVal    = parseFloat(props.landval)     || 0;
  const improvVal  = parseFloat(props.improvval)   || 0;
  const totalAssessed = landVal + improvVal;

  let valueText = null;
  if (salePrice > 0) {
    valueText = `Sale: ${formatUSD(salePrice)}`;
  } else if (totalAssessed > 0) {
    valueText = `Assessed: ${formatUSD(totalAssessed)}`;
    if (landVal > 0 && improvVal > 0) {
      valueText += ` (land ${formatUSD(landVal)} + improvements ${formatUSD(improvVal)})`;
    }
  }

  // ---- County (IDWR specific) ----
  const county = props.COUNTY ? `${props.COUNTY} County, ID` : null;

  popupAddress.textContent = address;
  popupOwner.textContent   = owner ? `Owner: ${owner}` : '';

  // Build size + value line
  const meta = [];
  if (sizeText)  meta.push(`${sizeText}`);
  if (county)    meta.push(county);
  if (valueText) {
    // Value gets its own line via the existing popup-size element color
    popupSize.innerHTML =
      (meta.length ? `<span>${meta.join(' · ')}</span><br>` : '') +
      `<span class="popup-value">${valueText}</span>`;
  } else if (meta.length) {
    popupSize.textContent = meta.join(' · ');
  } else {
    // SF demo fallback: show neighborhood + zoning
    const nb   = props.analysis_neighborhood || null;
    const zone = props.zoning_code || props.zoning_district || null;
    popupSize.textContent = [nb, zone].filter(Boolean).join(' · ') || 'Size unavailable';
  }

  // Position popup near cursor, clamped to viewport
  const offsetX = 18, offsetY = -12;
  const popupW = 270, popupH = 85;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = point.x + offsetX;
  let y = point.y + offsetY;
  if (x + popupW > vw) x = point.x - popupW - offsetX;
  if (y + popupH > vh) y = vh - popupH - 10;

  popupEl.style.left = `${x}px`;
  popupEl.style.top  = `${y}px`;
  popupEl.classList.remove('hidden');
}

function hidePopup() {
  popupEl.classList.add('hidden');
}

/** Format a number as a compact USD string: $1.2M, $340K, $85,000 */
function formatUSD(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000)    return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString('en-US')}`;
}

function buildAddressFromParts(props) {
  const rawNum = props.from_address_num || props.from_addr || '';
  const num    = (String(rawNum).trim() === '0') ? '' : String(rawNum).trim();
  const street = String(props.street_name || props.str_name || '').trim();
  const type   = String(props.street_type || props.str_type || '').trim();
  const parts  = [num, street, type].filter(Boolean);
  if (parts.length >= 2) return parts.join(' ');
  if (props.analysis_neighborhood) return props.analysis_neighborhood;
  return null;
}

// ---------------------------------------------------------------------------
// 7. UI helpers
// ---------------------------------------------------------------------------

function updateDataModeBadge() {
  const badge = document.getElementById('data-mode-badge');
  if (USE_REGRID) {
    badge.textContent = 'Live Parcels (Regrid)';
    badge.className   = 'badge badge-live';
  } else {
    badge.textContent = 'Idaho Parcels (IDWR) + OSM Buildings';
    badge.className   = 'badge badge-demo';
  }
}

function updateZoomHint() {
  const hint = document.getElementById('zoom-hint');
  if (!hint) return;
  const z = map.getZoom();
  if (z >= BUILDING_MIN_ZOOM) {
    hint.textContent = 'Hover a parcel for details · Buildings shown';
  } else if (z >= PARCEL_MIN_ZOOM) {
    hint.textContent = 'Hover a property · Zoom in more for building shapes';
  } else {
    const needed = Math.ceil(PARCEL_MIN_ZOOM - z);
    hint.textContent = `Zoom in ${needed} more level${needed !== 1 ? 's' : ''} to see property lines`;
  }
}

// Build the land-use color legend in the bottom-right panel
function buildLegend() {
  const legend = document.getElementById('legend');
  if (!legend) return;

  const entries = [
    { color: '#4A9EFF', label: 'Residential' },
    { color: '#FFD700', label: 'Commercial' },
    { color: '#FF6B6B', label: 'Industrial' },
    { color: '#4CAF50', label: 'Agricultural / Rural' },
    { color: '#26C6DA', label: 'Public / Government' },
    { color: '#888888', label: 'Vacant / Undeveloped' },
    { color: '#AAAAAA', label: 'Unknown / No data' },
    { color: '#E8A44A', label: 'Building footprint (OSM)' },
  ];

  legend.innerHTML =
    // --- Price gradient bar ---
    '<div class="legend-title">Property Value</div>' +
    '<div class="legend-gradient-wrap">' +
      '<div class="legend-gradient-bar"></div>' +
      '<div class="legend-gradient-labels">' +
        '<span>Cheap</span><span>$50K</span><span>$500K</span><span>Expensive</span>' +
      '</div>' +
    '</div>' +
    // --- Land-use outline colors ---
    '<div class="legend-title legend-title-2nd">Property Type (outline)</div>' +
    entries.map(e =>
      `<div class="legend-row">` +
      `<span class="legend-swatch" style="background:${e.color}"></span>` +
      `<span class="legend-label">${e.label}</span>` +
      `</div>`
    ).join('');

  if (!USE_REGRID) {
    legend.innerHTML +=
      '<div class="legend-note">Value gradient &amp; type colors require Regrid token. ' +
      'Idaho (IDWR) parcels have no value or land-use fields.</div>';
  }
}

// Loading indicator — shows during async data fetches
let loadingCount = 0;
function setLoadingState(loading, msg = '') {
  loadingCount += loading ? 1 : -1;
  loadingCount = Math.max(0, loadingCount);
  const el = document.getElementById('loading-indicator');
  if (!el) return;
  if (loadingCount > 0) {
    el.textContent = msg;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}
