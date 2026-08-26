(function () {
    const LOGO_URL = "/assets/brand/aziel-icon.svg";
    const HISTORY_LIMIT = 100;
    const MIN_LAYER_SIZE = 8;
    const SUPPORTED_TOOLS = ["select", "hand", "zoom", "text", "image", "logo", "shape", "crop"];
    const FILTER_PRESETS = {
        original: { label: "Original", adjustments: defaultAdjustments() },
        auto: { label: "Auto Enhance", adjustments: { brightness: 8, contrast: 10, saturation: 10, temperature: 2, tint: 0, grayscale: 0, sepia: 0, blur: 0 } },
        vivid: { label: "Vivid", adjustments: { brightness: 6, contrast: 16, saturation: 28, temperature: 0, tint: 0, grayscale: 0, sepia: 0, blur: 0 } },
        cinematic: { label: "Cinematic", adjustments: { brightness: -4, contrast: 24, saturation: 8, temperature: -8, tint: 6, grayscale: 0, sepia: 0, blur: 0 } },
        warm: { label: "Warm", adjustments: { brightness: 4, contrast: 8, saturation: 10, temperature: 24, tint: 0, grayscale: 0, sepia: 0, blur: 0 } },
        cool: { label: "Cool", adjustments: { brightness: 2, contrast: 10, saturation: 8, temperature: -24, tint: 0, grayscale: 0, sepia: 0, blur: 0 } },
        highContrast: { label: "High Contrast", adjustments: { brightness: 0, contrast: 36, saturation: 8, temperature: 0, tint: 0, grayscale: 0, sepia: 0, blur: 0 } },
        soft: { label: "Soft", adjustments: { brightness: 8, contrast: -12, saturation: -4, temperature: 4, tint: 0, grayscale: 0, sepia: 0, blur: 0 } },
        matte: { label: "Matte", adjustments: { brightness: 6, contrast: -18, saturation: -10, temperature: 2, tint: 0, grayscale: 0, sepia: 0, blur: 0 } },
        mono: { label: "Mono", adjustments: { brightness: 0, contrast: 14, saturation: -100, temperature: 0, tint: 0, grayscale: 100, sepia: 0, blur: 0 } },
        sepia: { label: "Sepia", adjustments: { brightness: 4, contrast: 10, saturation: -10, temperature: 18, tint: 0, grayscale: 0, sepia: 70, blur: 0 } },
        darkGame: { label: "Dark Game", adjustments: { brightness: -16, contrast: 30, saturation: 16, temperature: -6, tint: 0, grayscale: 0, sepia: 0, blur: 0 } },
        purpleAtmosphere: { label: "Purple Atmosphere", adjustments: { brightness: 0, contrast: 18, saturation: 22, temperature: -16, tint: 12, grayscale: 0, sepia: 0, blur: 0 } }
    };

    function createId(prefix = "layer") {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function createImageFromBlob(blob) {
        const url = URL.createObjectURL(blob);
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve({ image, url });
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("Image decode failed."));
            };
            image.src = url;
        });
    }

    function loadImageUrl(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("Image decode failed."));
            image.src = src;
        });
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, Number(value) || 0));
    }

    function fitScale(preset, image, mode = "cover") {
        if (!image?.naturalWidth || !image?.naturalHeight) return 1;
        const scaleX = preset.canvasWidth / image.naturalWidth;
        const scaleY = preset.canvasHeight / image.naturalHeight;
        return mode === "fit" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
    }

    function defaultAdjustments() {
        return {
            exposure: 0,
            brightness: 0,
            contrast: 0,
            saturation: 0,
            temperature: 0,
            tint: 0,
            grayscale: 0,
            sepia: 0,
            blur: 0
        };
    }

    function interpolateAdjustments(target = defaultAdjustments(), intensity = 100) {
        const amount = clamp(intensity, 0, 100) / 100;
        const base = defaultAdjustments();
        return Object.fromEntries(Object.keys(base).map(key => [
            key,
            Math.round((base[key] || 0) + ((target[key] || 0) - (base[key] || 0)) * amount)
        ]));
    }

    function defaultEffects() {
        return {
            shadow: false,
            glow: false,
            stroke: "",
            strokeWidth: 0
        };
    }

    function defaultCanvas(preset) {
        return {
            width: preset?.width || preset?.canvasWidth || 1200,
            height: preset?.height || preset?.canvasHeight || 630,
            backgroundColor: "transparent",
            transparent: true,
            safeArea: Number(preset?.safeArea || 0.7),
            showSafeAreas: true,
            showGrid: false,
            snap: true,
            rulers: true
        };
    }

    function normalizeLayer(layer = {}, index = 0) {
        const allowedTypes = new Set(["image", "text", "logo", "shape", "group"]);
        const type = allowedTypes.has(layer.type) ? layer.type : "image";
        const now = new Date().toISOString();
        const base = {
            id: layer.id || createId(type),
            type,
            name: layer.name || `${type[0].toUpperCase()}${type.slice(1)} ${index + 1}`,
            visible: layer.visible !== false,
            locked: Boolean(layer.locked),
            opacity: layer.opacity == null ? 1 : clamp(layer.opacity, 0, 1),
            blendMode: layer.blendMode || "source-over",
            x: Number(layer.x || 0),
            y: Number(layer.y || 0),
            width: Math.max(MIN_LAYER_SIZE, Number(layer.width || 160)),
            height: Math.max(MIN_LAYER_SIZE, Number(layer.height || 90)),
            scaleX: layer.scaleX == null ? 1 : Number(layer.scaleX || 1),
            scaleY: layer.scaleY == null ? 1 : Number(layer.scaleY || 1),
            rotation: Number(layer.rotation || 0),
            flipX: Boolean(layer.flipX),
            flipY: Boolean(layer.flipY),
            zIndex: Number(layer.zIndex ?? index),
            createdAt: layer.createdAt || now,
            updatedAt: layer.updatedAt || now,
            adjustments: { ...defaultAdjustments(), ...(layer.adjustments || {}) },
            effects: { ...defaultEffects(), ...(layer.effects || {}) }
        };

        if (type === "image") {
            return {
                ...base,
                assetId: layer.assetId || "",
                sourceUrl: layer.sourceUrl || "",
                sourceName: layer.sourceName || layer.name || "Imported image",
                naturalWidth: layer.naturalWidth || layer.width || base.width,
                naturalHeight: layer.naturalHeight || layer.height || base.height,
                crop: layer.crop || null,
                filterPreset: layer.filterPreset || "original",
                filterIntensity: layer.filterIntensity == null ? 100 : clamp(layer.filterIntensity, 0, 100)
            };
        }

        if (type === "group") {
            return {
                ...base,
                name: layer.name || "Group",
                childIds: Array.isArray(layer.childIds) ? [...new Set(layer.childIds)] : [],
                collapsed: Boolean(layer.collapsed)
            };
        }

        if (type === "text") {
            return {
                ...base,
                text: layer.text || "Text",
                fontFamily: layer.fontFamily || "Inter, system-ui, sans-serif",
                fontSize: Number(layer.fontSize || 64),
                fontWeight: layer.fontWeight || "800",
                italic: Boolean(layer.italic),
                align: layer.align || "left",
                color: layer.color || "#ffffff",
                lineHeight: Number(layer.lineHeight || 1.12),
                letterSpacing: Number(layer.letterSpacing || 0),
                stroke: layer.stroke || "",
                strokeWidth: Number(layer.strokeWidth || 0)
            };
        }

        if (type === "logo") {
            return {
                ...base,
                name: layer.name || "AZIEL Wordmark",
                text: "AZIEL",
                fontFamily: layer.fontFamily || "Inter, system-ui, sans-serif",
                fontSize: Number(layer.fontSize || 56),
                fontWeight: layer.fontWeight || "900",
                color: layer.color || "#ffffff",
                variant: layer.variant || "white",
                autoContrast: Boolean(layer.autoContrast)
            };
        }

        return {
            ...base,
            shape: layer.shape || "rectangle",
            fill: layer.fill || "rgba(139, 92, 246, .38)",
            stroke: layer.stroke || "rgba(255, 255, 255, .45)",
            strokeWidth: Number(layer.strokeWidth || 0),
            radius: Number(layer.radius || 16)
        };
    }

    class DesignStudioCanvas {
        constructor(options = {}) {
            this.canvas = options.canvas;
            this.frame = options.frame;
            this.empty = options.empty;
            this.onStateChange = options.onStateChange || function () {};
            this.ctx = this.canvas.getContext("2d");
            this.imageCache = new Map();
            this.objectUrls = new Set();
            this.sourceImage = null;
            this.sourceObjectUrl = "";
            this.drag = null;
            this.editingTextLayerId = "";
            this.textEditor = null;
            this.spacePanning = false;
            this.history = [];
            this.future = [];
            this.state = this.createDefaultState(options.preset);
            this.currentTool = this.state.activeTool;
            this.previousTool = this.currentTool;
            this.boundHandlers = [];
        }

        createDefaultState(preset) {
            const canvas = defaultCanvas(preset);
            return {
                version: 2,
                schemaVersion: 2,
                presetId: preset?.id || "open-graph",
                canvasWidth: canvas.width,
                canvasHeight: canvas.height,
                canvas,
                fitMode: "cover",
                showSafeAreas: true,
                showGrid: false,
                activeTool: "select",
                selectedLayerIds: [],
                marquee: null,
                viewport: {
                    zoom: 1,
                    panX: 0,
                    panY: 0
                },
                source: {
                    assetId: "",
                    name: "",
                    x: 0,
                    y: 0,
                    scale: 1,
                    flipped: false
                },
                logo: {
                    enabled: false,
                    x: 40,
                    y: 40,
                    scale: 1,
                    opacity: 0.8,
                    position: "top-left",
                    color: "#ffffff",
                    src: LOGO_URL
                },
                layers: []
            };
        }

        async init() {
            this.resizeCanvas();
            this.bindCanvasEvents();
            this.pushHistory("New project");
            this.render();
        }

        dispose() {
            this.boundHandlers.forEach(([target, event, handler]) => target.removeEventListener(event, handler));
            this.boundHandlers = [];
            this.revokeSourceUrl();
            this.objectUrls.forEach(url => URL.revokeObjectURL(url));
            this.objectUrls.clear();
        }

        on(target, event, handler, options) {
            target.addEventListener(event, handler, options);
            this.boundHandlers.push([target, event, handler]);
        }

        bindCanvasEvents() {
            const pointerDown = event => {
                const point = this.eventToCanvasPoint(event);
                if (event.button === 1 || this.state.activeTool === "hand" || this.spacePanning) {
                    event.preventDefault();
                    this.drag = {
                        type: "pan",
                        startX: event.clientX,
                        startY: event.clientY,
                        panX: this.state.viewport.panX,
                        panY: this.state.viewport.panY
                    };
                    this.canvas.setPointerCapture?.(event.pointerId);
                    this.updateCursor();
                    return;
                }

                if (this.state.activeTool === "zoom") {
                    event.preventDefault();
                    this.zoomAt(point, event.altKey ? 0.8 : 1.25);
                    this.pushHistory(event.altKey ? "Zoom out" : "Zoom in");
                    return;
                }

                if (event.detail >= 2) {
                    const hit = this.hitTest(point, { includeLocked: true });
                    const layer = hit ? this.getLayer(hit.layerId) : null;
                    if (layer?.type === "text") {
                        event.preventDefault();
                        this.beginInlineTextEdit(layer.id);
                        return;
                    }
                }

                if (this.state.activeTool === "text") {
                    event.preventDefault();
                    const layer = this.addTextLayer({ x: point.x, y: point.y });
                    this.beginInlineTextEdit(layer.id);
                    this.onStateChange(this.state);
                    return;
                }

                if (this.state.activeTool === "crop") {
                    const layer = this.getSelectedLayer();
                    if (!layer || layer.type !== "image" || this.isEffectivelyLocked(layer)) return;
                    event.preventDefault();
                    const crop = this.ensureCrop(layer);
                    this.drag = {
                        type: "crop",
                        handle: this.hitHandle(crop, point) || "move",
                        startX: point.x,
                        startY: point.y,
                        beforeCrop: clone(crop),
                        layerId: layer.id
                    };
                    this.canvas.setPointerCapture?.(event.pointerId);
                    this.updateCursor();
                    return;
                }

                if (this.state.activeTool === "logo") {
                    event.preventDefault();
                    this.addLogoLayer({ x: point.x, y: point.y });
                    this.state.activeTool = "select";
                    this.currentTool = "select";
                    this.updateCursor();
                    this.onStateChange(this.state);
                    return;
                }

                if (this.state.activeTool === "shape") {
                    event.preventDefault();
                    this.addShapeLayer("rounded-rectangle", { x: point.x, y: point.y });
                    this.state.activeTool = "select";
                    this.currentTool = "select";
                    this.updateCursor();
                    this.onStateChange(this.state);
                    return;
                }

                const hit = this.hitTest(point);
                if (!hit) {
                    event.preventDefault();
                    this.drag = {
                        type: "marquee",
                        additive: event.shiftKey || event.metaKey || event.ctrlKey,
                        subtractive: event.altKey,
                        startX: point.x,
                        startY: point.y,
                        currentX: point.x,
                        currentY: point.y,
                        beforeSelectedLayerIds: [...this.state.selectedLayerIds]
                    };
                    this.state.marquee = this.marqueeRect(this.drag);
                    this.render();
                    return;
                }

                const layer = this.getLayer(hit.layerId);
                if (!layer || this.isEffectivelyLocked(layer) || !this.isEffectivelyVisible(layer)) return;
                event.preventDefault();
                if (event.shiftKey || event.metaKey || event.ctrlKey) {
                    this.toggleLayerSelection(layer.id);
                } else if (!this.state.selectedLayerIds.includes(layer.id)) {
                    this.selectLayer(layer.id);
                }
                const bounds = this.getSelectionBounds();
                if (!bounds) return;
                this.drag = {
                    type: hit.handle ? "resize" : "move",
                    handle: hit.handle,
                    startX: point.x,
                    startY: point.y,
                    beforeBounds: clone(bounds),
                    beforeLayers: this.getTransformLayerIds().map(id => clone(this.getLayer(id))).filter(Boolean)
                };
                this.canvas.setPointerCapture?.(event.pointerId);
                this.updateCursor();
                this.onStateChange(this.state, { transient: true });
            };

            const pointerMove = event => {
                if (!this.drag) {
                    this.updateCursor(this.eventToCanvasPoint(event));
                    return;
                }
                event.preventDefault();
                if (this.drag.type === "pan") {
                    const zoom = Number(this.state.viewport.zoom || 1);
                    this.state.viewport.panX = this.drag.panX + ((event.clientX - this.drag.startX) / zoom);
                    this.state.viewport.panY = this.drag.panY + ((event.clientY - this.drag.startY) / zoom);
                    this.render();
                    this.onStateChange(this.state, { transient: true });
                    return;
                }

                const point = this.eventToCanvasPoint(event);
                const dx = point.x - this.drag.startX;
                const dy = point.y - this.drag.startY;

                if (this.drag.type === "marquee") {
                    this.drag.currentX = point.x;
                    this.drag.currentY = point.y;
                    this.state.marquee = this.marqueeRect(this.drag);
                    this.applyMarqueeSelection(this.drag);
                    this.render();
                    this.onStateChange(this.state, { transient: true });
                    return;
                }

                if (this.drag.type === "crop") {
                    this.updateCropDrag(this.drag, dx, dy, event.shiftKey);
                    this.render();
                    this.onStateChange(this.state, { transient: true });
                    return;
                }

                if (this.drag.type === "resize" && this.drag.handle === "rotate") this.rotateSelection(this.drag.beforeBounds, this.drag.beforeLayers, point);
                else if (this.drag.type === "resize") this.resizeSelection(this.drag.beforeBounds, this.drag.beforeLayers, this.drag.handle, dx, dy, event.shiftKey);
                else this.moveSelection(this.drag.beforeLayers, dx, dy);
                this.syncCompatFromSelection();
                this.render();
                this.onStateChange(this.state, { transient: true });
            };

            const pointerUp = () => {
                if (!this.drag) return;
                const label = this.drag.type === "resize"
                    ? "Resize selection"
                    : this.drag.type === "crop"
                        ? "Crop image"
                    : this.drag.type === "marquee"
                        ? "Select layers"
                        : this.drag.type === "pan" ? "Pan viewport" : "Move selection";
                this.state.marquee = null;
                this.drag = null;
                if (!["Select layers", "Pan viewport"].includes(label)) this.pushHistory(label);
                this.updateCursor();
                this.onStateChange(this.state);
            };

            const wheel = event => {
                if (!event.ctrlKey && !event.metaKey && this.state.activeTool !== "zoom") return;
                event.preventDefault();
                const point = this.eventToCanvasPoint(event);
                this.zoomAt(point, event.deltaY < 0 ? 1.1 : 0.9);
                this.onStateChange(this.state, { transient: true });
            };

            const keyDown = event => {
                if (event.code !== "Space" || this.spacePanning || this.isTextEntryTarget(event.target)) return;
                event.preventDefault();
                this.previousTool = this.currentTool || this.state.activeTool || "select";
                this.spacePanning = true;
                this.state.activeTool = "hand";
                this.currentTool = "hand";
                this.updateCursor();
                this.onStateChange(this.state, { transient: true });
            };

            const keyUp = event => {
                if (event.code !== "Space" || !this.spacePanning) return;
                event.preventDefault();
                this.spacePanning = false;
                this.state.activeTool = this.previousTool || "select";
                this.currentTool = this.state.activeTool;
                this.updateCursor();
                this.onStateChange(this.state, { transient: true });
            };

            this.on(this.canvas, "pointerdown", pointerDown);
            this.on(window, "pointermove", pointerMove);
            this.on(window, "pointerup", pointerUp);
            this.on(this.canvas, "wheel", wheel, { passive: false });
            this.on(window, "keydown", keyDown);
            this.on(window, "keyup", keyUp);
        }

        isTextEntryTarget(target) {
            return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
        }

        eventToCanvasPoint(event) {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: ((event.clientX - rect.left) / rect.width) * this.state.canvasWidth,
                y: ((event.clientY - rect.top) / rect.height) * this.state.canvasHeight
            };
        }

        migrateState(editorState = {}) {
            if (Array.isArray(editorState.layers)) {
                const state = {
                    ...this.createDefaultState(editorState),
                    ...editorState,
                    canvas: { ...defaultCanvas(editorState), ...(editorState.canvas || {}) },
                    viewport: { ...this.createDefaultState(editorState).viewport, ...(editorState.viewport || {}) },
                    source: { ...this.createDefaultState(editorState).source, ...(editorState.source || {}) },
                    logo: { ...this.createDefaultState(editorState).logo, ...(editorState.logo || {}) },
                    layers: editorState.layers
                        .map(layer => normalizeLayer(layer))
                        .sort((a, b) => a.zIndex - b.zIndex),
                    selectedLayerIds: (editorState.selectedLayerIds || []).filter(id => editorState.layers.some(layer => layer.id === id))
                };
                state.selectedLayerIds = state.selectedLayerIds.filter(id => state.layers.some(layer => layer.id === id));
                state.activeTool = SUPPORTED_TOOLS.includes(state.activeTool) ? state.activeTool : "select";
                state.viewport = { zoom: 1, panX: 0, panY: 0, ...(state.viewport || {}) };
                state.canvasWidth = state.canvas.width || state.canvasWidth;
                state.canvasHeight = state.canvas.height || state.canvasHeight;
                return state;
            }

            const state = this.createDefaultState(editorState);
            state.presetId = editorState.presetId || state.presetId;
            state.canvasWidth = editorState.canvasWidth || state.canvasWidth;
            state.canvasHeight = editorState.canvasHeight || state.canvasHeight;
            state.canvas.width = state.canvasWidth;
            state.canvas.height = state.canvasHeight;
            state.source = { ...state.source, ...(editorState.source || {}) };
            state.logo = { ...state.logo, ...(editorState.logo || {}) };
            if (state.source.name) {
                const scale = Number(state.source.scale || 1);
                state.layers.push(normalizeLayer({
                    id: "legacy-source-image",
                    type: "image",
                    name: state.source.name,
                    assetId: state.source.assetId || "",
                    x: state.source.x || 0,
                    y: state.source.y || 0,
                    width: Math.round((editorState.source?.naturalWidth || state.canvasWidth) * scale),
                    height: Math.round((editorState.source?.naturalHeight || state.canvasHeight) * scale),
                    flipX: Boolean(state.source.flipped),
                    zIndex: 0
                }));
            }
            if (state.logo.enabled) {
                state.layers.push(normalizeLayer({
                    id: "legacy-aziel-logo",
                    type: "logo",
                    name: "AZIEL Wordmark",
                    x: state.logo.x || 40,
                    y: state.logo.y || 40,
                    width: 180,
                    height: 54,
                    opacity: state.logo.opacity || 0.9,
                    color: state.logo.color || "#ffffff",
                    zIndex: state.layers.length
                }));
            }
            state.selectedLayerIds = state.layers.length ? [state.layers[state.layers.length - 1].id] : [];
            return state;
        }

        resizeCanvas() {
            const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
            this.canvas.width = this.state.canvasWidth * pixelRatio;
            this.canvas.height = this.state.canvasHeight * pixelRatio;
            this.canvas.style.aspectRatio = `${this.state.canvasWidth} / ${this.state.canvasHeight}`;
            this.applyViewport();
            this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        }

        setPreset(preset) {
            this.state.presetId = preset.id;
            this.state.canvasWidth = preset.width;
            this.state.canvasHeight = preset.height;
            this.state.canvas = { ...this.state.canvas, ...defaultCanvas(preset), width: preset.width, height: preset.height };
            this.resizeCanvas();
            this.fitAllImageLayers();
            this.pushHistory("Change preset");
            this.render();
        }

        async setSourceBlob(blob, metadata = {}) {
            const loaded = await createImageFromBlob(blob);
            this.objectUrls.add(loaded.url);
            const layer = this.createImageLayer(loaded.image, {
                ...metadata,
                sourceUrl: loaded.url,
                sourceName: metadata.name || metadata.originalName || blob.name || "Imported image"
            });
            this.imageCache.set(layer.id, loaded.image);
            this.sourceImage = loaded.image;
            this.sourceObjectUrl = loaded.url;
            this.addLayer(layer, "Import image");
            return loaded.image;
        }

        async setSourceUrl(src, metadata = {}) {
            const image = await loadImageUrl(src);
            const layer = this.createImageLayer(image, {
                ...metadata,
                sourceUrl: src,
                sourceName: metadata.name || "Media Library image"
            });
            this.imageCache.set(layer.id, image);
            this.sourceImage = image;
            this.sourceObjectUrl = "";
            this.addLayer(layer, "Import media image");
            return image;
        }

        createImageLayer(image, metadata = {}) {
            const scale = fitScale(this.state, image, this.state.fitMode);
            const width = Math.round(image.naturalWidth * scale);
            const height = Math.round(image.naturalHeight * scale);
            return normalizeLayer({
                type: "image",
                name: metadata.name || metadata.sourceName || "Imported image",
                assetId: metadata.assetId || "",
                sourceUrl: metadata.sourceUrl || "",
                sourceName: metadata.sourceName || metadata.name || "Imported image",
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                x: Math.round((this.state.canvasWidth - width) / 2),
                y: Math.round((this.state.canvasHeight - height) / 2),
                width,
                height,
                zIndex: this.state.layers.length
            });
        }

        clearSourceImage() {
            this.revokeSourceUrl();
            this.sourceImage = null;
            this.state.source.assetId = "";
            this.state.source.name = "";
            this.syncCanvasEmptyState();
        }

        revokeSourceUrl() {
            if (this.sourceObjectUrl && !this.objectUrls.has(this.sourceObjectUrl)) URL.revokeObjectURL(this.sourceObjectUrl);
            this.sourceObjectUrl = "";
        }

        addLayer(layer, historyLabel = "Add layer") {
            const normalized = normalizeLayer(layer, this.state.layers.length);
            normalized.zIndex = this.state.layers.length;
            this.state.layers.push(normalized);
            this.selectLayer(normalized.id);
            this.syncCompatFromSelection();
            this.pushHistory(historyLabel);
            this.render();
            return normalized;
        }

        addTextLayer(options = {}) {
            const layer = this.addLayer({
                type: "text",
                name: "Text — Title",
                text: "NEW TITLE",
                x: Math.round(options.x || this.state.canvasWidth * 0.12),
                y: Math.round(options.y || this.state.canvasHeight * 0.24),
                width: 460,
                height: 90,
                fontSize: 64,
                color: "#ffffff",
                zIndex: this.state.layers.length
            }, "Add text");
            this.state.activeTool = "select";
            this.currentTool = "select";
            this.updateCursor();
            return layer;
        }

        addShapeLayer(shape = "rectangle", options = {}) {
            const width = Math.round(this.state.canvasWidth * 0.34);
            const height = 86;
            return this.addLayer({
                type: "shape",
                name: shape === "circle" ? "Circle" : "Shape",
                shape,
                x: Math.round(options.x == null ? this.state.canvasWidth * 0.16 : options.x - width / 2),
                y: Math.round(options.y == null ? this.state.canvasHeight * 0.66 : options.y - height / 2),
                width,
                height,
                zIndex: this.state.layers.length
            }, "Add shape");
        }

        addLogoLayer(options = {}) {
            const margin = Math.round(Math.min(this.state.canvasWidth, this.state.canvasHeight) * 0.06);
            const width = 192;
            const height = 58;
            return this.addLayer({
                type: "logo",
                name: "AZIEL Wordmark",
                x: Math.round(options.x == null ? margin : options.x - width / 2),
                y: Math.round(options.y == null ? margin : options.y - height / 2),
                width,
                height,
                color: "#ffffff",
                opacity: 0.9,
                zIndex: this.state.layers.length
            }, "Add logo");
        }

        getLayer(id) {
            return this.state.layers.find(layer => layer.id === id) || null;
        }

        getSelectedLayer() {
            return this.getLayer(this.state.selectedLayerIds[0]);
        }

        getSelectedLayers() {
            return this.state.selectedLayerIds.map(id => this.getLayer(id)).filter(Boolean);
        }

        selectLayer(id, options = {}) {
            if (!id) this.state.selectedLayerIds = [];
            else if (options.additive) {
                if (!this.state.selectedLayerIds.includes(id)) this.state.selectedLayerIds.push(id);
            } else this.state.selectedLayerIds = [id];
            this.render();
        }

        toggleLayerSelection(id) {
            const selected = new Set(this.state.selectedLayerIds);
            if (selected.has(id)) selected.delete(id);
            else selected.add(id);
            this.state.selectedLayerIds = [...selected].filter(layerId => {
                const layer = this.getLayer(layerId);
                return layer && this.isEffectivelyVisible(layer);
            });
            this.render();
        }

        selectAll() {
            this.state.selectedLayerIds = this.state.layers.filter(layer => this.isEffectivelyVisible(layer) && !this.isEffectivelyLocked(layer)).map(layer => layer.id);
            this.render();
        }

        setActiveTool(tool) {
            this.cancelInlineTextEdit({ commit: true });
            this.state.marquee = null;
            this.state.activeTool = SUPPORTED_TOOLS.includes(tool) ? tool : "select";
            this.currentTool = this.state.activeTool;
            this.updateCursor();
            this.render();
        }

        duplicateSelectedLayer() {
            const selected = this.getSelectedLayers().filter(layer => !this.isEffectivelyLocked(layer));
            if (!selected.length) return null;
            const idMap = new Map();
            const selectedIds = new Set(selected.map(layer => layer.id));
            const copiedLayers = this.state.layers.filter(layer => selectedIds.has(layer.id) || selected.some(item => item.type === "group" && item.childIds?.includes(layer.id)));
            const copies = copiedLayers.map(layer => {
                const id = createId(layer.type);
                idMap.set(layer.id, id);
                return normalizeLayer({
                    ...clone(layer),
                    id,
                    name: `${layer.name} copy`,
                    x: layer.x + 24,
                    y: layer.y + 24,
                    parentId: "",
                    zIndex: this.state.layers.length,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            });
            copies.forEach(copy => {
                if (copy.type === "group") copy.childIds = copy.childIds.map(id => idMap.get(id)).filter(Boolean);
                const original = copiedLayers.find(layer => idMap.get(layer.id) === copy.id);
                if (original?.parentId && idMap.has(original.parentId)) copy.parentId = idMap.get(original.parentId);
            });
            copies.forEach(copy => this.state.layers.push(copy));
            copiedLayers.forEach(layer => {
                if (this.imageCache.has(layer.id)) this.imageCache.set(idMap.get(layer.id), this.imageCache.get(layer.id));
            });
            this.normalizeZOrder();
            this.state.selectedLayerIds = copies.map(layer => layer.id);
            this.pushHistory(selected.length > 1 ? "Duplicate selection" : "Duplicate layer");
            this.render();
            return copies[0];
        }

        deleteSelectedLayer() {
            const selected = new Set(this.state.selectedLayerIds);
            if (!selected.size) return false;
            const deleteIds = new Set();
            this.state.layers.forEach(layer => {
                if (!selected.has(layer.id) || this.isEffectivelyLocked(layer)) return;
                deleteIds.add(layer.id);
                if (layer.type === "group") layer.childIds.forEach(id => deleteIds.add(id));
            });
            this.state.layers = this.state.layers
                .filter(layer => !deleteIds.has(layer.id))
                .map(layer => deleteIds.has(layer.parentId) ? { ...layer, parentId: "" } : layer);
            this.normalizeZOrder();
            this.state.selectedLayerIds = [];
            this.syncCompatFromSelection();
            this.pushHistory("Delete layer");
            this.render();
            return true;
        }

        updateSelectedLayer(patch = {}, options = {}) {
            const layer = this.getSelectedLayer();
            if (!layer || this.isEffectivelyLocked(layer)) return null;
            if (layer.type === "group" && this.isGroupTransformPatch(patch)) {
                this.applyGroupTransform(layer, patch);
                this.syncCompatFromSelection();
                if (!options.transient) this.pushHistory(options.label || "Edit group");
                this.render();
                return layer;
            }
            Object.assign(layer, patch, { updatedAt: new Date().toISOString() });
            this.syncCompatFromSelection();
            if (!options.transient) this.pushHistory(options.label || "Edit layer");
            this.render();
            return layer;
        }

        updateLayer(id, patch = {}, options = {}) {
            const layer = this.getLayer(id);
            if (!layer || (this.isEffectivelyLocked(layer) && !Object.prototype.hasOwnProperty.call(patch, "locked"))) return null;
            Object.assign(layer, patch, { updatedAt: new Date().toISOString() });
            this.syncCompatFromSelection();
            if (!options.transient) this.pushHistory(options.label || "Edit layer");
            this.render();
            return layer;
        }

        setLayerVisibility(id, visible) {
            return this.updateLayer(id, { visible: Boolean(visible) }, { label: visible ? "Show layer" : "Hide layer" });
        }

        setLayerLocked(id, locked) {
            const layer = this.getLayer(id);
            if (!layer) return null;
            layer.locked = Boolean(locked);
            this.pushHistory(locked ? "Lock layer" : "Unlock layer");
            this.render();
            return layer;
        }

        renameLayer(id, name) {
            return this.updateLayer(id, { name: String(name || "").trim() || "Layer" }, { label: "Rename layer" });
        }

        reorderLayer(id, direction) {
            const index = this.state.layers.findIndex(layer => layer.id === id);
            if (index < 0) return false;
            let next = index;
            if (direction === "front") next = this.state.layers.length - 1;
            if (direction === "back") next = 0;
            if (direction === "forward") next = Math.min(this.state.layers.length - 1, index + 1);
            if (direction === "backward") next = Math.max(0, index - 1);
            if (next === index) return false;
            const [layer] = this.state.layers.splice(index, 1);
            this.state.layers.splice(next, 0, layer);
            this.normalizeZOrder();
            this.pushHistory("Reorder layer");
            this.render();
            return true;
        }

        alignSelected(mode) {
            const bounds = this.getSelectionBounds();
            if (!bounds) return;
            let dx = 0;
            let dy = 0;
            if (mode === "left") dx = -bounds.x;
            if (mode === "center-x") dx = Math.round((this.state.canvasWidth - bounds.width) / 2) - bounds.x;
            if (mode === "right") dx = this.state.canvasWidth - bounds.width - bounds.x;
            if (mode === "top") dy = -bounds.y;
            if (mode === "center-y") dy = Math.round((this.state.canvasHeight - bounds.height) / 2) - bounds.y;
            if (mode === "bottom") dy = this.state.canvasHeight - bounds.height - bounds.y;
            this.moveSelection(this.getTransformLayerIds().map(id => clone(this.getLayer(id))).filter(Boolean), dx, dy);
            this.pushHistory("Align selection");
            this.render();
        }

        resizeLayer(layer, before, handle, dx, dy, constrain) {
            let x = before.x;
            let y = before.y;
            let width = before.width;
            let height = before.height;
            if (handle.includes("e")) width = before.width + dx;
            if (handle.includes("s")) height = before.height + dy;
            if (handle.includes("w")) {
                x = before.x + dx;
                width = before.width - dx;
            }
            if (handle.includes("n")) {
                y = before.y + dy;
                height = before.height - dy;
            }
            width = Math.max(MIN_LAYER_SIZE, width);
            height = Math.max(MIN_LAYER_SIZE, height);
            if (constrain) {
                const ratio = before.width / Math.max(1, before.height);
                if (Math.abs(dx) > Math.abs(dy)) height = width / ratio;
                else width = height * ratio;
            }
            Object.assign(layer, {
                x: Math.round(x),
                y: Math.round(y),
                width: Math.round(width),
                height: Math.round(height)
            });
        }

        normalizeZOrder() {
            this.state.layers.forEach((item, idx) => { item.zIndex = idx; });
        }

        isEffectivelyVisible(layerOrId) {
            const layer = typeof layerOrId === "string" ? this.getLayer(layerOrId) : layerOrId;
            if (!layer || layer.visible === false) return false;
            const parent = this.getParentGroup(layer);
            return parent ? parent.visible !== false : true;
        }

        isEffectivelyLocked(layerOrId) {
            const layer = typeof layerOrId === "string" ? this.getLayer(layerOrId) : layerOrId;
            if (!layer) return true;
            const parent = this.getParentGroup(layer);
            return Boolean(layer.locked || parent?.locked);
        }

        getParentGroup(layerOrId) {
            const layer = typeof layerOrId === "string" ? this.getLayer(layerOrId) : layerOrId;
            return layer?.parentId ? this.getLayer(layer.parentId) : null;
        }

        getChildLayers(group) {
            if (!group || group.type !== "group") return [];
            return (group.childIds || []).map(id => this.getLayer(id)).filter(Boolean);
        }

        getTransformLayerIds() {
            const ids = new Set();
            this.getSelectedLayers().forEach(layer => {
                if (this.isEffectivelyLocked(layer) || !this.isEffectivelyVisible(layer)) return;
                if (layer.type === "group") this.getChildLayers(layer).forEach(child => {
                    if (!child.locked && child.visible !== false) ids.add(child.id);
                });
                else ids.add(layer.id);
            });
            return [...ids];
        }

        getSelectionBounds(ids = this.state.selectedLayerIds) {
            const layers = ids.map(id => this.getLayer(id)).filter(layer => layer && this.isEffectivelyVisible(layer));
            if (!layers.length) return null;
            const boxes = layers.map(layer => layer.type === "group" ? this.computeGroupBounds(layer) : layer).filter(Boolean);
            if (!boxes.length) return null;
            const minX = Math.min(...boxes.map(layer => layer.x));
            const minY = Math.min(...boxes.map(layer => layer.y));
            const maxX = Math.max(...boxes.map(layer => layer.x + layer.width));
            const maxY = Math.max(...boxes.map(layer => layer.y + layer.height));
            return {
                x: Math.round(minX),
                y: Math.round(minY),
                width: Math.max(MIN_LAYER_SIZE, Math.round(maxX - minX)),
                height: Math.max(MIN_LAYER_SIZE, Math.round(maxY - minY))
            };
        }

        computeGroupBounds(group) {
            const children = this.getChildLayers(group).filter(layer => layer.visible !== false);
            if (!children.length) return group;
            const bounds = this.getSelectionBounds(children.map(layer => layer.id));
            if (bounds) Object.assign(group, bounds);
            return bounds || group;
        }

        isGroupTransformPatch(patch) {
            return ["x", "y", "width", "height", "rotation"].some(key => Object.prototype.hasOwnProperty.call(patch, key));
        }

        applyGroupTransform(group, patch = {}) {
            const before = this.computeGroupBounds(group);
            if (!before) return;
            const next = {
                ...before,
                x: patch.x == null ? before.x : Number(patch.x),
                y: patch.y == null ? before.y : Number(patch.y),
                width: patch.width == null ? before.width : Math.max(MIN_LAYER_SIZE, Number(patch.width)),
                height: patch.height == null ? before.height : Math.max(MIN_LAYER_SIZE, Number(patch.height)),
                rotation: patch.rotation == null ? Number(group.rotation || 0) : Number(patch.rotation || 0)
            };
            const scaleX = next.width / Math.max(1, before.width);
            const scaleY = next.height / Math.max(1, before.height);
            const centerBefore = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
            const centerNext = { x: next.x + next.width / 2, y: next.y + next.height / 2 };
            const rotationDelta = next.rotation - Number(group.rotation || 0);
            this.getChildLayers(group).forEach(child => {
                const cx = child.x + child.width / 2;
                const cy = child.y + child.height / 2;
                child.width = Math.max(MIN_LAYER_SIZE, Math.round(child.width * scaleX));
                child.height = Math.max(MIN_LAYER_SIZE, Math.round(child.height * scaleY));
                child.x = Math.round(centerNext.x + (cx - centerBefore.x) * scaleX - child.width / 2);
                child.y = Math.round(centerNext.y + (cy - centerBefore.y) * scaleY - child.height / 2);
                child.rotation = Math.round((Number(child.rotation || 0) + rotationDelta) * 100) / 100;
                child.updatedAt = new Date().toISOString();
            });
            Object.assign(group, next, { updatedAt: new Date().toISOString() });
        }

        moveSelection(beforeLayers = [], dx = 0, dy = 0) {
            beforeLayers.forEach(before => {
                const layer = this.getLayer(before.id);
                if (!layer || this.isEffectivelyLocked(layer)) return;
                layer.x = Math.round(before.x + dx);
                layer.y = Math.round(before.y + dy);
                if (this.state.canvas.snap) this.snapLayer(layer);
                layer.updatedAt = new Date().toISOString();
            });
            this.state.layers.filter(layer => layer.type === "group").forEach(group => this.computeGroupBounds(group));
        }

        nudgeSelection(dx = 0, dy = 0) {
            const beforeLayers = this.getTransformLayerIds().map(id => clone(this.getLayer(id))).filter(Boolean);
            this.moveSelection(beforeLayers, dx, dy);
            this.syncCompatFromSelection();
            this.pushHistory("Move selection");
            this.render();
        }

        resizeSelection(beforeBounds, beforeLayers = [], handle = "se", dx = 0, dy = 0, constrain = false) {
            const next = { ...beforeBounds };
            this.resizeLayer(next, beforeBounds, handle, dx, dy, constrain);
            const scaleX = next.width / Math.max(1, beforeBounds.width);
            const scaleY = next.height / Math.max(1, beforeBounds.height);
            beforeLayers.forEach(before => {
                const layer = this.getLayer(before.id);
                if (!layer || this.isEffectivelyLocked(layer)) return;
                layer.x = Math.round(next.x + (before.x - beforeBounds.x) * scaleX);
                layer.y = Math.round(next.y + (before.y - beforeBounds.y) * scaleY);
                layer.width = Math.max(MIN_LAYER_SIZE, Math.round(before.width * scaleX));
                layer.height = Math.max(MIN_LAYER_SIZE, Math.round(before.height * scaleY));
                layer.updatedAt = new Date().toISOString();
            });
            this.state.layers.filter(layer => layer.type === "group").forEach(group => this.computeGroupBounds(group));
        }

        rotateSelection(beforeBounds, beforeLayers = [], point) {
            const centerX = beforeBounds.x + beforeBounds.width / 2;
            const centerY = beforeBounds.y + beforeBounds.height / 2;
            const angle = Math.round(Math.atan2(point.y - centerY, point.x - centerX) * 180 / Math.PI + 90);
            beforeLayers.forEach(before => {
                const layer = this.getLayer(before.id);
                if (!layer || this.isEffectivelyLocked(layer)) return;
                layer.rotation = angle;
                layer.updatedAt = new Date().toISOString();
            });
            this.state.layers.filter(layer => layer.type === "group").forEach(group => this.computeGroupBounds(group));
        }

        groupSelection() {
            const selected = this.getSelectedLayers().filter(layer => layer.type !== "group" && !layer.parentId && this.isEffectivelyVisible(layer) && !this.isEffectivelyLocked(layer));
            if (selected.length < 2) return null;
            const bounds = this.getSelectionBounds(selected.map(layer => layer.id));
            const group = normalizeLayer({
                id: createId("group"),
                type: "group",
                name: `Group ${this.state.layers.filter(layer => layer.type === "group").length + 1}`,
                childIds: selected.sort((a, b) => a.zIndex - b.zIndex).map(layer => layer.id),
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                zIndex: Math.max(...selected.map(layer => layer.zIndex))
            });
            selected.forEach(layer => { layer.parentId = group.id; });
            this.state.layers.push(group);
            this.normalizeZOrder();
            this.state.selectedLayerIds = [group.id];
            this.pushHistory("Group layers");
            this.render();
            return group;
        }

        ungroupSelection() {
            const groups = this.getSelectedLayers().filter(layer => layer.type === "group");
            if (!groups.length) return false;
            const groupIds = new Set(groups.map(group => group.id));
            const childIds = [];
            this.state.layers.forEach(layer => {
                if (groupIds.has(layer.parentId)) {
                    layer.parentId = "";
                    childIds.push(layer.id);
                }
            });
            this.state.layers = this.state.layers.filter(layer => !groupIds.has(layer.id));
            this.normalizeZOrder();
            this.state.selectedLayerIds = childIds;
            this.pushHistory("Ungroup layers");
            this.render();
            return true;
        }

        toggleGroupCollapsed(id) {
            const group = this.getLayer(id);
            if (!group || group.type !== "group") return;
            group.collapsed = !group.collapsed;
            this.render();
        }

        marqueeRect(drag) {
            const x = Math.min(drag.startX, drag.currentX);
            const y = Math.min(drag.startY, drag.currentY);
            return {
                x: Math.round(x),
                y: Math.round(y),
                width: Math.round(Math.abs(drag.currentX - drag.startX)),
                height: Math.round(Math.abs(drag.currentY - drag.startY))
            };
        }

        applyMarqueeSelection(drag) {
            const rect = this.marqueeRect(drag);
            const enclosed = this.state.layers
                .filter(layer => this.isEffectivelyVisible(layer) && !this.isEffectivelyLocked(layer))
                .filter(layer => layer.x >= rect.x && layer.y >= rect.y && layer.x + layer.width <= rect.x + rect.width && layer.y + layer.height <= rect.y + rect.height)
                .map(layer => layer.id);
            const next = new Set(drag.additive || drag.subtractive ? drag.beforeSelectedLayerIds : []);
            enclosed.forEach(id => {
                if (drag.subtractive) next.delete(id);
                else next.add(id);
            });
            this.state.selectedLayerIds = [...next];
        }

        snapLayer(layer) {
            const threshold = 8;
            const centers = [
                { key: "x", value: 0 },
                { key: "x", value: Math.round((this.state.canvasWidth - layer.width) / 2) },
                { key: "x", value: this.state.canvasWidth - layer.width },
                { key: "y", value: 0 },
                { key: "y", value: Math.round((this.state.canvasHeight - layer.height) / 2) },
                { key: "y", value: this.state.canvasHeight - layer.height }
            ];
            centers.forEach(target => {
                if (Math.abs(layer[target.key] - target.value) <= threshold) layer[target.key] = target.value;
            });
        }

        hitTest(point, options = {}) {
            const bounds = this.getSelectionBounds();
            if (bounds && this.state.selectedLayerIds.length) {
                const handle = this.hitHandle(bounds, point);
                if (handle) return { layerId: this.state.selectedLayerIds[0], handle };
            }

            const layers = [...this.state.layers].sort((a, b) => b.zIndex - a.zIndex);
            const hit = layers.find(layer => (
                this.isEffectivelyVisible(layer) &&
                (options.includeLocked || !this.isEffectivelyLocked(layer)) &&
                point.x >= layer.x &&
                point.y >= layer.y &&
                point.x <= layer.x + layer.width &&
                point.y <= layer.y + layer.height
            ));
            if (!hit) return null;
            const parent = this.getParentGroup(hit);
            return { layerId: parent?.id || hit.id };
        }

        hitHandle(layer, point) {
            const handles = this.transformHandles(layer);
            return Object.entries(handles).find(([, handle]) => (
                Math.abs(point.x - handle.x) <= handle.size &&
                Math.abs(point.y - handle.y) <= handle.size
            ))?.[0] || "";
        }

        transformHandles(layer) {
            const size = Math.max(8, this.state.canvasWidth / 160);
            const midX = layer.x + layer.width / 2;
            const midY = layer.y + layer.height / 2;
            return {
                nw: { x: layer.x, y: layer.y, size },
                n: { x: midX, y: layer.y, size },
                rotate: { x: midX, y: layer.y - 24, size: size + 3 },
                ne: { x: layer.x + layer.width, y: layer.y, size },
                e: { x: layer.x + layer.width, y: midY, size },
                se: { x: layer.x + layer.width, y: layer.y + layer.height, size },
                s: { x: midX, y: layer.y + layer.height, size },
                sw: { x: layer.x, y: layer.y + layer.height, size },
                w: { x: layer.x, y: midY, size }
            };
        }

        centerImage(options = {}) {
            const layer = this.getSelectedLayer() || this.state.layers.find(item => item.type === "image");
            if (!layer) return;
            if (!options.preserveScale && layer.type === "image") {
                const image = this.imageCache.get(layer.id) || this.sourceImage;
                if (image) {
                    const scale = fitScale(this.state, image, this.state.fitMode);
                    layer.width = Math.round(image.naturalWidth * scale);
                    layer.height = Math.round(image.naturalHeight * scale);
                }
            }
            layer.x = Math.round((this.state.canvasWidth - layer.width) / 2);
            layer.y = Math.round((this.state.canvasHeight - layer.height) / 2);
            if (!options.skipHistory) this.pushHistory("Center layer");
            this.syncCompatFromSelection();
            this.render();
        }

        resetImage() {
            const layer = this.getSelectedLayer() || this.state.layers.find(item => item.type === "image");
            if (!layer) return;
            layer.flipX = false;
            layer.flipY = false;
            layer.rotation = 0;
            layer.opacity = 1;
            layer.adjustments = defaultAdjustments();
            layer.filterPreset = "original";
            layer.filterIntensity = 100;
            layer.crop = null;
            this.centerImage({ preserveScale: false, skipHistory: true });
            this.pushHistory("Reset image");
            this.render();
        }

        ensureCrop(layer, options = {}) {
            if (!layer || layer.type !== "image") return null;
            if (!layer.crop) {
                layer.crop = {
                    x: layer.x,
                    y: layer.y,
                    width: layer.width,
                    height: layer.height,
                    aspect: "free"
                };
                if (!options.silent) this.render();
            }
            return layer.crop;
        }

        updateCropDrag(drag, dx, dy, constrain) {
            const layer = this.getLayer(drag.layerId);
            if (!layer || layer.type !== "image" || this.isEffectivelyLocked(layer)) return;
            const crop = { ...drag.beforeCrop };
            if (drag.handle === "move") {
                crop.x += dx;
                crop.y += dy;
            } else {
                this.resizeLayer(crop, drag.beforeCrop, drag.handle, dx, dy, constrain);
            }
            const minX = layer.x;
            const minY = layer.y;
            const maxX = layer.x + layer.width;
            const maxY = layer.y + layer.height;
            crop.x = clamp(crop.x, minX, maxX - MIN_LAYER_SIZE);
            crop.y = clamp(crop.y, minY, maxY - MIN_LAYER_SIZE);
            crop.width = Math.min(Math.max(MIN_LAYER_SIZE, crop.width), maxX - crop.x);
            crop.height = Math.min(Math.max(MIN_LAYER_SIZE, crop.height), maxY - crop.y);
            layer.crop = crop;
        }

        resetCrop() {
            const layer = this.getSelectedLayer();
            if (!layer || layer.type !== "image" || this.isEffectivelyLocked(layer)) return null;
            layer.crop = null;
            this.pushHistory("Reset crop");
            this.render();
            return layer;
        }

        applyCrop() {
            const layer = this.getSelectedLayer();
            if (!layer || layer.type !== "image" || !layer.crop || this.isEffectivelyLocked(layer)) return null;
            this.pushHistory("Apply crop");
            this.render();
            return layer;
        }

        cancelCrop(previousCrop = null) {
            const layer = this.getSelectedLayer();
            if (!layer || layer.type !== "image") return;
            layer.crop = previousCrop ? clone(previousCrop) : null;
            this.render();
        }

        setFitMode(mode) {
            this.state.fitMode = mode === "fit" ? "fit" : "cover";
            this.centerImage({ preserveScale: false, skipHistory: true });
            this.pushHistory("Change fit");
            this.render();
        }

        setSourceProperty(key, value, options = {}) {
            const layer = this.getSelectedLayer() || this.state.layers.find(item => item.type === "image");
            if (!layer || layer.locked) return;
            if (key === "scale") {
                const image = this.imageCache.get(layer.id) || this.sourceImage;
                const ratio = image?.naturalWidth ? image.naturalHeight / image.naturalWidth : layer.height / layer.width;
                layer.width = Math.max(MIN_LAYER_SIZE, Math.round((image?.naturalWidth || layer.width) * Number(value || 1)));
                layer.height = Math.max(MIN_LAYER_SIZE, Math.round(layer.width * ratio));
            } else if (key === "flipped") {
                layer.flipX = Boolean(value);
            } else if (Object.prototype.hasOwnProperty.call(layer, key)) {
                layer[key] = value;
            }
            this.syncCompatFromSelection();
            if (!options.transient) this.pushHistory("Edit artwork");
            this.render();
        }

        applyFilterPreset(presetId = "original", intensity = 100) {
            const layer = this.getSelectedLayer();
            if (!layer || layer.type !== "image" || this.isEffectivelyLocked(layer)) return null;
            const preset = FILTER_PRESETS[presetId] || FILTER_PRESETS.original;
            layer.filterPreset = presetId;
            layer.filterIntensity = clamp(intensity, 0, 100);
            layer.adjustments = interpolateAdjustments(preset.adjustments, layer.filterIntensity);
            layer.updatedAt = new Date().toISOString();
            this.pushHistory(presetId === "original" ? "Reset filter" : `Apply ${preset.label} filter`);
            this.render();
            return layer;
        }

        setFilterIntensity(intensity = 100, options = {}) {
            const layer = this.getSelectedLayer();
            if (!layer || layer.type !== "image" || this.isEffectivelyLocked(layer)) return null;
            const preset = FILTER_PRESETS[layer.filterPreset] || FILTER_PRESETS.original;
            layer.filterIntensity = clamp(intensity, 0, 100);
            layer.adjustments = interpolateAdjustments(preset.adjustments, layer.filterIntensity);
            layer.updatedAt = new Date().toISOString();
            if (!options.transient) this.pushHistory("Change filter intensity");
            this.render();
            return layer;
        }

        beginInlineTextEdit(layerId) {
            const layer = this.getLayer(layerId);
            if (!layer || !["text", "logo"].includes(layer.type) || this.isEffectivelyLocked(layer)) return;
            this.cancelInlineTextEdit({ commit: true });
            this.selectLayer(layer.id);
            const editor = document.createElement("textarea");
            editor.className = "ds-inline-text-editor";
            editor.value = layer.type === "logo" ? layer.text || "AZIEL" : layer.text || "";
            editor.style.left = `${layer.x}px`;
            editor.style.top = `${layer.y}px`;
            editor.style.width = `${layer.width}px`;
            editor.style.height = `${Math.max(44, layer.height)}px`;
            editor.style.fontSize = `${layer.fontSize || 64}px`;
            editor.style.fontWeight = layer.fontWeight || "800";
            editor.style.color = layer.color || "#fff";
            this.frame?.appendChild(editor);
            this.textEditor = editor;
            this.editingTextLayerId = layer.id;
            editor.focus();
            editor.select();
            editor.addEventListener("input", () => {
                layer.text = editor.value;
                this.render();
                this.onStateChange(this.state, { transient: true });
            });
            editor.addEventListener("keydown", event => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    this.cancelInlineTextEdit({ commit: false });
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    this.cancelInlineTextEdit({ commit: true });
                }
            });
            editor.addEventListener("blur", () => this.cancelInlineTextEdit({ commit: true }));
        }

        cancelInlineTextEdit(options = {}) {
            if (!this.textEditor || !this.editingTextLayerId) return;
            const layer = this.getLayer(this.editingTextLayerId);
            if (layer && options.commit !== false) {
                layer.text = this.textEditor.value || (layer.type === "logo" ? "AZIEL" : "Text");
                layer.updatedAt = new Date().toISOString();
                this.pushHistory("Edit text");
            }
            this.textEditor.remove();
            this.textEditor = null;
            this.editingTextLayerId = "";
            this.render();
            this.onStateChange(this.state);
        }

        setLogoEnabled(enabled) {
            if (enabled) {
                const logo = this.state.layers.find(layer => layer.type === "logo");
                if (logo) {
                    logo.visible = true;
                    this.selectLayer(logo.id);
                } else {
                    this.addLogoLayer();
                }
            } else {
                const logo = this.getSelectedLayer()?.type === "logo"
                    ? this.getSelectedLayer()
                    : this.state.layers.find(layer => layer.type === "logo");
                if (logo) logo.visible = false;
                this.state.selectedLayerIds = [];
                this.pushHistory("Hide logo");
                this.render();
            }
            this.syncCompatFromSelection();
        }

        setLogoProperty(key, value, options = {}) {
            const layer = this.getSelectedLayer()?.type === "logo"
                ? this.getSelectedLayer()
                : this.state.layers.find(item => item.type === "logo");
            if (!layer || layer.locked) return;
            if (key === "scale") {
                layer.width = Math.round(this.state.canvasWidth * Number(value || 0.16));
                layer.height = Math.round(layer.width * 0.3);
            } else if (Object.prototype.hasOwnProperty.call(layer, key)) {
                layer[key] = value;
            }
            this.syncCompatFromSelection();
            if (!options.transient) this.pushHistory("Edit logo");
            this.render();
        }

        positionLogo(position, options = {}) {
            const layer = this.getSelectedLayer()?.type === "logo"
                ? this.getSelectedLayer()
                : this.state.layers.find(item => item.type === "logo");
            if (!layer) return;
            const margin = Math.round(Math.min(this.state.canvasWidth, this.state.canvasHeight) * 0.05);
            const positions = {
                "top-left": { x: margin, y: margin },
                "top-right": { x: this.state.canvasWidth - layer.width - margin, y: margin },
                "bottom-left": { x: margin, y: this.state.canvasHeight - layer.height - margin },
                "bottom-right": { x: this.state.canvasWidth - layer.width - margin, y: this.state.canvasHeight - layer.height - margin },
                center: { x: (this.state.canvasWidth - layer.width) / 2, y: (this.state.canvasHeight - layer.height) / 2 }
            };
            const next = positions[position] || positions["bottom-right"];
            layer.x = Math.round(next.x);
            layer.y = Math.round(next.y);
            layer.position = position;
            if (!options.skipHistory) this.pushHistory("Position logo");
            this.render();
        }

        fitAllImageLayers() {
            this.state.layers.filter(layer => layer.type === "image").forEach(layer => {
                const image = this.imageCache.get(layer.id) || this.sourceImage;
                if (!image) return;
                const scale = fitScale(this.state, image, this.state.fitMode);
                layer.width = Math.round(image.naturalWidth * scale);
                layer.height = Math.round(image.naturalHeight * scale);
                layer.x = Math.round((this.state.canvasWidth - layer.width) / 2);
                layer.y = Math.round((this.state.canvasHeight - layer.height) / 2);
            });
        }

        pushHistory(label = "Edit") {
            const snapshot = {
                label,
                state: clone(this.getState()),
                at: new Date().toISOString()
            };
            const last = this.history[this.history.length - 1];
            if (last && JSON.stringify(last.state) === JSON.stringify(snapshot.state)) return;
            this.history.push(snapshot);
            if (this.history.length > HISTORY_LIMIT) this.history.shift();
            this.future = [];
        }

        undo() {
            if (this.history.length < 2) return false;
            const current = this.history.pop();
            this.future.push(current);
            this.restoreSnapshot(this.history[this.history.length - 1].state);
            return true;
        }

        redo() {
            const next = this.future.pop();
            if (!next) return false;
            this.history.push(next);
            this.restoreSnapshot(next.state);
            return true;
        }

        restoreSnapshot(snapshot) {
            this.state = this.migrateState(snapshot);
            this.currentTool = this.state.activeTool;
            this.resizeCanvas();
            this.syncCompatFromSelection();
            this.render();
        }

        loadState(editorState, options = {}) {
            const previousImage = options.preserveSourceImage ? this.sourceImage : null;
            const previousUrl = options.preserveSourceImage ? this.sourceObjectUrl : "";
            if (!options.preserveSourceImage) {
                this.revokeSourceUrl();
                this.sourceImage = null;
                this.sourceObjectUrl = "";
                this.imageCache.clear();
            }
            this.state = this.migrateState(editorState);
            this.currentTool = this.state.activeTool;
            this.resizeCanvas();
            if (previousImage) {
                const firstImage = this.state.layers.find(layer => layer.type === "image");
                if (firstImage) {
                    this.imageCache.set(firstImage.id, previousImage);
                    this.sourceImage = previousImage;
                    this.sourceObjectUrl = previousUrl;
                }
            }
            this.history = [{ label: "Open project", state: clone(this.getState()), at: new Date().toISOString() }];
            this.future = [];
            this.syncCompatFromSelection();
            this.render();
        }

        getState() {
            return clone({
                ...this.state,
                layers: this.state.layers.map(layer => ({ ...layer })),
                selectedLayerIds: [...this.state.selectedLayerIds]
            });
        }

        render(options = {}) {
            const exportMode = Boolean(options.exportMode);
            if (!exportMode) this.applyViewport();
            this.ctx.clearRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
            this.drawCanvasBackground(exportMode);
            if (this.state.showGrid && !exportMode) this.drawGrid();
            this.state.layers
                .filter(layer => this.isEffectivelyVisible(layer))
                .sort((a, b) => a.zIndex - b.zIndex)
                .forEach(layer => this.drawLayer(layer));
            if (!exportMode && this.state.showSafeAreas) this.drawSafeAreas();
            if (!exportMode) this.drawSelection();
            this.syncCanvasEmptyState();
        }

        drawCanvasBackground(exportMode) {
            if (!this.state.canvas.transparent) {
                this.ctx.fillStyle = this.state.canvas.backgroundColor || "#000000";
                this.ctx.fillRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
                return;
            }
            if (exportMode) return;
            const size = 32;
            for (let y = 0; y < this.state.canvasHeight; y += size) {
                for (let x = 0; x < this.state.canvasWidth; x += size) {
                    this.ctx.fillStyle = ((x / size + y / size) % 2 === 0)
                        ? "rgba(148, 163, 184, .10)"
                        : "rgba(15, 23, 42, .18)";
                    this.ctx.fillRect(x, y, size, size);
                }
            }
        }

        drawLayer(layer) {
            this.ctx.save();
            const parent = this.getParentGroup(layer);
            this.ctx.globalAlpha = clamp(layer.opacity, 0, 1) * clamp(parent?.opacity == null ? 1 : parent.opacity, 0, 1);
            this.ctx.globalCompositeOperation = layer.blendMode || "source-over";
            this.ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
            this.ctx.rotate((Number(layer.rotation || 0) * Math.PI) / 180);
            this.ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
            if (layer.effects?.shadow) {
                this.ctx.shadowColor = "rgba(0, 0, 0, .42)";
                this.ctx.shadowBlur = 18;
                this.ctx.shadowOffsetY = 10;
            }
            if (layer.effects?.glow) {
                this.ctx.shadowColor = layer.color || "rgba(139, 92, 246, .65)";
                this.ctx.shadowBlur = 24;
            }
            if (layer.type === "group") {
                this.ctx.restore();
                return;
            }
            if (layer.type === "image") this.drawImageLayer(layer);
            if (layer.type === "text" || layer.type === "logo") this.drawTextLayer(layer);
            if (layer.type === "shape") this.drawShapeLayer(layer);
            this.ctx.restore();
        }

        drawImageLayer(layer) {
            const image = this.imageCache.get(layer.id) || (layer.id === this.state.selectedLayerIds[0] ? this.sourceImage : null);
            if (!image) {
                this.ctx.fillStyle = "rgba(148, 163, 184, .16)";
                this.ctx.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
                return;
            }
            const filters = [];
            const adj = { ...defaultAdjustments(), ...(layer.adjustments || {}) };
            const brightness = Number(adj.brightness || 0) + Number(adj.exposure || 0);
            filters.push(`brightness(${1 + brightness / 100})`);
            filters.push(`contrast(${1 + adj.contrast / 100})`);
            filters.push(`saturate(${1 + adj.saturation / 100})`);
            if (adj.grayscale) filters.push(`grayscale(${clamp(adj.grayscale, 0, 100)}%)`);
            if (adj.sepia) filters.push(`sepia(${clamp(adj.sepia, 0, 100)}%)`);
            if (adj.blur) filters.push(`blur(${clamp(adj.blur, 0, 20)}px)`);
            this.ctx.filter = filters.join(" ");
            const crop = layer.crop;
            if (crop) {
                const cropX = crop.x - layer.x - layer.width / 2;
                const cropY = crop.y - layer.y - layer.height / 2;
                this.ctx.save();
                this.ctx.beginPath();
                this.ctx.rect(cropX, cropY, crop.width, crop.height);
                this.ctx.clip();
                this.ctx.drawImage(image, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
                this.ctx.restore();
            } else {
                this.ctx.drawImage(image, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
            }
            this.ctx.filter = "none";
            if (adj.temperature || adj.tint) {
                this.ctx.globalAlpha = Math.min(0.28, Math.abs(adj.temperature || adj.tint) / 240);
                this.ctx.fillStyle = adj.temperature >= 0 ? "#f59e0b" : "#38bdf8";
                if (adj.tint) this.ctx.fillStyle = adj.tint >= 0 ? "#ec4899" : "#22c55e";
                this.ctx.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
            }
        }

        drawTextLayer(layer) {
            const text = layer.type === "logo" ? "AZIEL" : layer.text || "Text";
            this.ctx.fillStyle = layer.color || "#fff";
            this.ctx.font = `${layer.italic ? "italic " : ""}${layer.fontWeight || "800"} ${layer.fontSize || 64}px ${layer.fontFamily || "Inter, system-ui, sans-serif"}`;
            this.ctx.textAlign = layer.align || "left";
            this.ctx.textBaseline = "top";
            const lines = String(text).split("\n");
            const lineHeight = (layer.fontSize || 64) * (layer.lineHeight || 1.12);
            lines.forEach((line, index) => {
                const x = layer.align === "center" ? 0 : layer.align === "right" ? layer.width / 2 : -layer.width / 2;
                const y = -layer.height / 2 + index * lineHeight;
                if (layer.stroke && layer.strokeWidth) {
                    this.ctx.strokeStyle = layer.stroke;
                    this.ctx.lineWidth = layer.strokeWidth;
                    this.ctx.strokeText(line, x, y);
                }
                this.ctx.fillText(line, x, y);
            });
        }

        drawShapeLayer(layer) {
            this.ctx.fillStyle = layer.fill || "rgba(139, 92, 246, .38)";
            this.ctx.strokeStyle = layer.stroke || "transparent";
            this.ctx.lineWidth = Number(layer.strokeWidth || 0);
            const x = -layer.width / 2;
            const y = -layer.height / 2;
            if (layer.shape === "circle") {
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, layer.width / 2, layer.height / 2, 0, 0, Math.PI * 2);
                this.ctx.fill();
                if (layer.strokeWidth) this.ctx.stroke();
                return;
            }
            if (layer.shape === "line") {
                this.ctx.beginPath();
                this.ctx.moveTo(x, 0);
                this.ctx.lineTo(x + layer.width, 0);
                this.ctx.strokeStyle = layer.stroke || layer.fill || "#fff";
                this.ctx.lineWidth = Math.max(1, Number(layer.strokeWidth || 4));
                this.ctx.stroke();
                return;
            }
            const radius = layer.shape === "rounded-rectangle" ? Number(layer.radius || 16) : 0;
            this.roundRect(x, y, layer.width, layer.height, radius);
            this.ctx.fill();
            if (layer.strokeWidth) this.ctx.stroke();
        }

        roundRect(x, y, width, height, radius) {
            const r = Math.min(radius, width / 2, height / 2);
            this.ctx.beginPath();
            this.ctx.moveTo(x + r, y);
            this.ctx.arcTo(x + width, y, x + width, y + height, r);
            this.ctx.arcTo(x + width, y + height, x, y + height, r);
            this.ctx.arcTo(x, y + height, x, y, r);
            this.ctx.arcTo(x, y, x + width, y, r);
            this.ctx.closePath();
        }

        drawSelection() {
            const bounds = this.getSelectionBounds();
            if (!bounds && !this.state.marquee) return;
            this.ctx.save();
            this.ctx.strokeStyle = "rgba(139, 92, 246, .96)";
            this.ctx.lineWidth = Math.max(1, this.state.canvasWidth / 900);
            this.ctx.setLineDash([8, 6]);
            if (bounds && this.state.selectedLayerIds.length > 1) {
                this.getSelectedLayers().forEach(layer => {
                    if (layer) this.ctx.strokeRect(layer.x, layer.y, layer.width, layer.height);
                });
            }
            if (bounds) {
                this.ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
                this.ctx.setLineDash([]);
                this.ctx.fillStyle = "#8b5cf6";
                Object.values(this.transformHandles(bounds)).forEach(handle => {
                    this.ctx.fillRect(handle.x - 5, handle.y - 5, 10, 10);
                });
                this.ctx.beginPath();
                this.ctx.arc(bounds.x + bounds.width / 2, bounds.y - 24, 7, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.beginPath();
                this.ctx.moveTo(bounds.x + bounds.width / 2, bounds.y);
                this.ctx.lineTo(bounds.x + bounds.width / 2, bounds.y - 24);
                this.ctx.stroke();
            }
            if (this.state.activeTool === "crop") {
                const layer = this.getSelectedLayer();
                if (layer?.type === "image") {
                    const crop = this.ensureCrop(layer, { silent: true });
                    this.ctx.strokeStyle = "rgba(251, 191, 36, .95)";
                    this.ctx.fillStyle = "rgba(251, 191, 36, .08)";
                    this.ctx.setLineDash([10, 8]);
                    this.ctx.fillRect(crop.x, crop.y, crop.width, crop.height);
                    this.ctx.strokeRect(crop.x, crop.y, crop.width, crop.height);
                    this.ctx.setLineDash([]);
                }
            }
            if (this.state.marquee) {
                this.ctx.strokeStyle = "rgba(168, 85, 247, .9)";
                this.ctx.fillStyle = "rgba(139, 92, 246, .12)";
                this.ctx.fillRect(this.state.marquee.x, this.state.marquee.y, this.state.marquee.width, this.state.marquee.height);
                this.ctx.strokeRect(this.state.marquee.x, this.state.marquee.y, this.state.marquee.width, this.state.marquee.height);
            }
            this.ctx.restore();
        }

        drawSafeAreas() {
            const safe = Number(this.state.canvas.safeArea || 0.7);
            const width = this.state.canvasWidth * safe;
            const height = this.state.canvasHeight * safe;
            const x = (this.state.canvasWidth - width) / 2;
            const y = (this.state.canvasHeight - height) / 2;

            this.ctx.save();
            this.ctx.strokeStyle = "rgba(168, 85, 247, .42)";
            this.ctx.lineWidth = Math.max(1, this.state.canvasWidth / 1400);
            this.ctx.setLineDash([12, 10]);
            this.ctx.strokeRect(x, y, width, height);
            this.ctx.setLineDash([]);
            this.ctx.fillStyle = "rgba(255, 255, 255, .72)";
            this.ctx.font = `${Math.max(12, this.state.canvasWidth / 120)}px Inter, system-ui, sans-serif`;
            this.ctx.fillText("Safe area", x + 12, y + 22);
            this.ctx.restore();
        }

        drawGrid() {
            const gap = this.state.canvas.gridSpacing || this.state.canvasWidth / 12;
            this.ctx.save();
            this.ctx.strokeStyle = "rgba(148, 163, 184, .16)";
            this.ctx.lineWidth = 1;
            for (let x = gap; x < this.state.canvasWidth; x += gap) {
                this.ctx.beginPath();
                this.ctx.moveTo(x, 0);
                this.ctx.lineTo(x, this.state.canvasHeight);
                this.ctx.stroke();
            }
            for (let y = gap; y < this.state.canvasHeight; y += gap) {
                this.ctx.beginPath();
                this.ctx.moveTo(0, y);
                this.ctx.lineTo(this.state.canvasWidth, y);
                this.ctx.stroke();
            }
            this.ctx.restore();
        }

        syncCanvasEmptyState() {
            if (!this.empty) return;
            const hasSourceImage = this.state.layers.some(layer => this.isEffectivelyVisible(layer) && ["image", "text", "logo", "shape"].includes(layer.type));
            this.empty.hidden = hasSourceImage;
            this.empty.setAttribute("aria-hidden", hasSourceImage ? "true" : "false");
            this.frame?.classList.toggle("has-source-image", hasSourceImage);
        }

        syncCompatFromSelection() {
            const imageLayer = this.state.layers.find(layer => layer.type === "image");
            if (imageLayer) {
                this.state.source = {
                    assetId: imageLayer.assetId || "",
                    name: imageLayer.sourceName || imageLayer.name,
                    x: imageLayer.x,
                    y: imageLayer.y,
                    scale: imageLayer.naturalWidth ? imageLayer.width / imageLayer.naturalWidth : 1,
                    flipped: Boolean(imageLayer.flipX)
                };
            } else {
                this.state.source = { ...this.state.source, assetId: "", name: "" };
            }
            const logoLayer = this.state.layers.find(layer => layer.type === "logo" && layer.visible);
            this.state.logo = {
                ...this.state.logo,
                enabled: Boolean(logoLayer),
                x: logoLayer?.x || this.state.logo.x || 40,
                y: logoLayer?.y || this.state.logo.y || 40,
                opacity: logoLayer?.opacity || this.state.logo.opacity || 0.8,
                color: logoLayer?.color || this.state.logo.color || "#ffffff"
            };
        }

        zoomAt(_point, multiplier) {
            this.state.viewport.zoom = clamp((this.state.viewport.zoom || 1) * multiplier, 0.1, 4);
            this.applyViewport();
        }

        setZoom(value) {
            this.state.viewport.zoom = clamp(value, 0.1, 4);
            this.applyViewport();
            this.render();
        }

        fitViewport() {
            this.state.viewport = {
                ...this.state.viewport,
                zoom: 1,
                panX: 0,
                panY: 0
            };
            this.applyViewport();
            this.render();
        }

        applyViewport() {
            const viewport = this.state.viewport || {};
            const zoom = clamp(viewport.zoom == null ? 1 : viewport.zoom, 0.1, 4);
            const panX = Number(viewport.panX || 0);
            const panY = Number(viewport.panY || 0);
            this.canvas.style.transformOrigin = "center center";
            this.canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        }

        updateCursor(point) {
            if (!this.canvas) return;
            if (this.drag?.type === "pan") {
                this.canvas.style.cursor = "grabbing";
                return;
            }
            if (this.drag?.type === "move") {
                this.canvas.style.cursor = "move";
                return;
            }
            if (this.drag?.type === "resize") {
                this.canvas.style.cursor = this.cursorForHandle(this.drag.handle);
                return;
            }
            if (this.spacePanning || this.state.activeTool === "hand") {
                this.canvas.style.cursor = "grab";
                return;
            }
            if (this.state.activeTool === "zoom") {
                this.canvas.style.cursor = "zoom-in";
                return;
            }
            if (this.state.activeTool === "text") {
                this.canvas.style.cursor = "text";
                return;
            }
            if (this.state.activeTool === "image") {
                this.canvas.style.cursor = "copy";
                return;
            }
            if (this.state.activeTool === "logo" || this.state.activeTool === "shape") {
                this.canvas.style.cursor = "crosshair";
                return;
            }
            if (this.state.activeTool === "crop") {
                this.canvas.style.cursor = "crosshair";
                return;
            }
            const handle = point ? this.hitHandle(this.getSelectionBounds() || {}, point) : "";
            if (handle) {
                this.canvas.style.cursor = this.cursorForHandle(handle);
                return;
            }
            const hit = point ? this.hitTest(point) : null;
            this.canvas.style.cursor = hit ? "move" : "default";
        }

        cursorForHandle(handle = "") {
            if (handle === "rotate") return "grab";
            if (["n", "s"].includes(handle)) return "ns-resize";
            if (["e", "w"].includes(handle)) return "ew-resize";
            if (["ne", "sw"].includes(handle)) return "nesw-resize";
            if (["nw", "se"].includes(handle)) return "nwse-resize";
            return "default";
        }

        exportBlob(type = "image/webp", quality = 0.86) {
            return new Promise((resolve, reject) => {
                try {
                    this.render({ exportMode: true });
                    this.canvas.toBlob(blob => {
                        this.render();
                        if (!blob) {
                            reject(new Error("Canvas export failed."));
                            return;
                        }
                        resolve(blob);
                    }, type, type === "image/png" ? undefined : quality);
                } catch (error) {
                    this.render();
                    reject(error);
                }
            });
        }
    }

    window.AZIEL_DESIGN_STUDIO_CANVAS = {
        DesignStudioCanvas,
        LOGO_URL,
        HISTORY_LIMIT,
        createImageFromBlob,
        loadImageUrl
    };
})();
