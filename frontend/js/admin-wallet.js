// frontend/js/admin-wallet.js

let adminWalletInitialized = false;

document.addEventListener("DOMContentLoaded", () => {
    initAdminWalletController();
});

function initAdminWalletController() {
    if (adminWalletInitialized) return;
    adminWalletInitialized = true;

    initSlipZoom();

    if (isAdminSectionActive("wallet") || !document.getElementById("section-wallet")) {
        loadWalletTopups();
    }

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "wallet") {
            loadWalletTopups();
        }
    });
}

async function loadWalletTopups() {
    const box = document.getElementById("adminWalletList");
    if (!box) return;

    box.innerHTML = `<div class="admin-list-empty">Loading wallet topups...</div>`;

    try {
        const data = await adminFetch("/api/admin/wallet/topups");

        if (!data || !data.success) {
            box.innerHTML = `<div class="admin-list-empty">${data?.message || "Failed to load wallet topups"}</div>`;
            return;
        }

        renderTopups(data.topups || []);

    } catch (error) {
        console.log("Wallet topup load error:", error);
        box.innerHTML = `<div class="admin-list-empty">Wallet topups load error.</div>`;
    }
}

function renderTopups(topups) {
    const box = document.getElementById("adminWalletList");
    if (!box) return;

    if (!topups.length) {
        box.innerHTML = `<div class="admin-list-empty">No wallet topups found.</div>`;
        return;
    }

    box.innerHTML = topups.map(item => {
        const status = String(item.status || "pending").toLowerCase();
        const slip = item.paymentSlip || item.slip || item.filename || "";
        const pending = status === "pending";
        const slipUrl = getSlipUrl(slip);
        const slipHTML = slipUrl && !isAdminUploadedImageFailed(slipUrl)
            ? `<img class="topup-slip" src="${escapeHTML(slipUrl)}" data-src="${escapeHTML(slipUrl)}" data-slip="${escapeHTML(slipUrl)}" onerror="handleAdminWalletImageError(this)">`
            : slipUrl
                ? adminMissingImageHTML("Slip image unavailable")
                : `<p>No slip uploaded</p>`;

        return `
            <div class="topup-card">
                <div class="topup-card-head">
                    <div>
                        <h2>${escapeHTML(item.username || "Unknown User")}</h2>
                        <small>${formatDate(item.createdAt)}</small>
                    </div>
                    <span class="admin-status ${normalizeTopupStatus(status)}">${formatTopupStatus(status)}</span>
                </div>

                <p><b>Amount:</b> ${Number(item.amount || 0).toLocaleString()} ${escapeHTML(item.currency || "")}</p>
                <p><b>Payment:</b> ${escapeHTML(item.paymentMethod || "-")}</p>

                ${slipHTML}

                <div class="topup-actions">
                    <button class="approve-btn" data-id="${escapeHTML(item._id)}" data-status="approved" ${!pending ? "disabled" : ""}>Approve</button>
                    <button class="reject-btn" data-id="${escapeHTML(item._id)}" data-status="rejected" ${!pending ? "disabled" : ""}>Reject</button>
                </div>
            </div>
        `;
    }).join("");

    bindTopupActions();
}

function bindTopupActions() {
    document.querySelectorAll(".topup-actions button").forEach(btn => {
        btn.addEventListener("click", () => updateTopupStatus(btn.dataset.id, btn.dataset.status));
    });

    document.querySelectorAll(".topup-slip").forEach(img => {
        img.addEventListener("click", () => openSlipModal(img.dataset.slip || img.src));
    });
}

async function updateTopupStatus(id, status) {
    if (!confirm(`Are you sure to ${status} this topup?`)) return;

    const data = await adminFetch(`/api/admin/wallet/topups/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
    });

    if (!data || !data.success) {
        showAdminToast?.(data?.message || "Update failed", "error");
        return;
    }

    showAdminToast?.(`Topup ${status}`, "success");
    await loadWalletTopups();
    loadAdminDashboard?.(false);
}

function initSlipZoom() {
    document.getElementById("closeSlipModal")?.addEventListener("click", closeSlipModal);

    document.getElementById("slipModal")?.addEventListener("click", e => {
        if (e.target.id === "slipModal") closeSlipModal();
    });
}

function openSlipModal(src) {
    const modal = document.getElementById("slipModal");
    const img = document.getElementById("slipModalImg");

    if (!modal || !img) {
        window.open(src, "_blank");
        return;
    }

    img.src = src;
    modal.classList.add("show");
}

function closeSlipModal() {
    document.getElementById("slipModal")?.classList.remove("show");
}

function getSlipUrl(slip) {
    return getAdminUploadedImageUrl(slip, { folder: "slips" });
}

function handleAdminWalletImageError(img) {
    handleAdminUploadedImageError(img, "Slip image unavailable");
}

function isAdminSectionActive(section) {
    const sectionEl = document.getElementById(`section-${section}`);
    return !sectionEl || sectionEl.classList.contains("active");
}

function normalizeTopupStatus(status) {
    if (status === "approved") return "completed";
    if (status === "rejected") return "cancelled";
    return status;
}

function formatTopupStatus(status) {
    return { pending: "Pending", approved: "Approved", rejected: "Rejected" }[status] || status;
}

function formatDate(date) {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

window.loadWalletTopups = loadWalletTopups;
