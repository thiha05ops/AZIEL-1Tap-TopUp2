// frontend/js/socket-client.js
// AZIEL realtime client foundation.

(function () {
    window.AZIEL = window.AZIEL || {};

    const state = {
        socket: null,
        role: "",
        listeners: new Map(),
        authFailed: false
    };

    function socketUrl() {
        return location.port === "5500"
            ? `${location.protocol}//${location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost"}:3000`
            : undefined;
    }

    function getToken(role) {
        if (role === "admin") {
            return localStorage.getItem("adminToken") || "";
        }

        if (window.AZIEL?.getToken) {
            return window.AZIEL.getToken() || "";
        }

        return localStorage.getItem("token") || sessionStorage.getItem("token") || "";
    }

    function handleAuthFailure(role, message) {
        state.authFailed = true;

        if (role === "admin" && typeof window.adminLogout === "function") {
            window.adminLogout(message || "Admin realtime session expired.");
            return;
        }

        if (role !== "admin" && window.AZIEL?.handleAuthFailure) {
            window.AZIEL.handleAuthFailure(message || "Session expired. Please login again.");
        }
    }

    function attachLifecycle(socket, role) {
        socket.on("connect_error", error => {
            const message = error?.message || "";

            if (/token|auth|expired|invalid/i.test(message)) {
                socket.io.opts.reconnection = false;
                handleAuthFailure(role, message);
            } else if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
                console.log("Realtime connection error:", message || error);
            }
        });

        socket.on("disconnect", reason => {
            if (reason === "io server disconnect" && state.authFailed) {
                socket.io.opts.reconnection = false;
            }
        });
    }

    function connect(options = {}) {
        const role = options.role === "admin" ? "admin" : "user";

        if (state.socket && state.role === role) {
            return state.socket;
        }

        if (state.socket) {
            state.socket.disconnect();
            state.socket = null;
        }

        if (typeof window.io === "undefined") {
            console.log("Socket.IO not loaded");
            return null;
        }

        const token = getToken(role);

        if (!token) {
            return null;
        }

        state.role = role;
        state.authFailed = false;

        const socket = window.io(socketUrl(), {
            auth: {
                token,
                role
            },
            reconnectionAttempts: 3,
            reconnectionDelay: 1000,
            timeout: 8000
        });

        attachLifecycle(socket, role);
        state.socket = socket;
        window.AZIEL.socket = socket;

        return socket;
    }

    function listenerKey(eventName, handler) {
        return `${eventName}:${handler}`;
    }

    function on(eventName, handler, options = {}) {
        if (!eventName || typeof handler !== "function") return null;

        const socket = connect(options);
        if (!socket) return null;

        const key = listenerKey(eventName, handler);

        if (state.listeners.has(key)) {
            socket.off(eventName, state.listeners.get(key));
        }

        state.listeners.set(key, handler);
        socket.on(eventName, handler);

        return socket;
    }

    function off(eventName, handler) {
        if (!state.socket || !eventName || typeof handler !== "function") return;

        const key = listenerKey(eventName, handler);
        const current = state.listeners.get(key) || handler;

        state.socket.off(eventName, current);
        state.listeners.delete(key);
    }

    function emit(eventName, payload, options = {}) {
        const socket = connect(options);
        if (!socket) return false;

        socket.emit(eventName, payload);
        return true;
    }

    function disconnect() {
        if (state.socket) {
            state.socket.disconnect();
            state.socket = null;
        }

        state.listeners.clear();
    }

    window.AZIEL.realtime = {
        connect,
        disconnect,
        emit,
        getSocket: () => state.socket,
        isConnected: () => Boolean(state.socket?.connected),
        off,
        on
    };
})();
