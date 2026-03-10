# Leaflet.PopupPortal

[![npm version](https://img.shields.io/npm/v/leaflet.popup-portal.svg)](https://www.npmjs.com/package/leaflet.popup-portal)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Leaflet 1.x](https://img.shields.io/badge/Leaflet-1.x-brightgreen.svg)](https://leafletjs.com)

> Teleports Leaflet popups to a `<body>`-level fixed overlay so they always render **above** zoom controls, attribution, and any other UI element.

**[Live Demo →](https://mwasil.github.io/leaflet.popup-portal/) | [Real-World Example →](https://mapa.wirtualneszlaki.pl/swiat/geografia-polityczna-swiata) | [npm →](https://www.npmjs.com/package/leaflet.popup-portal)**

---

## The Problem

`.leaflet-map-pane` applies `transform: translate3d()` to enable hardware-accelerated panning. The side effect is that it creates a new **CSS stacking context**, capping the effective z-index of all its descendants. Leaflet's controls (`zoomControl`, `attributionControl`, custom panes) live _outside_ this stacking context and always win.

```
body
└─ .leaflet-container
    ├─ .leaflet-map-pane   ← transform: translate3d() → own stacking context
    │   └─ .leaflet-popup-pane
    │       └─ popup (z-index: 700)  ← trapped, loses to controls
    └─ .leaflet-control-container
        └─ zoom control (z-index: 1000)  ← always on top
```

## The Solution

**Leaflet.PopupPortal** moves the popup's DOM node to a `position:fixed` overlay div appended directly to `<body>`, bypassing the stacking context entirely. Position is kept in sync from popup `latlng` on `move`, `moveend`, `zoom`, `zoomend`, `viewreset`, `resize`, and window `scroll`.

All standard Leaflet behaviour — close button, `autoPan`, `popupopen` / `popupclose` events, programmatic `openPopup()` / `closePopup()` — remains intact.

```
body
├─ .leaflet-container        ← map (controls render normally inside)
└─ #leaflet-popup-portal     ← position:fixed; z-index:10000
    └─ popup                 ← renders above everything ✓
```

---

## Demo

**[► Open Live Demo](https://mwasil.github.io/leaflet.popup-portal/)**

**[► See Real-World Usage (Political World Map)](https://mapa.wirtualneszlaki.pl/swiat/geografia-polityczna-swiata)**

**[► npm Package](https://www.npmjs.com/package/leaflet.popup-portal)**

The demo shows two identical maps side by side — left without the plugin, right with it. Open a popup near the zoom control to see the difference immediately.

---

## Installation

**CDN (jsDelivr)**

```html
<!-- after leaflet.js -->
<script src="https://cdn.jsdelivr.net/gh/mwasil/leaflet.popup-portal@1.0.0/leaflet.popup-portal.js"></script>
```

**npm**

```bash
npm install leaflet.popup-portal
```

```js
import L from 'leaflet';
import 'leaflet.popup-portal';   // must come after leaflet
```

**Direct download**

Grab `leaflet.popup-portal.js` and place it after `leaflet.js` in your page.

---

## Usage

No API needed. Include the file once and every popup on every map gains portal behaviour automatically:

```html
<link  rel="stylesheet" href="leaflet.css" />
<script src="leaflet.js"></script>
<script src="leaflet.popup-portal.js"></script>  <!-- that's it -->

<script>
  var map = L.map('map').setView([51.5, -0.09], 13);
  L.marker([51.5, -0.09])
    .bindPopup('I now render above all controls!')
    .addTo(map);
</script>
```

### Disable per map

Pass `popupPortal: false` in the map options to opt a specific map instance out:

```js
var map = L.map('map', { popupPortal: false });
```

---

## How It Works

| Step | What happens |
|------|-------------|
| **`popupopen`** | The popup container is moved to `#leaflet-popup-portal`, switched to `position:fixed`, and positioned immediately using `map.latLngToContainerPoint(latlng) + popup._getAnchor()` plus map container viewport offsets. |
| **Teleport** | The container element is moved to `#leaflet-popup-portal` — a `position:fixed; z-index:10000` div appended to `<body>`. |
| **Sync** | `_updatePosition` / `_animateZoom` are patched to recompute `left` / `top` while in portal mode. During zoom animation the plugin uses `map._latLngToNewLayerPoint(...)` to match Leaflet's animated frame math. |
| **`popupclose`** | Popup fades out in portal space first, then after `PORTAL_FADE_DURATION` the node is returned to `.leaflet-popup-pane` and inline portal styles are reset. A close timer is canceled on reopen to avoid race conditions. |

---

## Compatibility

| Leaflet | Browsers |
|---------|----------|
| 1.0 – 1.9 | Chrome, Firefox, Safari, Edge (all modern) |

> Uses Leaflet events plus a small set of internal methods/properties (`_updatePosition`, `_animateZoom`, `_latLngToNewLayerPoint`, `_getMapPanePos`, popup internals) to keep portal positioning exact during animations.

---

## Contributing

Bug reports and pull requests welcome at [GitHub Issues](https://github.com/mwasil/leaflet.popup-portal/issues).

---

## License

[MIT](LICENSE) © mwasil
