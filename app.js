// =============================================================================
// US Property Map — app.js
// =============================================================================
// Reads window.MAP_CONFIG (set in index.html inline script, optionally
// overridden by config.js). Falls back gracefully to demo GeoJSON mode
// when no Regrid API token is configured.
// =============================================================================

// ---------------------------------------------------------------------------
// 1. Config & constants
// ---------------------------------------------------------------------------

const CONFIG = window.MAP_CONFIG || {};
const REGRID_TOKEN = CONFIG.REGRID_TOKEN || '';
const USE_REGRID = REGRID_TOKEN.length > 0;

const DEFAULT_CENTER = CONFIG.DEFAULT_CENTER || [-98.5795, 39.8283];
const DEFAULT_ZOOM   = CONFIG.DEFAULT_ZOOM   || 4;
const PARCEL_MIN_ZOOM = CONFIG.PARCEL_MIN_ZOOM || 14;

// Layer/source IDs — defined once to avoid string typos
const SOURCE_ID       = 'parcels';
const FILL_LAYER_ID   = 'parcel-fills';
const OUTLINE_LAYER_ID = 'parcel-outlines';

// For Regrid MVT tiles the data lives in this source-layer inside each tile
const REGRID_SOURCE_LAYER = 'parcels';

// ---------------------------------------------------------------------------
// 2. Map initialisation
// ---------------------------------------------------------------------------

const map = new maplibregl.Map({
  container: 'map',
  // Minimal blank style — we add our own sources rather than using a hosted
  // style URL, keeping the app self-contained and free
  style: {
    version: 8,
    sources: {},
    layers: [],
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  },
  center: DEFAULT_CENTER,
  zoom: DEFAULT_ZOOM,
  minZoom: 3,
  maxZoom: 21,
});

// Navigation controls (zoom +/- and compass)
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// Show scale bar
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'imperial' }), 'bottom-left');

// Once the map style is loaded, add all layers
map.on('load', addLayers);

// Update the zoom hint text as the user zooms in/out
map.on('zoom', updateZoomHint);

// ---------------------------------------------------------------------------
// 3. Layer setup
// ---------------------------------------------------------------------------

function addLayers() {
  addSatelliteLayer();
  addParcelSource();
  addParcelFillLayer();
  addParcelOutlineLayer();
  setupHoverHandlers();
  updateDataModeBadge();
  updateZoomHint();
}

// 3a — ESRI World Imagery satellite raster (free, no API key required)
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

  map.addLayer({
    id: 'satellite',
    type: 'raster',
    source: 'esri-satellite',
    paint: { 'raster-opacity': 1 },
  });
}

// 3b — Parcel data source: Regrid MVT tiles OR bundled demo GeoJSON
function addParcelSource() {
  if (USE_REGRID) {
    // Nationwide US parcel data via Regrid MVT vector tiles.
    // Token is passed as a URL query parameter (documented Regrid method).
    // Tiles only load at zoom 14+ — this guards the free-tier quota.
    map.addSource(SOURCE_ID, {
      type: 'vector',
      tiles: [
        `https://tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt?token=${REGRID_TOKEN}`
      ],
      minzoom: PARCEL_MIN_ZOOM,
      maxzoom: 20,
      attribution: 'Parcel data &copy; <a href="https://regrid.com" target="_blank">Regrid</a>',
    });
  } else {
    // Demo mode: pre-clipped GeoJSON for a San Francisco neighborhood.
    // generateId: true assigns an integer id to each feature, which is
    // required for setFeatureState to work on GeoJSON sources.
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: './data/demo-parcels.geojson',
      generateId: true,
    });
  }
}

// 3c — Transparent fill polygon layer.
// Becomes gold (semi-transparent) on hover via GPU feature-state — no JS
// style updates needed per frame, just a state flag change.
function addParcelFillLayer() {
  const layerDef = {
    id: FILL_LAYER_ID,
    type: 'fill',
    source: SOURCE_ID,
    minzoom: PARCEL_MIN_ZOOM,
    paint: {
      'fill-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        '#FFD700',          // gold highlight on hover
        'rgba(0,0,0,0)',    // fully transparent at rest
      ],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        0.35,  // semi-transparent on hover
        0,     // invisible at rest (outlines still show)
      ],
    },
  };

  // Vector tiles require a source-layer to identify which data layer
  // inside the MVT tile to read from
  if (USE_REGRID) {
    layerDef['source-layer'] = REGRID_SOURCE_LAYER;
  }

  map.addLayer(layerDef);
}

// 3d — Grey outline layer. Also brightens on hover via feature-state.
function addParcelOutlineLayer() {
  const layerDef = {
    id: OUTLINE_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    minzoom: PARCEL_MIN_ZOOM,
    paint: {
      'line-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        '#FFFFFF',    // bright white on hover
        '#AAAAAA',    // grey at rest
      ],
      'line-width': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        2,    // thicker on hover
        0.8,  // thin at rest
      ],
      'line-opacity': 0.85,
    },
  };

  if (USE_REGRID) {
    layerDef['source-layer'] = REGRID_SOURCE_LAYER;
  }

  map.addLayer(layerDef);
}

// ---------------------------------------------------------------------------
// 4. Hover interaction
// ---------------------------------------------------------------------------

// Track the currently-hovered feature ID so we can clear its state when
// the mouse moves to a different parcel
let hoveredFeatureId = null;

function featureStateRef(id) {
  // Builds the correct object for setFeatureState / removeFeatureState.
  // Regrid vector tiles need sourceLayer; GeoJSON sources do not.
  const ref = { source: SOURCE_ID, id };
  if (USE_REGRID) ref.sourceLayer = REGRID_SOURCE_LAYER;
  return ref;
}

