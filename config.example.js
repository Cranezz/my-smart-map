// =============================================================================
// config.example.js  —  COMMITTED TO GIT (safe, no real keys here)
// =============================================================================
// Copy this file to config.js and fill in your values.
// config.js is listed in .gitignore so your API token never enters the repo.
//
// If config.js is missing (e.g. on GitHub Pages), the app automatically
// falls back to demo mode using the bundled San Francisco parcel dataset.
// =============================================================================

window.MAP_CONFIG = {

  // -------------------------------------------------------------------------
  // Regrid API token for nationwide US parcel data.
  // Get a free account + token at: https://regrid.com/api
  //
  // Free tier: limited parcel tile requests per month.
  // The app only loads parcel tiles at zoom level 14+, which keeps usage low.
  //
  // Leave as empty string "" to use the bundled demo dataset instead.
  // -------------------------------------------------------------------------
  REGRID_TOKEN: '',

  // -------------------------------------------------------------------------
  // Initial map view — center coordinates [longitude, latitude] and zoom level
  // Default: continental United States overview
  // -------------------------------------------------------------------------
  DEFAULT_CENTER: [-98.5795, 39.8283],
  DEFAULT_ZOOM: 4,

  // -------------------------------------------------------------------------
  // Minimum zoom level at which property lines become visible.
  // Lower = lines appear earlier but more tile requests are made.
  // 14 is a good balance (roughly city-block level).
  // -------------------------------------------------------------------------
  PARCEL_MIN_ZOOM: 14,

};
