(function () {
    const LOGO_URL = "/assets/logo/aziel-icon.webp";
    const HISTORY_LIMIT = 40;

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

    function cloneEditorState(editorState) {
        return JSON.parse(JSON.stringify(editorState));
    }

    function fitScale(preset, image, mode = "cover") {
        if (!image?.naturalWidth || !image?.naturalHeight) return 1;
        const scaleX = preset.width / image.naturalWidth;
        const scaleY = preset.height / image.naturalHeight;
        return mode === "fit" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
    }

    class DesignStudioCanvas {
        constructor(options = {}) {
            this.canvas = options.canvas;
            this.frame = options.frame;
            this.empty = options.empty;
            this.onStateChange = options.onStateChange || function () {};
            this.ctx = this.canvas.getContext("2d");
            this.sourceImage = null;
            this.sourceObjectUrl = "";
            this.logoImage = null;
            this.drag = null;
            this.history = [];
            this.future = [];
            this.state = this.createDefaultState(options.preset);
            this.boundHandlers = [];
        }

        createDefaultState(preset) {
            return {
                presetId: preset?.id || "open-graph",
                canvasWidth: preset?.width || 1200,
                canvasHeight: preset?.height || 630,
                fitMode: "cover",
                showSafeAreas: true,
                showGrid: false,
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
                    x: 0,
                    y: 0,
                    scale: 0.16,
                    opacity: 0.92,
                    position: "bottom-right",
                    src: LOGO_URL
                }
            };
        }

        async init() {
            this.logoImage = await loadImageUrl(LOGO_URL).catch(() => null);
            this.resizeCanvas();
            this.bindCanvasEvents();
            this.render();
        }

        dispose() {
            this.boundHandlers.forEach(([target, event, handler]) => target.removeEventListener(event, handler));
            this.boundHandlers = [];
            this.revokeSourceUrl();
        }

        on(target, event, handler, options) {
            target.addEventListener(event, handler, options);
            this.boundHandlers.push([target, event, handler]);
        }

        bindCanvasEvents() {
            const pointerDown = event => {
                if (!this.sourceImage && !this.state.logo.enabled) return;
                const point = this.eventToCanvasPoint(event);
                const layer = this.pickLayer(point);
                if (!layer) return;
                event.preventDefault();
                this.drag = {
                    layer,
                    startX: point.x,
                    startY: point.y,
                    sourceX: this.state.source.x,
                    sourceY: this.state.source.y,
                    logoX: this.state.logo.x,
                    logoY: this.state.logo.y
                };
                this.canvas.setPointerCapture?.(event.pointerId);
            };

            const pointerMove = event => {
                if (!this.drag) return;
                event.preventDefault();
                const point = this.eventToCanvasPoint(event);
                const dx = point.x - this.drag.startX;
                const dy = point.y - this.drag.startY;
                if (this.drag.layer === "logo") {
                    this.state.logo.x = Math.round(this.drag.logoX + dx);
                    this.state.logo.y = Math.round(this.drag.logoY + dy);
                } else {
                    this.state.source.x = Math.round(this.drag.sourceX + dx);
                    this.state.source.y = Math.round(this.drag.sourceY + dy);
                }
                this.render();
                this.onStateChange(this.state, { transient: true });
            };

            const pointerUp = () => {
                if (!this.drag) return;
                this.drag = null;
                this.pushHistory();
                this.onStateChange(this.state);
            };

            this.on(this.canvas, "pointerdown", pointerDown);
            this.on(window, "pointermove", pointerMove);
            this.on(window, "pointerup", pointerUp);
        }

        eventToCanvasPoint(event) {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: ((event.clientX - rect.left) / rect.width) * this.state.canvasWidth,
                y: ((event.clientY - rect.top) / rect.height) * this.state.canvasHeight
            };
        }

        pickLayer(point) {
            if (this.state.logo.enabled && this.logoImage) {
                const bounds = this.logoBounds();
                if (
                    point.x >= bounds.x &&
                    point.y >= bounds.y &&
                    point.x <= bounds.x + bounds.width &&
                    point.y <= bounds.y + bounds.height
                ) {
                    return "logo";
                }
            }
            return this.sourceImage ? "image" : null;
        }

        setPreset(preset) {
            this.state.presetId = preset.id;
            this.state.canvasWidth = preset.width;
            this.state.canvasHeight = preset.height;
            this.resizeCanvas();
            this.centerImage({ preserveScale: false });
            this.positionLogo(this.state.logo.position || "bottom-right", { skipHistory: true });
            this.pushHistory();
            this.render();
        }

        resizeCanvas() {
            const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
            this.canvas.width = this.state.canvasWidth * pixelRatio;
            this.canvas.height = this.state.canvasHeight * pixelRatio;
            this.canvas.style.aspectRatio = `${this.state.canvasWidth} / ${this.state.canvasHeight}`;
            this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        }

        async setSourceBlob(blob, metadata = {}) {
            this.revokeSourceUrl();
            const loaded = await createImageFromBlob(blob);
            this.sourceImage = loaded.image;
            this.sourceObjectUrl = loaded.url;
            this.state.source.assetId = metadata.assetId || "";
            this.state.source.name = metadata.name || metadata.originalName || blob.name || "Imported image";
            this.centerImage({ preserveScale: false });
            this.pushHistory();
            this.render();
            return loaded.image;
        }

        async setSourceUrl(src, metadata = {}) {
            this.revokeSourceUrl();
            this.sourceImage = await loadImageUrl(src);
            this.sourceObjectUrl = "";
            this.state.source.assetId = metadata.assetId || "";
            this.state.source.name = metadata.name || "Media Library image";
            this.centerImage({ preserveScale: false });
            this.pushHistory();
            this.render();
            return this.sourceImage;
        }

        revokeSourceUrl() {
            if (this.sourceObjectUrl) URL.revokeObjectURL(this.sourceObjectUrl);
            this.sourceObjectUrl = "";
        }

        centerImage(options = {}) {
            if (!this.sourceImage) return;
            if (!options.preserveScale) {
                this.state.source.scale = fitScale(this.state, this.sourceImage, this.state.fitMode);
            }
            const width = this.sourceImage.naturalWidth * this.state.source.scale;
            const height = this.sourceImage.naturalHeight * this.state.source.scale;
            this.state.source.x = Math.round((this.state.canvasWidth - width) / 2);
            this.state.source.y = Math.round((this.state.canvasHeight - height) / 2);
            if (!options.skipHistory) this.pushHistory();
            this.render();
        }

        resetImage() {
            this.centerImage({ preserveScale: false, skipHistory: true });
            this.state.source.flipped = false;
            this.pushHistory();
            this.render();
        }

        setFitMode(mode) {
            this.state.fitMode = mode === "fit" ? "fit" : "cover";
            this.centerImage({ preserveScale: false, skipHistory: true });
            this.pushHistory();
            this.render();
        }

        setSourceProperty(key, value, options = {}) {
            if (!Object.prototype.hasOwnProperty.call(this.state.source, key)) return;
            this.state.source[key] = value;
            if (!options.transient) this.pushHistory();
            this.render();
        }

        setLogoEnabled(enabled) {
            this.state.logo.enabled = Boolean(enabled);
            if (this.state.logo.enabled) this.positionLogo(this.state.logo.position || "bottom-right", { skipHistory: true });
            this.pushHistory();
            this.render();
        }

        setLogoProperty(key, value, options = {}) {
            if (!Object.prototype.hasOwnProperty.call(this.state.logo, key)) return;
            this.state.logo[key] = value;
            if (!options.transient) this.pushHistory();
            this.render();
        }

        positionLogo(position, options = {}) {
            const margin = Math.round(Math.min(this.state.canvasWidth, this.state.canvasHeight) * 0.04);
            const bounds = this.logoBounds({ atOrigin: true });
            const positions = {
                "top-left": { x: margin, y: margin },
                "top-right": { x: this.state.canvasWidth - bounds.width - margin, y: margin },
                "bottom-left": { x: margin, y: this.state.canvasHeight - bounds.height - margin },
                "bottom-right": {
                    x: this.state.canvasWidth - bounds.width - margin,
                    y: this.state.canvasHeight - bounds.height - margin
                }
            };
            const next = positions[position] || positions["bottom-right"];
            this.state.logo.position = position;
            this.state.logo.x = Math.round(next.x);
            this.state.logo.y = Math.round(next.y);
            if (!options.skipHistory) this.pushHistory();
            this.render();
        }

        logoBounds(options = {}) {
            const width = this.state.canvasWidth * Number(this.state.logo.scale || 0.16);
            const height = this.logoImage?.naturalWidth
                ? width * (this.logoImage.naturalHeight / this.logoImage.naturalWidth)
                : width;
            return {
                x: options.atOrigin ? 0 : this.state.logo.x,
                y: options.atOrigin ? 0 : this.state.logo.y,
                width,
                height
            };
        }

        pushHistory() {
            const snapshot = cloneEditorState(this.state);
            const last = this.history[this.history.length - 1];
            if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return;
            this.history.push(snapshot);
            if (this.history.length > HISTORY_LIMIT) this.history.shift();
            this.future = [];
        }

        undo() {
            if (this.history.length < 2) return false;
            const current = this.history.pop();
            this.future.push(current);
            this.state = cloneEditorState(this.history[this.history.length - 1]);
            this.resizeCanvas();
            this.render();
            return true;
        }

        redo() {
            const next = this.future.pop();
            if (!next) return false;
            this.state = cloneEditorState(next);
            this.history.push(cloneEditorState(next));
            this.resizeCanvas();
            this.render();
            return true;
        }

        loadState(editorState) {
            this.state = {
                ...this.createDefaultState(editorState),
                ...editorState,
                source: { ...this.createDefaultState(editorState).source, ...(editorState?.source || {}) },
                logo: { ...this.createDefaultState(editorState).logo, ...(editorState?.logo || {}) }
            };
            this.resizeCanvas();
            this.history = [cloneEditorState(this.state)];
            this.future = [];
            this.render();
        }

        getState() {
            return cloneEditorState(this.state);
        }

        render(options = {}) {
            const exportMode = Boolean(options.exportMode);
            this.ctx.clearRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
            this.drawTransparencyBackground();
            if (this.state.showGrid && !exportMode) this.drawGrid();
            this.drawSource();
            this.drawLogo();
            if (!exportMode && this.state.showSafeAreas) this.drawSafeAreas();
            if (this.empty) this.empty.hidden = Boolean(this.sourceImage);
        }

        drawTransparencyBackground() {
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

        drawSource() {
            if (!this.sourceImage) return;
            const source = this.state.source;
            const width = this.sourceImage.naturalWidth * source.scale;
            const height = this.sourceImage.naturalHeight * source.scale;

            this.ctx.save();
            if (source.flipped) {
                this.ctx.translate(source.x + width, source.y);
                this.ctx.scale(-1, 1);
                this.ctx.drawImage(this.sourceImage, 0, 0, width, height);
            } else {
                this.ctx.drawImage(this.sourceImage, source.x, source.y, width, height);
            }
            this.ctx.restore();
        }

        drawLogo() {
            if (!this.state.logo.enabled || !this.logoImage) return;
            const bounds = this.logoBounds();
            this.ctx.save();
            this.ctx.globalAlpha = Number(this.state.logo.opacity || 1);
            this.ctx.drawImage(this.logoImage, bounds.x, bounds.y, bounds.width, bounds.height);
            this.ctx.restore();
        }

        drawSafeAreas() {
            const preset = window.AZIEL_DESIGN_STUDIO_PRESETS?.getPreset(this.state.presetId) || { safeArea: 0.7 };
            const safe = Number(preset.safeArea || 0.7);
            const width = this.state.canvasWidth * safe;
            const height = this.state.canvasHeight * safe;
            const x = (this.state.canvasWidth - width) / 2;
            const y = (this.state.canvasHeight - height) / 2;

            this.ctx.save();
            this.ctx.strokeStyle = "rgba(168, 85, 247, .9)";
            this.ctx.lineWidth = Math.max(2, this.state.canvasWidth / 900);
            this.ctx.setLineDash([18, 12]);
            this.ctx.strokeRect(x, y, width, height);
            this.ctx.setLineDash([]);
            this.ctx.fillStyle = "rgba(168, 85, 247, .12)";
            this.ctx.fillRect(x, y, width, height);
            this.ctx.fillStyle = "rgba(255, 255, 255, .92)";
            this.ctx.font = `${Math.max(18, this.state.canvasWidth / 80)}px Inter, system-ui, sans-serif`;
            this.ctx.fillText("Safe area", x + 18, y + 34);
            this.ctx.restore();
        }

        drawGrid() {
            const gap = this.state.canvasWidth / 12;
            this.ctx.save();
            this.ctx.strokeStyle = "rgba(148, 163, 184, .18)";
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
