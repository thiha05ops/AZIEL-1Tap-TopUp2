(function () {
    const DB_NAME = "aziel-design-studio";
    const DB_VERSION = 1;
    const STORES = Object.freeze({
        projects: "projects",
        sourceAssets: "sourceAssets",
        preferences: "preferences"
    });
    const STORAGE_PREFIX = "aziel_design_studio_";
    const LAST_PROJECT_KEY = `${STORAGE_PREFIX}last_project_id`;
    const PANEL_STATE_KEY = `${STORAGE_PREFIX}panel_state`;
    const RECENT_PRESET_KEY = `${STORAGE_PREFIX}recent_preset`;
    const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;

    let dbPromise = null;

    function openDB() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise((resolve, reject) => {
            if (!("indexedDB" in window)) {
                reject(new Error("IndexedDB is unavailable in this browser."));
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORES.projects)) {
                    const projects = db.createObjectStore(STORES.projects, { keyPath: "id" });
                    projects.createIndex("updatedAt", "updatedAt");
                    projects.createIndex("archived", "archived");
                }
                if (!db.objectStoreNames.contains(STORES.sourceAssets)) {
                    db.createObjectStore(STORES.sourceAssets, { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains(STORES.preferences)) {
                    db.createObjectStore(STORES.preferences, { keyPath: "key" });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("IndexedDB open failed."));
        });

        return dbPromise;
    }

    async function withStore(storeName, mode, callback) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            let callbackResult;

            tx.oncomplete = () => resolve(callbackResult);
            tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
            tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted."));

            callbackResult = callback(store);
        });
    }

    function requestToPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
        });
    }

    function createId(prefix = "ds") {
        if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }

    async function saveProject(project) {
        const now = new Date().toISOString();
        const record = {
            ...project,
            id: project.id || createId("project"),
            schemaVersion: 1,
            updatedAt: now,
            createdAt: project.createdAt || now
        };

        await withStore(STORES.projects, "readwrite", store => {
            store.put(record);
        });

        localStorage.setItem(LAST_PROJECT_KEY, record.id);
        return record;
    }

    async function listProjects() {
        const projects = await withStore(STORES.projects, "readonly", store => requestToPromise(store.getAll()));
        return Array.isArray(projects)
            ? projects.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
            : [];
    }

    async function getProject(id) {
        if (!id) return null;
        return withStore(STORES.projects, "readonly", store => requestToPromise(store.get(id)));
    }

    async function deleteProject(id) {
        await withStore(STORES.projects, "readwrite", store => {
            store.delete(id);
        });
        if (localStorage.getItem(LAST_PROJECT_KEY) === id) localStorage.removeItem(LAST_PROJECT_KEY);
    }

    async function saveSourceAsset(asset) {
        const record = {
            ...asset,
            id: asset.id || createId("asset"),
            createdAt: asset.createdAt || new Date().toISOString()
        };
        await withStore(STORES.sourceAssets, "readwrite", store => {
            store.put(record);
        });
        return record;
    }

    async function getSourceAsset(id) {
        if (!id) return null;
        return withStore(STORES.sourceAssets, "readonly", store => requestToPromise(store.get(id)));
    }

    async function clearAll() {
        await Promise.all(Object.values(STORES).map(storeName => withStore(storeName, "readwrite", store => {
            store.clear();
        })));
        Object.keys(localStorage)
            .filter(key => key.startsWith(STORAGE_PREFIX))
            .forEach(key => localStorage.removeItem(key));
    }

    function getLocalSetting(key, fallback = null) {
        try {
            const value = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
            return value == null ? fallback : JSON.parse(value);
        } catch (error) {
            return fallback;
        }
    }

    function setLocalSetting(key, value) {
        localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
    }

    window.AZIEL_DESIGN_STUDIO_DRAFTS = {
        DB_NAME,
        DB_VERSION,
        STORES,
        STORAGE_PREFIX,
        LAST_PROJECT_KEY,
        PANEL_STATE_KEY,
        RECENT_PRESET_KEY,
        SETTINGS_KEY,
        openDB,
        createId,
        saveProject,
        listProjects,
        getProject,
        deleteProject,
        saveSourceAsset,
        getSourceAsset,
        clearAll,
        getLocalSetting,
        setLocalSetting
    };
})();
