// frontend/js/admin-api.js

function getAdminToken() {

    return localStorage.getItem(
        "adminToken"
    );

}

function adminLogout() {

    localStorage.removeItem(
        "adminToken"
    );

    window.location.href =
        "admin-login.html";
}

async function adminFetch(
    url,
    options = {}
) {

    const token =
        getAdminToken();

    if (!token) {

        adminLogout();

        return;
    }

    const headers = {

        ...(options.headers || {}),

        Authorization:
            `Bearer ${token}`

    };

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
            "Admin session expired"
        );

        adminLogout();

        return;
    }

    return data;
}