function setupHoverHandlers() {
  // mousemove on the fill layer — triggers even when outline is topmost
  // because the fill covers the full polygon area
  map.on('mousemove', FILL_LAYER_ID, (e) => {
    if (!e.features || e.features.length === 0) return;

    const feature = e.features[0];

    // Clear previous hover state
    if (hoveredFeatureId !== null) {
      map.setFeatureState(featureStateRef(hoveredFeatureId), { hover: false });
    }

    // Set new hover state
    hoveredFeatureId = feature.id;
    map.setFeatureState(featureStateRef(hoveredFeatureId), { hover: true });

    // Show the info popup near the cursor
    showPopup(e.point, feature.properties);

    // Pointer cursor signals the layer is interactive
    map.getCanvas().style.cursor = 'pointer';
  });

  // Mouse left the fill layer — clear everything
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
// 5. Popup rendering
// ---------------------------------------------------------------------------

const popupEl      = document.getElementById('popup');
const popupAddress = document.getElementById('popup-address');
const popupOwner   = document.getElementById('popup-owner');
const popupSize    = document.getElementById('popup-size');

/**
 * Display the popup near `point` with data from `properties`.
 * Field names differ between Regrid tiles and the SF demo GeoJSON,
 * so we use a series of fallbacks for each displayed value.
 */
function showPopup(point, props) {
  // --- Address ---
  // Regrid: 'address' field  |  SF demo: individual components
  const address =
    props.address ||
    props.ADDRESS ||
    buildAddressFromParts(props) ||
    props.blklot ||        // SF parcel block+lot ID as fallback label
    'Address unavailable';

  // --- Owner ---
  // Regrid provides this; most public demo datasets omit it for privacy
  const owner =
    props.owner ||
    props.OWNER ||
    props.OwnerName ||
    props.owner_name ||
    null;

  // --- Size (acreage) ---
  // Regrid: 'll_gisacre'  |  Some county data: 'GIS_ACRES', 'Shape_Area', 'AREA'
  const rawAcres =
    props.ll_gisacre ||
    props.GIS_ACRES  ||
    props.ACRES      ||
    props.Shape_Area ||   // Shape_Area is usually sq ft or sq meters — note below
    null;

  let sizeText = 'Size unavailable';
  if (rawAcres !== null) {
    const n = parseFloat(rawAcres);
    if (!isNaN(n)) {
      // If the value is very large it's probably in sq ft (1 acre = 43,560 sq ft)
      // or sq meters (1 acre = 4046.86 sq m). Heuristic: if > 1000 assume sq ft.
      const acres = n > 1000 ? n / 43560 : n;
      sizeText = `${acres.toFixed(4)} acres`;
    }
  }

  popupAddress.textContent = address;
  popupOwner.textContent   = owner ? `Owner: ${owner}` : '';

  // For the SF demo dataset, show neighborhood + zoning when no acreage is available
  const neighborhood = props.analysis_neighborhood || null;
  const zoning       = props.zoning_code || props.zoning_district || null;
  const district     = props.supervisor_district ? `District ${props.supervisor_district}` : null;
  const extraInfo    = [neighborhood, zoning, district].filter(Boolean).join(' · ');

  if (rawAcres !== null) {
    popupSize.textContent = `Size: ${sizeText}`;
  } else if (extraInfo) {
    popupSize.textContent = extraInfo;
  } else {
    popupSize.textContent = 'Size unavailable';
  }

  // Position popup offset from cursor so it doesn't cover what the user
  // is hovering. Clamp to viewport so it doesn't go off-screen.
  const offsetX = 18;
  const offsetY = -12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let x = point.x + offsetX;
  let y = point.y + offsetY;

  // Rough popup size estimate for clamping
  const popupW = 260;
  const popupH = 80;
  if (x + popupW > vw) x = point.x - popupW - offsetX;
  if (y + popupH > vh) y = vh - popupH - 10;

  popupEl.style.left = `${x}px`;
  popupEl.style.top  = `${y}px`;
  popupEl.classList.remove('hidden');
}

function hidePopup() {
  popupEl.classList.add('hidden');
}

/** Reconstruct an address string from street component fields (SF demo format) */
function buildAddressFromParts(props) {
  const rawNum = props.from_address_num || props.from_addr || '';
  // Skip address number if it is 0 (common placeholder in SF dataset)
  const num    = (String(rawNum).trim() === '0') ? '' : String(rawNum).trim();
  const street = String(props.street_name || props.str_name || '').trim();
  const type   = String(props.street_type || props.str_type || '').trim();

  // Build "123 MAIN ST" style string
  const streetParts = [num, street, type].filter(Boolean);
  if (streetParts.length >= 2) return streetParts.join(' ');

  // Fall back to neighborhood name if available
  if (props.analysis_neighborhood) return props.analysis_neighborhood;

  return null;
}

// ---------------------------------------------------------------------------
// 6. UI helpers
// ---------------------------------------------------------------------------

function updateDataModeBadge() {
  const badge = document.getElementById('data-mode-badge');
  if (USE_REGRID) {
    badge.textContent = 'Live Parcels (Regrid)';
    badge.className   = 'badge badge-live';
  } else {
    badge.textContent = 'Demo Mode (SF parcels)';
    badge.className   = 'badge badge-demo';
  }
}

function updateZoomHint() {
  const hint = document.getElementById('zoom-hint');
  if (!hint) return;
  const z = map.getZoom();
  if (z >= PARCEL_MIN_ZOOM) {
    hint.textContent = 'Hover over a property to see details';
  } else {
    const needed = Math.ceil(PARCEL_MIN_ZOOM - z);
    hint.textContent = `Zoom in ${needed} more level${needed !== 1 ? 's' : ''} to see property lines`;
  }
}
