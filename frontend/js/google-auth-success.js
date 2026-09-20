(async () => {
    const params = new URLSearchParams(window.location.search);
    const handoff = params.get("handoff") || "";
    window.history.replaceState(null, "", "/auth/google/success");

    if (!handoff) {
        window.location.replace("/login?oauth=google&error=handoff_failed");
        return;
    }

    try {
        const response = await fetch("/api/auth/google/handoff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ handoff }),
            cache: "no-store",
            credentials: "same-origin"
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.token || !data.user) throw new Error("handoff_failed");

        const user = data.user;
        localStorage.setItem("token", data.token);
        localStorage.setItem("azielToken", data.token);
        localStorage.setItem("isLogin", "true");
        localStorage.setItem("username", user.username || "");
        localStorage.setItem("displayName", user.displayName || user.username || "User");
        localStorage.setItem("email", user.email || "");
        localStorage.setItem("region", user.region || "MM");
        localStorage.setItem("role", user.role || "user");
        localStorage.setItem("user", JSON.stringify(user));
        localStorage.setItem("azielUser", JSON.stringify(user));

        const requestedDestination = localStorage.getItem("redirectAfterLogin") || "/";
        localStorage.removeItem("redirectAfterLogin");
        let destination = "/";
        try {
            const parsed = new URL(requestedDestination, window.location.origin);
            if (parsed.origin === window.location.origin) destination = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        } catch (_) { /* Root is the safe fallback. */ }
        window.location.replace(destination);
    } catch (_) {
        window.location.replace("/login?oauth=google&error=handoff_failed");
    }
})();
