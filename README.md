# US Property Map

A satellite map of the United States with property/parcel boundaries overlaid. Hover over any parcel to highlight it and see property details. Built entirely on free services — no server required.

**Live demo:** https://YOUR-USERNAME.github.io/my-smart-map/

---

## Features

- Satellite imagery via ESRI World Imagery (free, no API key)
- Grey property lines that appear when zoomed in past street level
- Hover highlight (gold fill + white outline) on any property
- Popup showing address, owner name, and property size
- Works nationwide with a Regrid API token; ships with a San Francisco demo dataset that works with no setup

---

## Quick Start (Local)

1. Clone this repo
2. Start a local web server in the project folder:
   ```bash
   python -m http.server 8080
   # or: npx serve .
   ```
3. Open `http://localhost:8080` in your browser
4. Navigate to San Francisco (demo data is pre-loaded for SF District 3)

> **Note:** You must use a local server — browsers block cross-origin requests from `file://` URLs.

---

## Enable Nationwide Parcel Data (Optional)

The app ships in demo mode using a bundled San Francisco parcel dataset. To unlock **nationwide US parcel data**:

1. Sign up for a free account at [regrid.com/api](https://regrid.com/api)
2. Copy `config.example.js` to `config.js` in the project root
3. Fill in your Regrid API token:
   ```js
   REGRID_TOKEN: 'your_token_here',
   ```
4. Reload the page — the badge will switch to "Live Parcels (Regrid)"

`config.js` is listed in `.gitignore` and will never be committed to your repository. Only you will have the token locally.

---

## Deploy to GitHub Pages

1. Create a new repository on GitHub (e.g. `my-smart-map`)
2. Push this code:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR-USERNAME/my-smart-map.git
   git branch -M main
   git push -u origin main
   ```
3. In the repo on GitHub: **Settings → Pages → Source: Deploy from branch → main / (root) → Save**
4. Your map will be live at `https://YOUR-USERNAME.github.io/my-smart-map/` within ~2 minutes

The live GitHub Pages site will always use demo mode (since `config.js` is not committed). Your local machine uses whichever mode you configure.

---

## Project Structure

```
my-smart-map/
├── index.html            # App shell
├── app.js                # Map logic, layers, hover, popup
├── style.css             # Styles
├── config.example.js     # API key template (safe to commit)
├── config.js             # Your actual API keys (git-ignored)
├── .gitignore
├── data/
│   └── demo-parcels.geojson   # SF District 3 parcel data
└── README.md
```

---

## Data Sources

| Data | Source | Cost |
|------|--------|------|
| Satellite imagery | [ESRI World Imagery](https://www.esri.com/en-us/home) | Free |
| Demo parcel boundaries | [SF Open Data](https://data.sfgov.org/resource/acdm-wktn.geojson) (Socrata) | Free |
| Nationwide parcel data | [Regrid](https://regrid.com) | Free tier (limited) |

---

## Planned Enhancements

- Click-to-open full property detail sidebar
- Address search (using free Census Geocoder API)
- Acreage calculation from polygon geometry when not in data
- URL hash so you can share a link to a specific location
- Support for additional county GeoJSON datasets
