// frontend/js/admin-wallet.js

document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("adminToken");

    if (!token) {
        alert("Admin session expired");
        window.location.href = "admin-login.html";
        return;
    }

    loadWalletTopups();
});

async function secureAdminFetch(url, options = {}) {
    if (typeof adminFetch === "function") {
        return await adminFetch(url, options);
    }

    const token = localStorage.getItem("adminToken");

    if (!token) {
        alert("Admin session expired");
        window.location.href = "admin-login.html";
        return null;
    }

    const headers = {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
    };

    const res = await fetch(url, {
        ...options,
        headers
    });

    const data = await res.json();

    if (res.status === 401) {
        alert("Admin session expired");
        localStorage.removeItem("adminToken");
        window.location.href = "admin-login.html";
        return null;
    }

    return data;
}

async function loadWalletTopups() {
    try {
        const data = await secureAdminFetch("/api/admin/wallet/topups");

        if (!data || !data.success) {
            alert(data?.message || "Failed to load wallet topups");
            return;
        }

        renderTopups(data.topups || []);

    } catch (error) {
        console.log("Wallet topup load error:", error);
        alert("Wallet topups load error");
    }
}

function renderTopups(topups) {
    const box =
        document.getElementById("adminWalletList") ||
        document.getElementById("walletTopups");

    if (!box) return;

    if (!topups.length) {
        box.innerHTML = `<p>No wallet topups found.</p>`;
        return;
    }

    box.innerHTML = "";

    topups.forEach(item => {
        const status = (item.status || "pending").toLowerCase();
        const isPending = status === "pending";

        const slip = item.paymentSlip || item.slip || item.filename || "";
        const slipUrl = slip.startsWith("/uploads/")
            ? slip
            : `/uploads/${slip}`;

        box.innerHTML += `
            <div class="topup-card">
                <h2>${item.username || "Unknown User"}</h2>

                <p>
                    Amount:
                    ${Number(item.amount || 0).toLocaleString()}
                    ${item.currency || ""}
                </p>

                <p>Payment: ${item.paymentMethod || "-"}</p>

                <p>
                    Status:
                    <span class="status-${status}">
                        ${status}
                    </span>
                </p>

                ${slip
                ? `<img class="topup-slip" src="${slipUrl}" alt="Payment slip">`
                : `<p>No slip uploaded</p>`
            }

                <div class="topup-actions">
                    <button
                        class="approve-btn"
                        data-id="${item._id}"
                        data-status="approved"
                        ${!isPending ? "disabled" : ""}
                    >
                        ${status === "approved" ? "Approved" : "Approve"}
                    </button>

                    <button
                        class="reject-btn"
                        data-id="${item._id}"
                        data-status="rejected"
                        ${!isPending ? "disabled" : ""}
                    >
                        ${status === "rejected" ? "Rejected" : "Reject"}
                    </button>
                </div>
            </div>
        `;
    });

    document.querySelectorAll(".topup-slip").forEach(img => {
        img.addEventListener("click", () => {
            window.open(img.src, "_blank");
        });
    });

    document.querySelectorAll(".topup-actions button").forEach(btn => {
        btn.addEventListener("click", () => {
            updateStatus(btn.dataset.id, btn.dataset.status);
        });
    });
}

async function updateStatus(id, status) {
    if (!id) {
        alert("Missing topup ID");
        return;
    }

    if (!confirm(`Are you sure to ${status} this topup?`)) {
        return;
    }

    try {
        const data = await secureAdminFetch(
            `/api/admin/wallet/topups/${id}/status`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ status })
            }
        );

        if (!data || !data.success) {
            alert(data?.message || "Update failed");
            return;
        }

        alert(`Topup ${status}`);
        loadWalletTopups();

    } catch (error) {
        console.log("Wallet status update error:", error);
        alert("Server error");
    }
}

window.updateStatus = updateStatus;
window.loadWalletTopups = loadWalletTopups;
function initSlipZoom() {

    const modal = document.getElementById("slipModal");
    const modalImg = document.getElementById("slipModalImg");
    const closeBtn = document.getElementById("closeSlipModal");

    document.querySelectorAll(".topup-slip").forEach(img => {

        img.addEventListener("click", () => {

            modal.classList.add("show");
            modalImg.src = img.src;

        });

    });

    closeBtn?.addEventListener("click", () => {
        modal.classList.remove("show");
    });

    modal?.addEventListener("click", e => {

        if (e.target === modal) {
            modal.classList.remove("show");
        }

    });
}
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