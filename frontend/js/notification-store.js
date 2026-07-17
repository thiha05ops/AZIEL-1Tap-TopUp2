// frontend/js/notification-store.js
// AZIEL V2.5 Enterprise Notification Store

(function () {
    if (window.AZIEL_NOTIFICATIONS) return;

    const state = {
        initialized: false,
        loading: false,
        error: "",
        notifications: [],
        unreadCount: 0,
        pagination: {
            limit: 20,
            hasMore: false,
            nextCursor: ""
        },
        filter: "all"
    };

    const subscribers = new Set();
    const ids = new Set();

    function apiUrl(path) {
        if (window.AZIEL?.apiUrl) return window.AZIEL.apiUrl(path);
        return `${location.port === "5500" ? `${location.protocol}//${location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost"}:3000` : ""}${path}`;
    }

    function authHeaders(extra = {}) {
        return window.AZIEL?.authHeaders?.(extra) || extra;
    }

    function notify() {
        const snapshot = getState();
        subscribers.forEach(fn => {
            try {
                fn(snapshot);
            } catch (error) {
                console.log("Notification subscriber error:", error);
            }
        });

        window.dispatchEvent(new CustomEvent("aziel:notificationsChanged", {
            detail: snapshot
        }));
    }

    function normalize(raw = {}) {
        const source = raw.notification || raw;
        const id = String(source.id || source._id || "");

        return {
            id,
            _id: id,
            type: source.type || "general",
            category: source.category || "system",
            title: source.title || "Notification",
            message: source.message || "",
            status: source.status || "active",
            read: Boolean(source.read || source.isRead),
            isRead: Boolean(source.read || source.isRead),
            createdAt: source.createdAt || new Date().toISOString(),
            updatedAt: source.updatedAt || source.createdAt || new Date().toISOString(),
            action: source.action || null,
            metadata: source.metadata || {},
            orderId: source.orderId || source.metadata?.orderId || ""
        };
    }

    function mergeNotification(raw, position = "prepend") {
        const notification = normalize(raw);
        if (!notification.id) return { added: false, notification: null };

        const existingIndex = state.notifications.findIndex(item => item.id === notification.id);

        if (existingIndex >= 0) {
            state.notifications[existingIndex] = {
                ...state.notifications[existingIndex],
                ...notification
            };
            return {
                added: false,
                notification: state.notifications[existingIndex]
            };
        }

        ids.add(notification.id);

        if (position === "append") {
            state.notifications.push(notification);
        } else {
            state.notifications.unshift(notification);
        }

        return { added: true, notification };
    }

    async function load(options = {}) {
        if (state.loading && !options.force) return getState();

        state.loading = true;
        state.error = "";
        notify();

        try {
            const limit = options.limit || state.pagination.limit || 20;
            const filter = options.filter || state.filter || "all";
            const params = new URLSearchParams({ limit: String(limit) });

            if (filter === "promotions") params.set("category", "promotions");
            if (filter === "unread") params.set("unread", "true");

            const url = apiUrl(`/api/notifications?${params.toString()}`);
            const res = await fetch(url, { headers: authHeaders() });
            const data = await res.json();

            if (!data.success) {
                throw new Error(data.message || "Failed to load notifications");
            }

            state.notifications = [];
            ids.clear();
            state.filter = filter;
            (data.notifications || []).forEach(item => mergeNotification(item, "append"));
            state.unreadCount = Number(data.unreadCount || 0);
            state.pagination = data.pagination || {
                limit,
                hasMore: false,
                nextCursor: ""
            };
            state.initialized = true;
        } catch (error) {
            state.error = error.message || "Failed to load notifications";
            console.log("Notification store load error:", error);
        } finally {
            state.loading = false;
            notify();
        }

        return getState();
    }

    async function loadMore() {
        if (!state.pagination?.hasMore || !state.pagination.nextCursor) return getState();
        if (state.loading) return getState();

        state.loading = true;
        notify();

        try {
            const params = new URLSearchParams({
                limit: String(state.pagination.limit || 20),
                cursor: state.pagination.nextCursor
            });

            if (state.filter === "promotions") params.set("category", "promotions");
            if (state.filter === "unread") params.set("unread", "true");

            const res = await fetch(apiUrl(`/api/notifications?${params.toString()}`), {
                headers: authHeaders()
            });
            const data = await res.json();

            if (!data.success) {
                throw new Error(data.message || "Failed to load more notifications");
            }

            (data.notifications || []).forEach(item => mergeNotification(item, "append"));
            state.unreadCount = Number(data.unreadCount || state.unreadCount || 0);
            state.pagination = data.pagination || state.pagination;
        } catch (error) {
            state.error = error.message || "Failed to load more notifications";
            console.log("Notification store load more error:", error);
        } finally {
            state.loading = false;
            notify();
        }

        return getState();
    }

    async function refreshUnreadCount() {
        try {
            const res = await fetch(apiUrl("/api/notifications/unread-count"), {
                headers: authHeaders()
            });
            const data = await res.json();

            if (data.success) {
                state.unreadCount = Number(data.unreadCount || 0);
                notify();
            }
        } catch (error) {
            console.log("Notification unread refresh error:", error);
        }
    }

    async function markRead(id) {
        const notification = state.notifications.find(item => item.id === String(id));

        if (notification && !notification.read) {
            notification.read = true;
            notification.isRead = true;
            notify();
        }

        try {
            const res = await fetch(apiUrl(`/api/notifications/${encodeURIComponent(id)}/read`), {
                method: "PATCH",
                headers: authHeaders()
            });
            const data = await res.json();

            if (data.success) {
                if (data.notification) mergeNotification(data.notification);
                state.unreadCount = Number(data.unreadCount || 0);
                notify();
            }
        } catch (error) {
            console.log("Notification mark read error:", error);
            await load({ force: true });
        }
    }

    async function markAllRead() {
        state.notifications.forEach(item => {
            item.read = true;
            item.isRead = true;
        });
        state.unreadCount = 0;
        notify();

        try {
            const res = await fetch(apiUrl("/api/notifications/read-all"), {
                method: "PATCH",
                headers: authHeaders()
            });
            const data = await res.json();

            if (data.success) {
                state.unreadCount = Number(data.unreadCount || 0);
                notify();
            }
        } catch (error) {
            console.log("Notification mark all read error:", error);
            await load({ force: true });
        }
    }

    async function remove(id) {
        state.notifications = state.notifications.filter(item => item.id !== String(id));
        ids.delete(String(id));
        notify();

        try {
            const res = await fetch(apiUrl(`/api/notifications/${encodeURIComponent(id)}`), {
                method: "DELETE",
                headers: authHeaders()
            });
            const data = await res.json();

            if (data.success) {
                state.unreadCount = Number(data.unreadCount || 0);
                notify();
            }
        } catch (error) {
            console.log("Notification delete error:", error);
            await load({ force: true });
        }
    }

    function attachRealtime() {
        if (!window.AZIEL?.realtime || window.__azielNotificationRealtimeAttached) return;

        window.__azielNotificationRealtimeAttached = true;

        window.AZIEL.realtime.on("notification:new", payload => {
            mergeNotification(payload.notification || payload);

            if (payload.unreadCount !== undefined) {
                state.unreadCount = Number(payload.unreadCount || 0);
            } else {
                refreshUnreadCount();
            }

            notify();
        });

        window.AZIEL.realtime.on("notification:count-changed", payload => {
            if (payload?.unreadCount !== undefined) {
                state.unreadCount = Number(payload.unreadCount || 0);
                notify();
            }
        });

        window.AZIEL.realtime.on("newNotification", payload => {
            const result = mergeNotification(payload);
            if (!result.added) return;

            refreshUnreadCount();
            notify();
        });

        const socket = window.AZIEL.realtime.connect();
        socket?.on?.("connect", () => {
            refreshUnreadCount();
        });
    }

    async function init() {
        if (state.initialized || state.loading) {
            attachRealtime();
            return getState();
        }

        const token = window.AZIEL?.getToken?.() || localStorage.getItem("token") || sessionStorage.getItem("token");
        if (!token) return getState();

        attachRealtime();
        return load();
    }

    function subscribe(fn) {
        if (typeof fn !== "function") return () => {};

        subscribers.add(fn);
        fn(getState());

        return () => {
            subscribers.delete(fn);
        };
    }

    function getState() {
        return {
            initialized: state.initialized,
            loading: state.loading,
            error: state.error,
            notifications: state.notifications.slice(),
            unreadCount: state.unreadCount,
            pagination: { ...state.pagination }
            ,
            filter: state.filter
        };
    }

    window.AZIEL_NOTIFICATIONS = {
        getState,
        init,
        load,
        loadMore,
        markAllRead,
        markRead,
        refreshUnreadCount,
        remove,
        subscribe
    };
})();
