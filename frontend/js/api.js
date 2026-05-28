// frontend/js/api.js

function getToken() {
    return localStorage.getItem("token");
}

function logoutUser() {

    localStorage.removeItem("token");

    localStorage.removeItem("username");

    localStorage.removeItem("region");

    window.location.href =
        "login.html";
}

function isTokenExpired(token) {

    try {

        const payload =
            JSON.parse(
                atob(
                    token.split(".")[1]
                )
            );

        if (!payload.exp) {
            return false;
        }

        return (
            payload.exp * 1000 <
            Date.now()
        );

    } catch (error) {

        return true;
    }
}

function checkToken() {

    const token = getToken();

    if (!token) {
        return;
    }

    if (isTokenExpired(token)) {

        alert(
            "Session expired. Please login again."
        );

        logoutUser();
    }
}

async function apiFetch(
    url,
    options = {}
) {

    checkToken();

    const token =
        getToken();

    const headers = {

        ...(options.headers || {})

    };

    if (token) {

        headers.Authorization =
            `Bearer ${token}`;
    }

    const res =
        await fetch(
            url,
            {
                ...options,
                headers
            }
        );

    const data =
        await res.json();

    if (res.status === 401) {

        alert(
            "Login expired."
        );

        logoutUser();

        return;
    }

    return data;
}

// AUTO CHECK EVERY 1 MINUTE
setInterval(
    checkToken,
    60000
);

// CHECK ON PAGE LOAD
checkToken();
document.addEventListener("click", e => {
    const link = e.target.closest("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    if (href.startsWith("#")) return;

    const url = new URL(href, window.location.href);

    if (url.origin === window.location.origin) {
        e.preventDefault();
        window.location.href = url.pathname + url.search + url.hash;
    }
});