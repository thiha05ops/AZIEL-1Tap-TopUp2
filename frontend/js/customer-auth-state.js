(function initializeCustomerAuthState(global) {
    function persistCustomer(user) {
        if (!user || !user.username) {
            throw new Error("Authenticated customer data is missing");
        }

        localStorage.removeItem("token");
        localStorage.removeItem("azielToken");
        sessionStorage.removeItem("token");
        sessionStorage.removeItem("username");

        localStorage.setItem("isLogin", "true");
        localStorage.setItem("username", user.username);
        localStorage.setItem("displayName", user.displayName || user.username);
        localStorage.setItem("region", user.region || "MM");
        localStorage.setItem("email", user.email || "");
        localStorage.setItem("role", user.role || "user");
    }

    function resolvePostLoginRedirect(origin = global.location.origin) {
        const value = localStorage.getItem("redirectAfterLogin");
        localStorage.removeItem("redirectAfterLogin");

        if (!value) return "/";

        try {
            const destination = new URL(String(value), origin);
            if (destination.origin !== origin) return "/";
            return `${destination.pathname}${destination.search}${destination.hash}` || "/";
        } catch (_) {
            return "/";
        }
    }

    global.AZIEL_AUTH_STATE = {
        persistCustomer,
        resolvePostLoginRedirect
    };
})(window);
