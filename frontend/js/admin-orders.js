let allAdminOrders = [];
// frontend/js/admin-orders.js

document.addEventListener("DOMContentLoaded", () => {
    loadOrders();
});

async function loadOrders() {

    const body =
        document.getElementById(
            "adminOrdersBody"
        );

    if (!body) return;

    try {

        const token =
            localStorage.getItem("adminToken") ||
            localStorage.getItem("token");

        const res =
            await fetch(
                "/api/admin/orders",
                {
                    headers: {
                        Authorization:
                            `Bearer ${token}`
                    }
                }
            );

        const data =
            await res.json();

        if (
            !data.success
        ) {

            body.innerHTML = `
                <tr>
                    <td colspan="6">
                        Failed to load orders
                    </td>
                </tr>
            `;

            return;

        }

        if (
            !data.orders.length
        ) {

            body.innerHTML = `
                <tr>
                    <td colspan="6">
                        No orders found
                    </td>
                </tr>
            `;

            return;

        }

        allAdminOrders = data.orders || [];
        renderOrders(allAdminOrders);


    } catch (error) {

        console.log(
            "Load orders error:",
            error
        );

    }

}

async function updateOrderStatus(
    orderId,
    status
) {

    try {

        const token =
            localStorage.getItem("adminToken") ||
            localStorage.getItem("token");

        const res =
            await fetch(
                `/api/admin/orders/${orderId}/status`,
                {
                    method: "PUT",

                    headers: {
                        "Content-Type":
                            "application/json",

                        Authorization:
                            `Bearer ${token}`
                    },

                    body: JSON.stringify({
                        status
                    })
                }
            );

        const data =
            await res.json();

        if (!data.success) {

            showAdminToast(
                data.message ||
                "Update failed",
                "error"
            );

            return;

        }

        showAdminToast(
            "Order updated",
            "success"
        );

        loadOrders();
        loadAdminDashboard();

    } catch (error) {

        console.log(error);

        showAdminToast(
            "Server error",
            "error"
        );

    }

}

function normalizeStatus(status) {

    const s =
        String(status || "")
            .toLowerCase();

    if (
        s === "pending_payment"
    ) return "pending";

    return s;

}

function formatStatus(status) {

    const map = {

        pending_payment:
            "Pending",

        paid:
            "Paid",

        processing:
            "Processing",

        completed:
            "Completed",

        cancelled:
            "Cancelled"

    };

    return map[status] || status;

}
function renderOrders(orders) {
    const body = document.getElementById("adminOrdersBody");
    if (!body) return;

    if (!orders.length) {
        body.innerHTML = `
            <tr>
                <td colspan="6">No orders found</td>
            </tr>
        `;
        return;
    }

    body.innerHTML = orders.map(order => {
        const safeOrder = encodeURIComponent(JSON.stringify(order));

        return `
            <tr>
                <td onclick="openOrderModal(JSON.parse(decodeURIComponent('${safeOrder}')))">
                    ${order.orderId || "-"}
                </td>

                <td>${order.username || "-"}</td>
                <td>${order.game || "-"}</td>
                <td>${order.packageName || "-"}</td>

                <td>
                    <span class="admin-status ${normalizeStatus(order.status)}">
                        ${formatStatus(order.status)}
                    </span>
                </td>

                <td>
                    <select
                        onchange="updateOrderStatus('${order._id}', this.value)"
                        class="admin-status-select">

                        <option value="pending_payment" ${order.status === "pending_payment" ? "selected" : ""}>Pending</option>
                        <option value="paid" ${order.status === "paid" ? "selected" : ""}>Paid</option>
                        <option value="processing" ${order.status === "processing" ? "selected" : ""}>Processing</option>
                        <option value="completed" ${order.status === "completed" ? "selected" : ""}>Completed</option>
                        <option value="cancelled" ${order.status === "cancelled" ? "selected" : ""}>Cancelled</option>
                    </select>
                </td>
            </tr>
        `;
    }).join("");
}

document.addEventListener("DOMContentLoaded", () => {
    const search = document.getElementById("orderSearchInput");
    const filter = document.getElementById("orderStatusFilter");

    function applyFilter() {
        const keyword = (search?.value || "").toLowerCase();
        const status = filter?.value || "all";

        const filtered = allAdminOrders.filter(order => {
            const text = `
                ${order.orderId || ""}
                ${order.username || ""}
                ${order.game || ""}
                ${order.packageName || ""}
            `.toLowerCase();

            const matchText = text.includes(keyword);
            const matchStatus = status === "all" || order.status === status;

            return matchText && matchStatus;
        });

        renderOrders(filtered);
    }

    search?.addEventListener("input", applyFilter);
    filter?.addEventListener("change", applyFilter);
});
// ======================
// ORDER DETAILS MODAL
// ======================

document.addEventListener(
    "DOMContentLoaded",

    () => {

        const closeBtn =
            document.getElementById(
                "closeOrderModal"
            );

        closeBtn?.addEventListener(
            "click",

            closeOrderModal
        );

    }
);

function openOrderModal(order) {

    const modal =
        document.getElementById(
            "orderDetailModal"
        );

    const content =
        document.getElementById(
            "orderDetailContent"
        );

    if (
        !modal ||
        !content
    ) return;

    content.innerHTML = `

        <div class="order-detail-grid">

            ${detailItem(
        "Order ID",
        order.orderId
    )}

            ${detailItem(
        "Username",
        order.username
    )}

            ${detailItem(
        "Game",
        order.game
    )}

            ${detailItem(
        "Package",
        order.packageName
    )}

            ${detailItem(
        "User ID",
        order.userId || "-"
    )}

            ${detailItem(
        "Server ID",
        order.zoneId || "-"
    )}

            ${detailItem(
        "Amount",
        `${order.amount || 0} ${order.currency || ""}`
    )}

            ${detailItem(
        "Payment",
        order.paymentMethod || "-"
    )}

            ${detailItem(
        "Status",
        formatStatus(order.status)
    )}

            ${detailItem(
        "Created",
        new Date(order.createdAt)
            .toLocaleString()
    )}

        </div>

        ${order.screenshot ? `

            <div style="margin-top:18px;">

                <small style="color:#94a3b8;">
                    Payment Screenshot
                </small>

                <img
                    src="${order.screenshot}"
                    style="
                        width:100%;
                        margin-top:10px;
                        border-radius:18px;
                        border:1px solid rgba(255,255,255,.08);
                    "
                >

            </div>

        ` : ""}

    `;

    modal.classList.add(
        "show"
    );

}

function closeOrderModal() {

    const modal =
        document.getElementById(
            "orderDetailModal"
        );

    modal?.classList.remove(
        "show"
    );

}

function detailItem(
    label,
    value
) {

    return `

        <div class="order-detail-item">

            <small>
                ${label}
            </small>

            <strong>
                ${value || "-"}
            </strong>

        </div>

    `;

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