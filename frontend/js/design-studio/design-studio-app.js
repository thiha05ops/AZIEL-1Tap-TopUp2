(function () {
    const MAX_SOURCE_FILE_SIZE = 5 * 1024 * 1024;
    const BOOT_SESSION_TIMEOUT_MS = 12000;
    const MEDIA_CATEGORIES = [
        "home_banner",
        "product_banner",
        "product_image",
        "campaign",
        "promotion",
        "announcement",
        "package_icon"
    ];

    const app = {
        canvas: null,
        currentProject: null,
        projects: [],
        projectFilter: "all",
        autosaveTimer: null,
        saveDebounce: null,
        dirty: false,
        initialized: false
    };

    const DRAWERS = {
        settings: {
            drawer: "#dsSettingsDrawer",
            bodyClass: "ds-settings-open",
            trigger: "#dsSettingsToggle",
            close: "#dsSettingsClose",
            onOpen: updateStorageStatus
        },
        projects: {
            drawer: "#dsProjectsDrawer",
            bodyClass: "ds-projects-open",
            trigger: "#dsProjectsToggle",
            close: "#dsProjectsClose"
        },
        media: {
            drawer: "#dsMediaDrawer",
            bodyClass: "ds-media-open",
            trigger: "#dsMediaToggle",
            close: "#dsMediaClose"
        }
    };

    function $(selector) {
        return document.querySelector(selector);
    }

    function toast(type, message) {
        const handler = window.AZIEL_UI?.toast?.[type] || window.AZIEL_UI?.toast;
        if (handler) handler(message);
    }

    function escapeHtml(value = "") {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");
    }

    function formatDateTime(value) {
        if (!value) return "Not saved yet";
        try {
            return new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short"
            }).format(new Date(value));
        } catch (error) {
            return String(value);
        }
    }

    function sanitizeFilename(value = "aziel-design") {
        return String(value)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 64) || "aziel-design";
    }

    function todayStamp() {
        const now = new Date();
        return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    }

    function activePreset() {
        const custom = {
            width: $("#dsCustomWidth")?.value,
            height: $("#dsCustomHeight")?.value,
            format: $("#dsExportFormat")?.value
        };
        return window.AZIEL_DESIGN_STUDIO_PRESETS.normalizePreset($("#dsPresetSelect")?.value || "open-graph", custom);
    }

    function makeNewProject(name = "Untitled design") {
        const preset = activePreset();
        return {
            id: window.AZIEL_DESIGN_STUDIO_DRAFTS.createId("project"),
            name,
            createdAt: new Date().toISOString(),
            updatedAt: "",
            schemaVersion: 1,
            canvasPresetId: preset.id,
            canvasWidth: preset.width,
            canvasHeight: preset.height,
            sourceMetadata: null,
            sourceAssetId: "",
            editorState: app.canvas?.createDefaultState(preset) || null,
            promptState: {
                remove: [],
                keep: ["main characters"],
                add: [],
                custom: "",
                generated: ""
            },
            exportSettings: {
                format: preset.format,
                quality: 0.86,
                category: "home_banner"
            },
            archived: false
        };
    }

    async function validateAdminSession() {
        if (!localStorage.getItem("adminToken")) {
            window.location.href = "/admin-login.html";
            return false;
        }

        let admin = null;
        try {
            admin = await withTimeout(
                window.AZIEL_ADMIN_AUTH?.loadMe?.(),
                BOOT_SESSION_TIMEOUT_MS,
                "Admin session check timed out."
            );
        } catch (error) {
            console.error("Design Studio admin session check failed.", error);
            toast("error", "Admin session could not be verified.");
            throw error;
        }

        const canRead = window.AZIEL_ADMIN_AUTH?.hasPermission?.("DESIGN_STUDIO_READ");

        if (!admin || !canRead) {
            toast("error", "Admin permission denied.");
            window.setTimeout(() => {
                window.location.href = "/admin.html";
            }, 800);
            return false;
        }

        return true;
    }

    function withTimeout(promise, timeoutMs, message) {
        return Promise.race([
            Promise.resolve(promise),
            new Promise((_, reject) => {
                window.setTimeout(() => reject(new Error(message)), timeoutMs);
            })
        ]);
    }

    async function init() {
        if (app.initialized) return;
        app.initialized = true;
        let bootFailed = false;

        try {
            setAuthGateMessage("Checking admin session...");
            const isAllowed = await validateAdminSession();
            if (!isAllowed) {
                hideAuthGate();
                return;
            }

            hideAuthGate();
            $("#designStudioApp").hidden = false;

            populatePresets();
            bindUI();
            applySettings(loadSettings());

            app.canvas = new window.AZIEL_DESIGN_STUDIO_CANVAS.DesignStudioCanvas({
                canvas: $("#dsCanvas"),
                frame: $("#dsCanvasFrame"),
                empty: $("#dsCanvasEmpty"),
                preset: activePreset(),
                onStateChange: (_state, options = {}) => {
                    syncControlsFromCanvas();
                    if (!options.transient) markDirty();
                }
            });

            await app.canvas.init();
            app.currentProject = makeNewProject();
            app.canvas.loadState(app.currentProject.editorState);
            await loadProjects();
            await recoverLastProject();
            updateProjectUI();
            updateStorageStatus();
        } catch (error) {
            bootFailed = true;
            console.error("Design Studio failed to initialize.", error);
            showBootError(error);
        } finally {
            if (!bootFailed) hideAuthGate();
        }
    }

    function setAuthGateMessage(message) {
        const gate = $("#designStudioAuthGate");
        const label = gate?.querySelector("span:last-child");
        if (label) label.textContent = message;
    }

    function hideAuthGate() {
        const gate = $("#designStudioAuthGate");
        if (gate) gate.remove();
    }

    function showBootError(error) {
        const appShell = $("#designStudioApp");
        const message = error?.message || "Design Studio could not start.";
        if (appShell) appShell.hidden = true;

        const gate = $("#designStudioAuthGate");
        if (!gate) {
            toast("error", message);
            return;
        }

        gate.hidden = false;
        gate.innerHTML = `
            <div class="design-studio-boot-error" role="alert">
                <strong>Design Studio could not start</strong>
                <span>${escapeHtml(message)}</span>
                <button class="ds-secondary-button" type="button" data-ds-retry-boot>Retry</button>
            </div>
        `;
        gate.querySelector("[data-ds-retry-boot]")?.addEventListener("click", () => {
            window.location.reload();
        });
    }

    function populatePresets() {
        const presetSelect = $("#dsPresetSelect");
        const defaultPreset = $("#dsDefaultPreset");
        const options = window.AZIEL_DESIGN_STUDIO_PRESETS.all.map(preset => (
            `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`
        )).join("");
        if (presetSelect) presetSelect.innerHTML = options;
        if (defaultPreset) defaultPreset.innerHTML = options;
        presetSelect.value = window.AZIEL_DESIGN_STUDIO_DRAFTS.getLocalSetting("recent_preset", "open-graph");
        defaultPreset.value = presetSelect.value;
        updatePresetMeta();
    }

    function bindUI() {
        $("#dsBackToAdmin")?.addEventListener("click", goBackToAdmin);
        $("#dsNewProject")?.addEventListener("click", createProject);
        $("#dsSaveProject")?.addEventListener("click", () => saveCurrentProject({ manual: true }));
        $("#dsProjectName")?.addEventListener("input", () => {
            if (!app.currentProject) return;
            app.currentProject.name = $("#dsProjectName").value.trim() || "Untitled design";
            markDirty();
            renderProjectList();
        });
        $("#dsDeviceImport")?.addEventListener("change", handleDeviceImport);
        document.querySelector("[data-ds-empty-import]")?.addEventListener("change", handleDeviceImport);
        document.querySelector("[data-ds-empty-media]")?.addEventListener("click", importFromMediaLibrary);
        $("#dsMediaLibraryImport")?.addEventListener("click", importFromMediaLibrary);
        $("#dsPresetSelect")?.addEventListener("change", handlePresetChange);
        $("#dsCustomWidth")?.addEventListener("change", handlePresetChange);
        $("#dsCustomHeight")?.addEventListener("change", handlePresetChange);
        $("#dsExportFormat")?.addEventListener("change", () => {
            if (app.currentProject) app.currentProject.exportSettings.format = $("#dsExportFormat").value;
            markDirty();
        });
        $("#dsExportQuality")?.addEventListener("input", () => {
            if (app.currentProject) app.currentProject.exportSettings.quality = Number($("#dsExportQuality").value || 0.86);
            markDirty();
        });
        $("#dsMediaCategory")?.addEventListener("change", () => {
            if (app.currentProject) app.currentProject.exportSettings.category = $("#dsMediaCategory").value;
            markDirty();
        });
        $("#dsExportDownload")?.addEventListener("click", downloadExport);
        $("#dsUploadExport")?.addEventListener("click", uploadExportToMediaLibrary);
        $("#dsUndo")?.addEventListener("click", () => {
            if (app.canvas.undo()) {
                syncControlsFromCanvas();
                markDirty();
            }
        });
        $("#dsRedo")?.addEventListener("click", () => {
            if (app.canvas.redo()) {
                syncControlsFromCanvas();
                markDirty();
            }
        });
        $("#dsResetImage")?.addEventListener("click", () => {
            app.canvas.resetImage();
            markDirty();
        });
        $("#dsCenterImage")?.addEventListener("click", () => {
            app.canvas.centerImage();
            markDirty();
        });
        $("#dsFlipImage")?.addEventListener("click", () => {
            app.canvas.setSourceProperty("flipped", !app.canvas.state.source.flipped);
            markDirty();
        });
        $("#dsSafeAreasToggle")?.addEventListener("change", event => {
            app.canvas.state.showSafeAreas = event.target.checked;
            app.canvas.render();
            markDirty();
        });
        $("#dsShowGrid")?.addEventListener("change", event => {
            app.canvas.state.showGrid = event.target.checked;
            app.canvas.render();
            markDirty();
        });
        $("#dsImageScale")?.addEventListener("input", event => {
            app.canvas.setSourceProperty("scale", Number(event.target.value), { transient: true });
            markDirty({ debounceOnly: true });
        });
        $("#dsImageScale")?.addEventListener("change", () => app.canvas.pushHistory());
        $("#dsImageX")?.addEventListener("change", event => app.canvas.setSourceProperty("x", Number(event.target.value || 0)));
        $("#dsImageY")?.addEventListener("change", event => app.canvas.setSourceProperty("y", Number(event.target.value || 0)));
        $("#dsToggleLogo")?.addEventListener("click", () => {
            app.canvas.setLogoEnabled(!app.canvas.state.logo.enabled);
            syncControlsFromCanvas();
            markDirty();
        });
        $("#dsLogoScale")?.addEventListener("input", event => {
            app.canvas.setLogoProperty("scale", Number(event.target.value), { transient: true });
            markDirty({ debounceOnly: true });
        });
        $("#dsLogoScale")?.addEventListener("change", () => app.canvas.pushHistory());
        $("#dsLogoOpacity")?.addEventListener("input", event => {
            app.canvas.setLogoProperty("opacity", Number(event.target.value), { transient: true });
            markDirty({ debounceOnly: true });
        });
        $("#dsLogoOpacity")?.addEventListener("change", () => app.canvas.pushHistory());
        $("#dsResetLogo")?.addEventListener("click", () => {
            const settings = loadSettings();
            app.canvas.positionLogo(settings.defaultLogoPosition || "bottom-right");
            app.canvas.setLogoProperty("scale", Number(settings.defaultLogoSize || 0.16));
            app.canvas.setLogoProperty("opacity", 0.92);
            syncControlsFromCanvas();
            markDirty();
        });
        document.querySelectorAll("[data-ds-logo-position]").forEach(button => {
            button.addEventListener("click", () => {
                app.canvas.positionLogo(button.dataset.dsLogoPosition);
                markDirty();
            });
        });
        document.querySelectorAll("[data-ds-fit]").forEach(button => {
            button.addEventListener("click", () => {
                document.querySelectorAll("[data-ds-fit]").forEach(item => item.classList.toggle("active", item === button));
                app.canvas.setFitMode(button.dataset.dsFit);
                markDirty();
            });
        });
        document.querySelectorAll("[data-ds-project-filter]").forEach(button => {
            button.addEventListener("click", () => {
                app.projectFilter = button.dataset.dsProjectFilter;
                document.querySelectorAll("[data-ds-project-filter]").forEach(item => item.classList.toggle("active", item === button));
                renderProjectList();
            });
        });
        $("#dsProjectsToggle")?.addEventListener("click", openProjectsDrawer);
        $("#dsProjectsClose")?.addEventListener("click", closeProjectsDrawer);
        $("#dsMediaToggle")?.addEventListener("click", openMediaDrawer);
        $("#dsMediaClose")?.addEventListener("click", closeMediaDrawer);
        $("#dsPropertiesToggle")?.addEventListener("click", () => document.body.classList.toggle("ds-properties-open"));
        $("#dsSettingsToggle")?.addEventListener("click", openSettings);
        $("#dsSettingsClose")?.addEventListener("click", closeSettings);
        document.querySelectorAll(".ds-drawer").forEach(drawer => {
            drawer.addEventListener("click", event => {
                if (event.target !== drawer) return;
                closeDrawerByElement(drawer);
            });
        });
        $("#dsClearLocalData")?.addEventListener("click", clearLocalData);
        $("#dsGeneratePrompt")?.addEventListener("click", generatePrompt);
        $("#dsCopyPrompt")?.addEventListener("click", copyPrompt);
        $("#dsPromptComposition")?.addEventListener("change", () => {
            generatePrompt({ silent: true });
            markDirty();
        });
        $("#dsPromptCustom")?.addEventListener("input", () => {
            generatePrompt({ silent: true });
            markDirty();
        });
        document.querySelectorAll("[data-ds-prompt-remove], [data-ds-prompt-keep], [data-ds-prompt-add]").forEach(input => {
            input.addEventListener("change", () => {
                generatePrompt({ silent: true });
                markDirty();
            });
        });
        $("#dsThemeMode")?.addEventListener("change", saveSettingsFromUI);
        $("#dsAutosaveEnabled")?.addEventListener("change", saveSettingsFromUI);
        $("#dsAutosaveInterval")?.addEventListener("change", saveSettingsFromUI);
        $("#dsConfirmDestructive")?.addEventListener("change", saveSettingsFromUI);
        $("#dsDefaultPreset")?.addEventListener("change", saveSettingsFromUI);
        $("#dsDefaultFormat")?.addEventListener("change", saveSettingsFromUI);
        $("#dsFilenamePattern")?.addEventListener("change", saveSettingsFromUI);
        $("#dsSaveDestination")?.addEventListener("change", saveSettingsFromUI);
        $("#dsPerformanceMode")?.addEventListener("change", saveSettingsFromUI);
        $("#dsDefaultLogoVariant")?.addEventListener("change", saveSettingsFromUI);
        $("#dsDefaultLogoPosition")?.addEventListener("change", saveSettingsFromUI);
        $("#dsDefaultLogoSize")?.addEventListener("change", saveSettingsFromUI);
        document.addEventListener("keydown", handleShortcuts);
    }

    function goBackToAdmin() {
        if (document.referrer && new URL(document.referrer, window.location.origin).pathname.endsWith("/admin.html")) {
            window.location.href = document.referrer;
            return;
        }
        window.location.href = "/admin.html";
    }

    async function recoverLastProject() {
        const lastId = localStorage.getItem(window.AZIEL_DESIGN_STUDIO_DRAFTS.LAST_PROJECT_KEY);
        if (!lastId) return;
        const project = await window.AZIEL_DESIGN_STUDIO_DRAFTS.getProject(lastId).catch(() => null);
        if (!project) return;
        await openProject(project.id, { silent: true });
        toast("success", "Draft restored.");
    }

    async function loadProjects() {
        app.projects = await window.AZIEL_DESIGN_STUDIO_DRAFTS.listProjects().catch(error => {
            toast("error", error.message || "Local projects unavailable.");
            return [];
        });
        renderProjectList();
    }

    function filteredProjects() {
        if (app.projectFilter === "archived") return app.projects.filter(project => project.archived);
        if (app.projectFilter === "drafts") return app.projects.filter(project => !project.archived);
        if (app.projectFilter === "recent") return app.projects.slice(0, 8);
        return app.projects.filter(project => !project.archived);
    }

    function renderProjectList() {
        const list = $("#dsProjectList");
        if (!list) return;
        const projects = filteredProjects();
        if (!projects.length) {
            list.innerHTML = `<p class="admin-empty-state">No local projects yet.</p>`;
            return;
        }

        list.innerHTML = projects.map(project => `
            <article class="ds-project-item ${project.id === app.currentProject?.id ? "active" : ""}" data-ds-project-id="${escapeHtml(project.id)}">
                <strong>${escapeHtml(project.name || "Untitled design")}</strong>
                <small>${escapeHtml(formatDateTime(project.updatedAt || project.createdAt))}</small>
                <div class="ds-project-actions">
                    <button class="ds-mini-button" type="button" data-ds-open-project="${escapeHtml(project.id)}">Open</button>
                    <button class="ds-mini-button" type="button" data-ds-duplicate-project="${escapeHtml(project.id)}">Duplicate</button>
                    <button class="ds-mini-button" type="button" data-ds-archive-project="${escapeHtml(project.id)}">${project.archived ? "Restore" : "Archive"}</button>
                    <button class="ds-mini-button" type="button" data-ds-delete-project="${escapeHtml(project.id)}">Delete</button>
                </div>
            </article>
        `).join("");

        list.querySelectorAll("[data-ds-open-project]").forEach(button => {
            button.addEventListener("click", () => openProject(button.dataset.dsOpenProject));
        });
        list.querySelectorAll("[data-ds-duplicate-project]").forEach(button => {
            button.addEventListener("click", () => duplicateProject(button.dataset.dsDuplicateProject));
        });
        list.querySelectorAll("[data-ds-delete-project]").forEach(button => {
            button.addEventListener("click", () => deleteProject(button.dataset.dsDeleteProject));
        });
        list.querySelectorAll("[data-ds-archive-project]").forEach(button => {
            button.addEventListener("click", () => toggleProjectArchive(button.dataset.dsArchiveProject));
        });
    }

    async function createProject() {
        if (app.dirty) await saveCurrentProject();
        app.currentProject = makeNewProject(`Untitled design ${app.projects.length + 1}`);
        app.canvas.loadState(app.currentProject.editorState);
        updateProjectUI();
        markDirty();
        await saveCurrentProject();
        await loadProjects();
        toast("success", "Project created.");
    }

    async function openProject(id, options = {}) {
        const project = await window.AZIEL_DESIGN_STUDIO_DRAFTS.getProject(id);
        if (!project) return;
        if (app.dirty && !options.silent) await saveCurrentProject();
        app.currentProject = project;
        app.canvas.loadState(project.editorState);
        await restoreProjectSource(project);
        updateProjectUI();
        app.dirty = false;
        if (!options.silent) toast("success", "Project opened.");
    }

    async function restoreProjectSource(project) {
        if (project.sourceAssetId) {
            const asset = await window.AZIEL_DESIGN_STUDIO_DRAFTS.getSourceAsset(project.sourceAssetId).catch(() => null);
            if (asset?.blob) {
                await app.canvas.setSourceBlob(asset.blob, project.sourceMetadata || {});
                app.canvas.loadState(project.editorState);
                return;
            }
        }

        const url = project.sourceMetadata?.url || project.sourceMetadata?.secureUrl;
        if (url) {
            await app.canvas.setSourceUrl(url, project.sourceMetadata).catch(() => {
                toast("warning", "Managed source image could not be restored.");
            });
            app.canvas.loadState(project.editorState);
        }
    }

    async function duplicateProject(id) {
        const project = await window.AZIEL_DESIGN_STUDIO_DRAFTS.getProject(id);
        if (!project) return;
        const copy = {
            ...project,
            id: window.AZIEL_DESIGN_STUDIO_DRAFTS.createId("project"),
            name: `${project.name || "Untitled design"} copy`,
            createdAt: new Date().toISOString(),
            updatedAt: ""
        };
        await window.AZIEL_DESIGN_STUDIO_DRAFTS.saveProject(copy);
        await loadProjects();
        toast("success", "Project duplicated.");
    }

    async function deleteProject(id) {
        const settings = loadSettings();
        const confirmed = !settings.confirmDestructive || await window.AZIEL_UI?.confirm?.({
            title: "Delete project",
            message: "Delete this local Design Studio project?",
            confirmText: "Delete",
            cancelText: "Cancel",
            danger: true
        });
        if (!confirmed) return;
        await window.AZIEL_DESIGN_STUDIO_DRAFTS.deleteProject(id);
        if (app.currentProject?.id === id) {
            app.currentProject = makeNewProject();
            app.canvas.loadState(app.currentProject.editorState);
            updateProjectUI();
        }
        await loadProjects();
        toast("success", "Project deleted.");
    }

    async function toggleProjectArchive(id) {
        const project = await window.AZIEL_DESIGN_STUDIO_DRAFTS.getProject(id);
        if (!project) return;
        project.archived = !project.archived;
        await window.AZIEL_DESIGN_STUDIO_DRAFTS.saveProject(project);
        await loadProjects();
        toast("success", project.archived ? "Project archived." : "Project restored.");
    }

    async function saveCurrentProject(options = {}) {
        if (!app.currentProject || !app.canvas) return null;
        const project = {
            ...app.currentProject,
            name: $("#dsProjectName")?.value.trim() || app.currentProject.name || "Untitled design",
            canvasPresetId: app.canvas.state.presetId,
            canvasWidth: app.canvas.state.canvasWidth,
            canvasHeight: app.canvas.state.canvasHeight,
            editorState: app.canvas.getState(),
            promptState: collectPromptState(),
            exportSettings: {
                format: $("#dsExportFormat")?.value || "image/webp",
                quality: Number($("#dsExportQuality")?.value || 0.86),
                category: $("#dsMediaCategory")?.value || "home_banner"
            }
        };

        try {
            app.currentProject = await window.AZIEL_DESIGN_STUDIO_DRAFTS.saveProject(project);
            app.dirty = false;
            $("#dsSaveStatus").textContent = `Saved ${formatDateTime(app.currentProject.updatedAt)}`;
            await loadProjects();
            if (options.manual) toast("success", "Local draft saved.");
            return app.currentProject;
        } catch (error) {
            toast("error", error?.name === "QuotaExceededError" ? "Local storage quota exceeded." : "Draft save failed.");
            return null;
        }
    }

    function markDirty(options = {}) {
        app.dirty = true;
        $("#dsSaveStatus").textContent = "Unsaved changes";
        if (!options.debounceOnly) syncProjectFromUI();
        const settings = loadSettings();
        if (!settings.autosaveEnabled) return;
        window.clearTimeout(app.saveDebounce);
        app.saveDebounce = window.setTimeout(() => saveCurrentProject(), Number(settings.autosaveInterval || 12) * 1000);
    }

    function syncProjectFromUI() {
        if (!app.currentProject || !app.canvas) return;
        app.currentProject.editorState = app.canvas.getState();
        app.currentProject.promptState = collectPromptState();
    }

    async function handleDeviceImport(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            toast("error", "Unsupported image format. Use JPEG, PNG, or WebP.");
            return;
        }
        if (file.size > MAX_SOURCE_FILE_SIZE) {
            toast("error", "Source image is larger than the 5 MB Phase 1 limit.");
            return;
        }

        try {
            $("#dsStatusText").textContent = "Loading image...";
            await app.canvas.setSourceBlob(file, { name: file.name, originalName: file.name, size: file.size });
            const sourceAsset = await window.AZIEL_DESIGN_STUDIO_DRAFTS.saveSourceAsset({
                blob: file,
                name: file.name,
                mimeType: file.type,
                size: file.size
            });
            app.currentProject.sourceAssetId = sourceAsset.id;
            app.currentProject.sourceMetadata = { name: file.name, originalName: file.name, size: file.size, mimeType: file.type };
            if ((app.canvas.sourceImage.naturalWidth * app.canvas.sourceImage.naturalHeight) > 40000000) {
                toast("warning", "Large source dimensions may export slowly on mobile.");
            }
            syncControlsFromCanvas();
            markDirty();
            toast("success", "Image imported.");
        } catch (error) {
            toast("error", error.message || "Image decode failed.");
        } finally {
            $("#dsStatusText").textContent = "Ready";
        }
    }

    async function importFromMediaLibrary() {
        if (!window.AZIEL_ADMIN_MEDIA_SELECTOR?.open) {
            toast("error", "Media Library selector unavailable.");
            return;
        }

        const asset = await window.AZIEL_ADMIN_MEDIA_SELECTOR.open({ categories: MEDIA_CATEGORIES });
        if (!asset) return;
        const src = asset.secureUrl || asset.url;
        if (!src) {
            toast("error", "Selected media asset has no image URL.");
            return;
        }

        try {
            $("#dsStatusText").textContent = "Loading managed media...";
            await app.canvas.setSourceUrl(src, asset);
            app.currentProject.sourceAssetId = "";
            app.currentProject.sourceMetadata = {
                assetId: asset.assetId,
                name: asset.name,
                category: asset.category,
                url: asset.url,
                secureUrl: asset.secureUrl,
                size: asset.sizeBytes
            };
            syncControlsFromCanvas();
            markDirty();
            toast("success", "Media Library image imported.");
        } catch (error) {
            toast("error", "Managed image could not be loaded.");
        } finally {
            $("#dsStatusText").textContent = "Ready";
        }
    }

    function handlePresetChange() {
        const preset = activePreset();
        $("#dsCustomPresetFields").hidden = preset.id !== "custom";
        window.AZIEL_DESIGN_STUDIO_DRAFTS.setLocalSetting("recent_preset", preset.id);
        $("#dsExportFormat").value = preset.format;
        app.canvas.setPreset(preset);
        updatePresetMeta();
        syncControlsFromCanvas();
        markDirty();
    }

    function updatePresetMeta() {
        const preset = activePreset();
        const meta = $("#dsPresetMeta");
        if (!meta) return;
        meta.innerHTML = `
            <span>${preset.width} x ${preset.height}</span>
            <span>Ratio ${window.AZIEL_DESIGN_STUDIO_PRESETS.aspectRatioLabel(preset)}</span>
            <span>Format ${preset.format.replace("image/", "").toUpperCase()}</span>
            <span>Safe area ${Math.round(Number(preset.safeArea || 0.7) * 100)}%</span>
            <span>${escapeHtml(preset.destination || "")}</span>
            ${preset.warning ? `<span>${escapeHtml(preset.warning)}</span>` : ""}
        `;
        $("#dsCanvasStatus").textContent = `${preset.width} x ${preset.height}`;
        $("#dsPresetStatus").textContent = preset.name;
    }

    function syncControlsFromCanvas() {
        const state = app.canvas?.state;
        if (!state) return;
        $("#dsImageScale").value = state.source.scale || 1;
        $("#dsImageX").value = Math.round(state.source.x || 0);
        $("#dsImageY").value = Math.round(state.source.y || 0);
        $("#dsLogoScale").value = state.logo.scale || 0.16;
        $("#dsLogoOpacity").value = state.logo.opacity || 0.92;
        $("#dsSafeAreasToggle").checked = Boolean(state.showSafeAreas);
        $("#dsShowGrid").checked = Boolean(state.showGrid);
        $("#dsToggleLogo").textContent = state.logo.enabled ? "Remove" : "Add";
        $("#dsSourceMeta").textContent = state.source.name || "No image selected";
        $("#dsLogoMeta").textContent = state.logo.enabled ? "Logo visible" : "Optional brand layer";
        $("#dsSelectionStatus").textContent = state.logo.enabled ? "Image + Logo" : "Image";
    }

    function updateProjectUI() {
        if (!app.currentProject) return;
        $("#dsProjectName").value = app.currentProject.name || "Untitled design";
        $("#dsPresetSelect").value = app.currentProject.canvasPresetId || app.canvas?.state?.presetId || "open-graph";
        $("#dsExportFormat").value = app.currentProject.exportSettings?.format || activePreset().format;
        $("#dsExportQuality").value = app.currentProject.exportSettings?.quality || 0.86;
        $("#dsMediaCategory").value = app.currentProject.exportSettings?.category || "home_banner";
        restorePromptState(app.currentProject.promptState);
        updatePresetMeta();
        syncControlsFromCanvas();
        $("#dsSaveStatus").textContent = app.currentProject.updatedAt
            ? `Saved ${formatDateTime(app.currentProject.updatedAt)}`
            : "Not saved yet";
    }

    function collectPromptState() {
        const remove = [...document.querySelectorAll("[data-ds-prompt-remove]:checked")].map(input => input.dataset.dsPromptRemove);
        const keep = [...document.querySelectorAll("[data-ds-prompt-keep]:checked")].map(input => input.dataset.dsPromptKeep);
        const add = [...document.querySelectorAll("[data-ds-prompt-add]:checked")].map(input => input.dataset.dsPromptAdd);
        return {
            remove,
            keep,
            add,
            composition: $("#dsPromptComposition")?.value || "Keep original",
            custom: $("#dsPromptCustom")?.value || "",
            generated: $("#dsGeneratedPrompt")?.value || ""
        };
    }

    function restorePromptState(promptState = {}) {
        document.querySelectorAll("[data-ds-prompt-remove]").forEach(input => {
            input.checked = (promptState.remove || []).includes(input.dataset.dsPromptRemove);
        });
        document.querySelectorAll("[data-ds-prompt-keep]").forEach(input => {
            input.checked = (promptState.keep || []).includes(input.dataset.dsPromptKeep);
        });
        document.querySelectorAll("[data-ds-prompt-add]").forEach(input => {
            input.checked = (promptState.add || []).includes(input.dataset.dsPromptAdd);
        });
        $("#dsPromptComposition").value = promptState.composition || "Keep original";
        $("#dsPromptCustom").value = promptState.custom || "";
        $("#dsGeneratedPrompt").value = promptState.generated || "";
    }

    function generatePrompt(options = {}) {
        const preset = activePreset();
        const promptState = collectPromptState();
        const lines = [
            "Edit the supplied reference image for AZIEL 1Tap Shop marketing artwork.",
            `Output size: ${preset.width} x ${preset.height}.`,
            `Format target: ${preset.format.replace("image/", "").toUpperCase()}.`,
            `Destination: ${preset.destination}.`,
            `Safe-area requirement: keep important subjects inside the central ${Math.round(preset.safeArea * 100)}%.`,
            promptState.remove.length ? `Remove: ${promptState.remove.join(", ")}.` : "Remove: no additional removal requested.",
            promptState.keep.length ? `Keep: ${promptState.keep.join(", ")}.` : "Keep: preserve useful subject identity and composition.",
            promptState.add.length ? `Add: ${promptState.add.join(", ")}.` : "Add: no additional elements unless necessary.",
            `Composition: ${promptState.composition || "Keep original"}.`,
            "Do not add unwanted text, logos, buttons, QR codes, watermarks, or UI chrome.",
            promptState.custom ? `Additional note: ${promptState.custom}` : ""
        ].filter(Boolean);
        $("#dsGeneratedPrompt").value = lines.join("\n");
        if (app.currentProject) app.currentProject.promptState = collectPromptState();
        if (!options.silent) toast("success", "Prompt generated.");
    }

    async function copyPrompt() {
        const value = $("#dsGeneratedPrompt")?.value || "";
        if (!value) generatePrompt({ silent: true });
        await navigator.clipboard.writeText($("#dsGeneratedPrompt").value);
        toast("success", "Prompt copied.");
    }

    async function downloadExport() {
        try {
            window.AZIEL_UI?.button?.setLoading($("#dsExportDownload"), { text: "Exporting" });
            const blob = await app.canvas.exportBlob($("#dsExportFormat").value, Number($("#dsExportQuality").value || 0.86));
            const url = URL.createObjectURL(blob);
            const extension = mimeExtension(blob.type);
            const slot = activePreset().id.replace(/-/g, "-");
            const filename = `${slot}-${sanitizeFilename($("#dsProjectName").value)}-${todayStamp()}-v01.${extension}`;
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast("success", "Export downloaded.");
        } catch (error) {
            toast("error", error.message || "Export failed.");
        } finally {
            window.AZIEL_UI?.button?.reset($("#dsExportDownload"));
        }
    }

    async function uploadExportToMediaLibrary() {
        if (!window.AZIEL_ADMIN_AUTH?.hasPermission?.("MEDIA_MANAGE")) {
            toast("error", "Media Library upload permission required.");
            return;
        }

        try {
            window.AZIEL_UI?.button?.setLoading($("#dsUploadExport"), { text: "Uploading" });
            const type = $("#dsExportFormat").value;
            const blob = await app.canvas.exportBlob(type, Number($("#dsExportQuality").value || 0.86));
            const extension = mimeExtension(type);
            const filename = `${sanitizeFilename($("#dsProjectName").value)}-${todayStamp()}-v01.${extension}`;
            const file = new File([blob], filename, { type });
            const formData = new FormData();
            formData.set("name", $("#dsProjectName").value || "Design Studio export");
            formData.set("category", $("#dsMediaCategory").value || "home_banner");
            formData.set("altText", `${$("#dsProjectName").value || "AZIEL"} design export`);
            formData.set("file", file);

            const data = await adminFetch("/api/admin/media", {
                method: "POST",
                body: formData
            });

            if (!data?.success) {
                toast("error", data?.message || "Media upload failed.");
                return;
            }

            toast("success", `Media asset saved: ${data.asset?.name || data.asset?.assetId || "created"}`);
        } catch (error) {
            toast("error", error.message || "Media upload failed.");
        } finally {
            window.AZIEL_UI?.button?.reset($("#dsUploadExport"));
        }
    }

    function mimeExtension(type) {
        if (type === "image/png") return "png";
        if (type === "image/jpeg") return "jpg";
        return "webp";
    }

    function openSettings() {
        openDrawer("settings");
    }

    function closeSettings(options = {}) {
        closeDrawer("settings", options);
    }

    function openProjectsDrawer() {
        openDrawer("projects");
    }

    function closeProjectsDrawer(options = {}) {
        closeDrawer("projects", options);
    }

    function openMediaDrawer() {
        openDrawer("media");
    }

    function closeMediaDrawer(options = {}) {
        closeDrawer("media", options);
    }

    function openDrawer(name) {
        const config = DRAWERS[name];
        const drawer = $(config?.drawer);
        if (!config || !drawer) return;
        closeAllDrawers({ except: name, restoreFocus: false });
        drawer.hidden = false;
        document.body.classList.add(config.bodyClass);
        $(config.close)?.focus();
        config.onOpen?.();
    }

    function closeDrawer(name, options = {}) {
        const config = DRAWERS[name];
        const drawer = $(config?.drawer);
        if (!config || !drawer || drawer.hidden) return;
        drawer.hidden = true;
        document.body.classList.remove(config.bodyClass);
        if (options.restoreFocus !== false) $(config.trigger)?.focus();
    }

    function closeAllDrawers(options = {}) {
        Object.keys(DRAWERS).forEach(name => {
            if (name === options.except) return;
            closeDrawer(name, { restoreFocus: options.restoreFocus });
        });
    }

    function closeDrawerByElement(drawer) {
        const match = Object.entries(DRAWERS).find(([, config]) => $(config.drawer) === drawer);
        if (!match) return;
        closeDrawer(match[0]);
    }

    function loadSettings() {
        return {
            themeMode: "system",
            autosaveEnabled: true,
            autosaveInterval: 12,
            confirmDestructive: true,
            defaultPreset: "open-graph",
            defaultFormat: "image/webp",
            filenamePattern: "{slot}-{project}-{date}-v01",
            saveDestination: "ask",
            performanceMode: false,
            defaultLogoVariant: "official",
            defaultLogoPosition: "bottom-right",
            defaultLogoSize: 0.16,
            ...window.AZIEL_DESIGN_STUDIO_DRAFTS.getLocalSetting("settings", {})
        };
    }

    function applySettings(settings) {
        $("#dsThemeMode").value = settings.themeMode;
        $("#dsAutosaveEnabled").checked = Boolean(settings.autosaveEnabled);
        $("#dsAutosaveInterval").value = settings.autosaveInterval;
        $("#dsConfirmDestructive").checked = Boolean(settings.confirmDestructive);
        $("#dsDefaultPreset").value = settings.defaultPreset;
        $("#dsDefaultFormat").value = settings.defaultFormat;
        $("#dsFilenamePattern").value = settings.filenamePattern;
        $("#dsSaveDestination").value = settings.saveDestination;
        $("#dsPerformanceMode").checked = Boolean(settings.performanceMode);
        $("#dsDefaultLogoVariant").value = settings.defaultLogoVariant;
        $("#dsDefaultLogoPosition").value = settings.defaultLogoPosition;
        $("#dsDefaultLogoSize").value = settings.defaultLogoSize;
        applyThemePreference(settings.themeMode);
    }

    function saveSettingsFromUI() {
        const settings = {
            themeMode: $("#dsThemeMode").value,
            autosaveEnabled: $("#dsAutosaveEnabled").checked,
            autosaveInterval: Math.min(120, Math.max(5, Number($("#dsAutosaveInterval").value || 12))),
            confirmDestructive: $("#dsConfirmDestructive").checked,
            defaultPreset: $("#dsDefaultPreset").value,
            defaultFormat: $("#dsDefaultFormat").value,
            filenamePattern: $("#dsFilenamePattern").value,
            saveDestination: $("#dsSaveDestination").value,
            performanceMode: $("#dsPerformanceMode").checked,
            defaultLogoVariant: $("#dsDefaultLogoVariant").value,
            defaultLogoPosition: $("#dsDefaultLogoPosition").value,
            defaultLogoSize: Number($("#dsDefaultLogoSize").value || 0.16)
        };
        window.AZIEL_DESIGN_STUDIO_DRAFTS.setLocalSetting("settings", settings);
        applyThemePreference(settings.themeMode);
    }

    function applyThemePreference(mode) {
        if (mode === "system") {
            window.AZIEL?.applyTheme?.();
            $("#dsThemeStatus").textContent = "System";
            return;
        }
        document.body.classList.toggle("theme-dark", mode === "dark");
        document.documentElement.classList.toggle("theme-dark", mode === "dark");
        document.body.classList.toggle("theme-light", mode === "light");
        document.documentElement.classList.toggle("theme-light", mode === "light");
        document.body.dataset.theme = mode;
        document.documentElement.dataset.theme = mode;
        $("#dsThemeStatus").textContent = mode === "light" ? "Light" : "Dark";
    }

    async function updateStorageStatus() {
        try {
            await window.AZIEL_DESIGN_STUDIO_DRAFTS.openDB();
            $("#dsStorageStatus").textContent = "IndexedDB status: available";
            $("#dsStorageStatusInline").textContent = "Ready";
        } catch (error) {
            $("#dsStorageStatus").textContent = `IndexedDB status: unavailable (${error.message})`;
            $("#dsStorageStatusInline").textContent = "Unavailable";
        }
        const projects = await window.AZIEL_DESIGN_STUDIO_DRAFTS.listProjects().catch(() => []);
        $("#dsProjectCount").textContent = `Local project count: ${projects.length}`;
    }

    async function clearLocalData() {
        const confirmed = await window.AZIEL_UI?.confirm?.({
            title: "Clear local data",
            message: "Clear only local Design Studio projects, assets, and preferences?",
            confirmText: "Clear",
            cancelText: "Cancel",
            danger: true
        });
        if (!confirmed) return;
        await window.AZIEL_DESIGN_STUDIO_DRAFTS.clearAll();
        app.projects = [];
        app.currentProject = makeNewProject();
        app.canvas.loadState(app.currentProject.editorState);
        renderProjectList();
        updateProjectUI();
        updateStorageStatus();
        toast("success", "Local Design Studio data cleared.");
    }

    function handleShortcuts(event) {
        const target = event.target;
        const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName);
        if (event.key === "Escape") {
            closeAllDrawers();
            document.body.classList.remove("ds-properties-open");
            return;
        }
        if (isTyping) return;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            saveCurrentProject({ manual: true });
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            if (event.shiftKey) {
                app.canvas.redo();
            } else {
                app.canvas.undo();
            }
            syncControlsFromCanvas();
            markDirty();
        }
    }

    document.addEventListener("DOMContentLoaded", init);
})();
