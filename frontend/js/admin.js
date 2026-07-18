// frontend/js/admin.js

let allOrders = [];

function formatPaymentName(value) {
    return window.AZIEL_PAYMENT_DISPLAY?.from?.(value, value || "-") || value || "-";
}

document.addEventListener("DOMContentLoaded", () => {
    if (!localStorage.getItem("adminToken")) {
        window.location.href = "admin-login.html";
        return;
    }

    const adminContent = document.getElementById("adminContent");
    if (adminContent) {
        adminContent.style.display = "block";
    }

    loadOrders();

    document
        .getElementById("refreshBtn")
        ?.addEventListener("click", loadOrders);

    document
        .getElementById("searchOrder")
        ?.addEventListener("input", renderOrders);

    document
        .getElementById("statusFilter")
        ?.addEventListener("change", renderOrders);
});

async function loadOrders() {
    try {
        if (typeof adminFetch !== "function") {
            showLegacyAdminMessage("admin-api.js not loaded", "error");
            return;
        }

        const data = await adminFetch("/api/admin/orders");

        if (!data || !data.success) {
            showLegacyAdminMessage(data?.message || "Failed to load orders", "error");
            return;
        }

        allOrders = data.orders || [];

        renderStats();
        renderOrders();
        renderTopups(data.topups || []);
        initSlipZoom();
        function initSlipZoom() {

            const modal = document.getElementById("slipModal");
            const modalImg = document.getElementById("slipModalImg");
            const closeBtn = document.getElementById("closeSlipModal");

            document.querySelectorAll(".slip-img").forEach(img => {

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
    } catch (error) {
        console.log("Load orders error:", error);
        showLegacyAdminMessage("Server error", "error");
    }
}

function renderStats() {
    const totalOrders = document.getElementById("totalOrders");
    const paidOrders = document.getElementById("paidOrders");
    const processingOrders = document.getElementById("processingOrders");
    const completedOrders = document.getElementById("completedOrders");

    if (totalOrders) totalOrders.innerText = allOrders.length;

    if (paidOrders) {
        paidOrders.innerText =
            allOrders.filter(o => o.status === "paid").length;
    }

    if (processingOrders) {
        processingOrders.innerText =
            allOrders.filter(o => o.status === "processing").length;
    }

    if (completedOrders) {
        completedOrders.innerText =
            allOrders.filter(o => o.status === "completed").length;
    }
}

function renderOrders() {
    const list = document.getElementById("ordersList");

    if (!list) return;

    const search =
        (document.getElementById("searchOrder")?.value || "")
            .toLowerCase();

    const filter =
        document.getElementById("statusFilter")?.value || "all";

    let orders = [...allOrders];

    if (filter !== "all") {
        orders = orders.filter(o => o.status === filter);
    }

    if (search) {
        orders = orders.filter(o =>
            String(o.orderId || "").toLowerCase().includes(search) ||
            String(o.username || "").toLowerCase().includes(search) ||
            String(o.game || "").toLowerCase().includes(search) ||
            String(o.userId || "").toLowerCase().includes(search)
        );
    }

    if (!orders.length) {
        list.innerHTML = `
            <tr>
                <td colspan="9">No orders found</td>
            </tr>
        `;
        return;
    }

    list.innerHTML = orders.map(order => {
        const slip =
            order.paymentSlip ||
            order.slip ||
            "";

        const slipUrl = getAdminUploadUrl(slip);
        const slipHTML = slipUrl && !isAdminUploadedImageFailed(slipUrl)
            ? `<img src="${slipUrl}" data-src="${slipUrl}" class="slip-img" data-slip="${slipUrl}" onerror="handleLegacyAdminImageError(this)">`
            : slipUrl
                ? adminMissingImageHTML("Image unavailable", "span")
                : "-";

        return `
            <tr>
                <td>
                    <b>${order.orderId || "-"}</b><br>
                    <small>${formatDate(order.createdAt)}</small>
                </td>

                <td>${order.username || "guest"}</td>

                <td>
                    ${order.game || "-"}<br>
                    <small>ID: ${order.userId || "-"}</small><br>
                    <small>Server: ${order.zoneId || "-"}</small>
                </td>

                <td>${order.packageName || order.selectedPackage || "-"}</td>

                <td>${order.amount || 0} ${order.currency || ""}</td>

                <td>${formatPaymentName(order.paymentMethod)}</td>

                <td>
                    <span class="status-badge ${statusClass(order.status)}">
                        ${order.status || "pending"}
                    </span>
                </td>

                <td>
                    ${slipHTML}
                </td>

                <td>
                    <div class="action-grid">
                        <button class="btn-paid" data-id="${order._id}" data-status="paid">Paid</button>
                        <button class="btn-processing" data-id="${order._id}" data-status="processing">Process</button>
                        <button class="btn-completed" data-id="${order._id}" data-status="completed">Done</button>
                        <button class="btn-cancel" data-id="${order._id}" data-status="cancelled">Cancel</button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    document.querySelectorAll(".slip-img").forEach(img => {
        img.addEventListener("click", () => {
            window.open(img.dataset.slip, "_blank");
        });
    });

    document.querySelectorAll(".action-grid button").forEach(btn => {
        btn.addEventListener("click", () => {
            updateStatus(btn.dataset.id, btn.dataset.status, btn);
        });
    });
}

function getAdminUploadUrl(path) {
    return getAdminUploadedImageUrl(path);
}

function handleLegacyAdminImageError(img) {
    handleAdminUploadedImageError(img, "Image unavailable");
}

async function updateStatus(id, status, btn = null) {
    if (!id) {
        showLegacyAdminMessage("Missing order ID", "error");
        return;
    }

    try {
        window.AZIEL_UI?.button?.setLoading(btn, { text: "Updating..." });

        const data = await adminFetch(
            `/api/admin/orders/${id}/status`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ status })
            }
        );

        if (!data || !data.success) {
            showLegacyAdminMessage(data?.message || "Update failed", "error");
            return;
        }

        await loadOrders();
        showLegacyAdminMessage("Order updated", "success");

    } catch (error) {
        console.log("Update order error:", error);
        showLegacyAdminMessage("Server error", "error");
    } finally {
        window.AZIEL_UI?.button?.reset(btn);
    }
}

function showLegacyAdminMessage(message, type = "info") {
    if (typeof showAdminToast === "function") {
        showAdminToast(message, type);
        return;
    }

    const method = type === "success"
        ? "success"
        : type === "error"
            ? "error"
            : "info";

    if (window.AZIEL_UI?.toast?.[method]) {
        window.AZIEL_UI.toast[method](message);
    } else {
        console.error(message);
    }
}

function statusClass(status) {
    if (status === "paid") return "status-paid";
    if (status === "processing") return "status-processing";
    if (status === "completed") return "status-completed";
    if (status === "cancelled" || status === "failed") return "status-failed";
    return "status-pending";
}

function formatDate(date) {
    if (!date) return "-";
    return new Date(date).toLocaleString();
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
window.loadOrders = loadOrders;
window.updateStatus = updateStatus;
