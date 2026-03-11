/**
 * Leaflet.PopupPortal
 *
 * Problem: .leaflet-map-pane uses transform: translate3d() which creates a new
 * CSS stacking context. Any popup inside that pane cannot escape its z-index
 * ceiling (~400), so Leaflet controls (outside the pane) always render on top.
 *
 * Solution: When a popup opens, teleport its container element to a fixed
 * overlay attached to <body> (or active fullscreen root). Position is
 * recalculated from the
 * popup's latlng on every event that could move or resize the popup anchor
 * (map move, zoom, scroll, resize, viewreset). The close button is rewired
 * directly so it works outside the original popup pane. All Leaflet events
 * and programmatic open/close continue to work normally.
 *
 * Usage: include this file after leaflet.js. No configuration needed.
 * Map option: { popupPortal: false } to opt a specific map instance out.
 */
(function (L) {
    'use strict';

    if (typeof L === 'undefined' || !L.Popup) {
        return;
    }

    var PORTAL_CLOSE_THRESHOLD = 100;
    var PORTAL_FADE_DURATION = 200;
    var PORTAL_CLASS_WHITELIST = {
        'leaflet-touch': true,
        'leaflet-retina': true,
        'leaflet-oldie': true,
        'leaflet-safari': true,
        'leaflet-fade-anim': true,
        'leaflet-zoom-anim': true
    };

    /* ─── Portal overlay ─────────────────────────────────────────── */

    var _portal = null;

    function getDocumentFullscreenElement() {
        return document.fullscreenElement ||
            document.mozFullScreenElement ||
            document.webkitFullscreenElement ||
            document.msFullscreenElement ||
            null;
    }

    function getPortalHostForMap(map) {
        var fullscreenElement = getDocumentFullscreenElement();
        var mapContainer = map && map._container;

        if (fullscreenElement && mapContainer && fullscreenElement.contains(mapContainer)) {
            return fullscreenElement;
        }

        return document.body;
    }

    function ensurePortalHost(map) {
        var portal = getPortal();
        var host = getPortalHostForMap(map);

        if (portal.parentNode !== host) {
            host.appendChild(portal);
        }

        return portal;
    }

    function getPortal() {
        if (!_portal) {
            _portal = document.createElement('div');
            _portal.id = 'leaflet-popup-portal';
            _portal.className = 'leaflet-popup-portal leaflet-container';
            _portal.style.cssText = [
                'position:fixed',
                'top:0',
                'left:0',
                'width:0',
                'height:0',
                'z-index:10000',
                'pointer-events:none',
                'overflow:visible',
                'background:transparent'
            ].join(';');
            document.body.appendChild(_portal);
        }
        return _portal;
    }

    function syncPortalLeafletClasses(map) {
        var portal = ensurePortalHost(map);
        var container = map && map._container;
        var classes = ['leaflet-popup-portal', 'leaflet-container'];

        if (!container || !container.classList) {
            portal.className = classes.join(' ');
            return portal;
        }

        Array.prototype.forEach.call(container.classList, function (className) {
            if (PORTAL_CLASS_WHITELIST[className]) {
                classes.push(className);
            }
        });

        portal.className = classes.join(' ');
        return portal;
    }

    /* ─── Override _updatePosition ───────────────────────────────── */
    // Leaflet calls _updatePosition on every map move/zoom.
    // When the popup is in the portal we redirect to our own sync logic.

    var _origUpdatePosition = L.Popup.prototype._updatePosition;
    var _origAnimateZoom = L.Popup.prototype._animateZoom;

    L.Popup.prototype._updatePosition = function () {
        if (this._inPortal) {
            this._syncPortalPosition();
            return;
        }
        _origUpdatePosition.call(this);
    };

    L.Popup.prototype._animateZoom = function (e) {
        if (this._inPortal) {
            this._syncPortalPosition(e);
            return;
        }
        _origAnimateZoom.call(this, e);
    };

    L.Popup.prototype._setPortalVisibility = function (isVisible) {
        var container = this._container;

        if (!container || this._portalVisible === isVisible) {
            return;
        }

        this._portalVisible = isVisible;
        container.style.opacity = isVisible ? '1' : '0';
        container.style.pointerEvents = isVisible ? 'auto' : 'none';
    };

    /* ─── Position sync ──────────────────────────────────────────── */

    /**
     * Recalculates and applies position:fixed top/left for the portal popup.
     *
     * Strategy: replicate Leaflet's own _updatePosition math but in fixed
     * viewport coordinates instead of pane-relative coordinates.
     *
     * Leaflet places the popup so that the tip of the arrow sits exactly at
     * the anchor point of the source layer (marker). It computes:
     *   pos  = map.latLngToLayerPoint(latlng)          — in layer (pane) pixels
     *   pos += anchor                                   — layer's icon anchor
     *   pos += popup._getAnchor()                       — popup tip offset
     *   then positions the container bottom at pos.y, left-centre at pos.x
     *
     * We translate the same pos to fixed-viewport coords via mapRect, skipping
     * the pane transform entirely. Container size is read fresh on every call
     * so zoom-induced size changes are handled automatically.
     */
    L.Popup.prototype._syncPortalPosition = function (zoomEvent) {
        var container = this._container;
        var map       = this._map;
        if (!container || !map || !this._latlng) { return; }

        // Guard against infinite recursion: _update() calls _updatePosition()
        // which calls _syncPortalPosition() again. With the guard active the
        // nested call returns immediately; _update() still performs its content
        // and layout passes so container dimensions are correct when we read
        // them below.
        if (!zoomEvent) {
            if (this._syncingPortalPos) { return; }
            this._syncingPortalPos = true;

            try {
                // Re-run Leaflet's own layout pass so _containerWidth/Height and the
                // popup tip anchor are up to date (important after zoom).
                if (this._update) { this._update(); }
            } finally {
                this._syncingPortalPos = false;
            }
        }

        var mapRect = map._container.getBoundingClientRect();

        // During zoom animation Leaflet positions layers against the incoming
        // animated center/zoom, not the current settled view.
        var pos = zoomEvent
            ? map._latLngToNewLayerPoint(this._latlng, zoomEvent.zoom, zoomEvent.center)
                .add(map._getMapPanePos())
            : map.latLngToContainerPoint(this._latlng);

        // _getAnchor() already incorporates _source._getPopupAnchor() plus any
        // options.offset. Do NOT add the source anchor separately — that would
        // double-count it (causing ~30 px vertical offset).
        var anchor = this._getAnchor ? this._getAnchor() : L.point(0, 0);
        pos = pos.add(anchor);

        // Container dimensions (updated by _update() above).
        var cw = container.offsetWidth;
        var ch = container.offsetHeight;

        // Centre horizontally and align container bottom to the anchor point.
        var fixedLeft = mapRect.left + pos.x - Math.round(cw / 2);
        var fixedTop  = mapRect.top  + pos.y - ch;

        container.style.left = fixedLeft + 'px';
        container.style.top  = fixedTop  + 'px';
        container.style.transform = 'none';

        this._setPortalVisibility(!(
            fixedLeft < mapRect.left - PORTAL_CLOSE_THRESHOLD ||
            fixedLeft + cw > mapRect.right + PORTAL_CLOSE_THRESHOLD ||
            fixedTop < mapRect.top - PORTAL_CLOSE_THRESHOLD ||
            fixedTop + ch > mapRect.bottom + PORTAL_CLOSE_THRESHOLD
        ));
    };

    /* ─── Map hook ───────────────────────────────────────────────── */

    L.Map.addInitHook(function () {
        var map = this;

        /* ── popup open: teleport to portal ── */
        map.on('popupopen', function (e) {
            var popup     = e.popup;
            var container = popup._container;
            if (!container || popup._inPortal) { return; }
            if (map.options.popupPortal === false) { return; }

            if (popup._portalCloseTimer) {
                clearTimeout(popup._portalCloseTimer);
                popup._portalCloseTimer = null;
            }

            // Move element out of the leaflet-map-pane stacking context.
            syncPortalLeafletClasses(map).appendChild(container);
            popup._inPortal = true;

            // Switch from Leaflet's pane-relative bottom/left scheme to
            // position:fixed top/left so we can place it in viewport space.
            container.style.position      = 'fixed';
            container.style.transform     = 'none';
            container.style.bottom        = 'auto';
            container.style.marginBottom  = '0';
            container.style.pointerEvents = 'auto';
            container.style.opacity       = '1';
            container.style.transition    = 'opacity ' + PORTAL_FADE_DURATION + 'ms ease';
            container.style.willChange    = 'left, top';
            popup._portalVisible = true;

            // Calculate and apply the correct fixed position immediately.
            popup._syncPortalPosition();

            // ── Close button ──────────────────────────────────────────────
            // Leaflet attaches the click handler for the close button on the
            // popup pane element via event delegation. Once we move the
            // container out of that pane the delegation no longer fires.
            // Rewire the button directly on the container itself.
            var closeBtn = container.querySelector('.leaflet-popup-close-button');
            if (closeBtn && !closeBtn._portalWired) {
                closeBtn._portalWired = true;
                L.DomEvent.on(closeBtn, 'click', function (ev) {
                    L.DomEvent.preventDefault(ev);
                    popup._close();
                });
            }
        });

        /* ── popup close: fade in portal, cleanup after fade ── */
        map.on('popupclose', function (e) {
            var popup     = e.popup;
            var container = popup._container;
            if (!popup._inPortal || !container) { return; }

            // Keep current fixed coordinates for the whole fade-out so there is
            // no visible jump between viewport-fixed and pane-relative spaces.
            container.style.transition    = 'opacity ' + PORTAL_FADE_DURATION + 'ms ease';
            container.style.pointerEvents = 'none';
            container.style.opacity       = '0';

            popup._inPortal = false;
            popup._portalVisible = false;

            if (popup._portalCloseTimer) {
                clearTimeout(popup._portalCloseTimer);
            }

            popup._portalCloseTimer = setTimeout(function () {
                popup._portalCloseTimer = null;

                // If popup was reopened during the timeout, do not reset styles.
                if (popup._inPortal) { return; }

                var pane = map.getPane('popupPane');
                if (pane && container.parentNode) {
                    pane.appendChild(container);
                }

                // Restore Leaflet's default inline styles so the next open is clean.
                container.style.position      = '';
                container.style.left          = '';
                container.style.top           = '';
                container.style.transform     = '';
                container.style.bottom        = '';
                container.style.marginBottom  = '';
                container.style.pointerEvents = '';
                container.style.opacity       = '';
                container.style.transition    = '';
                container.style.willChange    = '';
                popup._portalVisible = true;
            }, PORTAL_FADE_DURATION);
        });

        /* ── keep portal popup in sync on anything that moves the anchor ── */
        //
        // Events covered:
        //   move / moveend  — map pan
        //   zoom / zoomend  — zoom level change (also changes popup size)
        //   viewreset       — full redraw (e.g. CRS change)
        //   resize          — browser window / map container resize
        //   scroll          — page scroll (changes mapRect from getBoundingClientRect)
        //
        map.on('move zoom moveend zoomend viewreset resize', function () {
            var popup = map._popup;
            if (popup && popup._inPortal) {
                ensurePortalHost(map);
                popup._syncPortalPosition();
            }
        });

        // In native fullscreen only descendants of the fullscreen root are visible.
        // Rehost portal there (and back to body on exit) to keep popups visible.
        map.on('fullscreenchange', function () {
            ensurePortalHost(map);

            var popup = map._popup;
            if (popup && popup._inPortal) {
                popup._syncPortalPosition();
            }
        });

        // Window scroll shifts mapRect in the viewport — sync on that too.
        function onWindowScroll() {
            var popup = map._popup;
            if (popup && popup._inPortal) {
                ensurePortalHost(map);
                popup._syncPortalPosition();
            }
        }
        window.addEventListener('scroll', onWindowScroll, { passive: true, capture: true });

        // Clean up the scroll listener when the map is removed.
        map.on('unload', function () {
            var popup = map._popup;
            if (popup && popup._portalCloseTimer) {
                clearTimeout(popup._portalCloseTimer);
                popup._portalCloseTimer = null;
            }
            window.removeEventListener('scroll', onWindowScroll, { capture: true });
        });
    });

}(typeof L !== 'undefined' ? L : null));
