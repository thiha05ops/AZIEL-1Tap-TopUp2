// frontend/js/admin-support.js

let supportSocket = null;
let adminSupportInitialized = false;
let adminSupportLoaded = false;

document.addEventListener("DOMContentLoaded", () => {

    initAdminSupport();

});

// ======================================
// INIT
// ======================================

function initAdminSupport() {
    if (adminSupportInitialized) return;
    adminSupportInitialized = true;

    setupAdminSupportLazyLoad();
    setupRefreshButton();
    startAdminLiveSupport();

}

function setupAdminSupportLazyLoad() {
    maybeLoadAdminSupportForActiveSection();

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "support") {
            loadSupportTickets();
        }
    });
}

function maybeLoadAdminSupportForActiveSection() {
    const section = document.getElementById("section-support");

    if (!section || section.classList.contains("active")) {
        loadSupportTickets();
    }
}

// ======================================
// SOCKET
// ======================================

function startAdminLiveSupport() {

    if (!window.AZIEL?.realtime) return;

    supportSocket = window.AZIEL.realtime.connect({ role: "admin" });
    if (!supportSocket) return;

    // LIVE CHAT MESSAGE
    window.AZIEL.realtime.on("liveChatMessage", data => {

        showLiveIncomingMessage(data);

    }, { role: "admin" });

}

// ======================================
// REFRESH
// ======================================

function setupRefreshButton() {

    const btn =
        document.getElementById(
            "refreshSupportBtn"
        );

    if (!btn) return;

    btn.addEventListener("click", () => {

        loadSupportTickets();

    });

}

// ======================================
// LOAD TICKETS
// ======================================

async function loadSupportTickets() {

    const box =
        getAdminSupportContainer();

    if (!box) return;

    adminSupportLoaded = true;

    box.innerHTML =
        `<p>Loading support tickets...</p>`;

    try {

        const data =
            await adminFetch(
                "/api/admin/support/tickets"
            );

        if (!data?.success) {

            box.innerHTML =
                "Failed to load tickets.";

            return;

        }

        if (!data.tickets?.length) {

            box.innerHTML = `
                <div class="admin-empty-box">
                    No support tickets found.
                </div>
            `;

            return;

        }

        box.innerHTML =
            data.tickets
                .map(renderTicketCard)
                .join("");

    } catch (error) {

        console.log(
            "Load support tickets error:",
            error
        );

        box.innerHTML =
            "Server error.";

    }

}

// ======================================
// RENDER
// ======================================

function renderTicketCard(ticket) {

    const screenshot =
        ticket.screenshot
            ? getAdminUploadedImageUrl(ticket.screenshot, { folder: "support" })
            : "";

    const screenshotHTML = screenshot && !isAdminUploadedImageFailed(screenshot)
        ? `
                <img
                    src="${escapeAdminSupportHTML(screenshot)}"
                    data-src="${escapeAdminSupportHTML(screenshot)}"
                    class="ticket-image-admin"
                    onerror="handleAdminSupportImageError(this)"
                    onclick="window.open('${escapeAdminSupportHTML(screenshot)}','_blank')"
                >
            `
        : screenshot
            ? adminMissingImageHTML("Support image unavailable")
            : "";

    return `

        <div class="support-ticket-card">

            <div class="support-ticket-top">

                <div>

                    <h2>
                        ${ticket.subject || "-"}
                    </h2>

                    <p class="ticket-user">
                        👤 ${ticket.username || "-"}
                    </p>

                </div>

                <span class="
                    ticket-status-badge
                    status-${ticket.status || "open"}
                ">
                    ${ticket.status || "open"}
                </span>

            </div>

            <div class="ticket-meta">

                <span>
                    🎫 ${ticket.ticketId || "-"}
                </span>

                <span>
                    📂 ${ticket.type || "general"}
                </span>

            </div>

            <div class="ticket-message-box">
                ${ticket.message || ""}
            </div>

            ${screenshotHTML}

            ${ticket.adminReply
            ? `
                <div class="ticket-admin-reply">

                    <strong>
                        Admin Reply
                    </strong>

                    <p>
                        ${ticket.adminReply}
                    </p>

                </div>
            `
            : ""
        }

            <div class="admin-reply-box">

                <textarea
                    id="reply-${ticket._id}"
                    placeholder="Write admin reply..."
                ></textarea>

                <div class="reply-actions">

                    <button
                        class="reply-btn"
                        onclick="replyTicket('${ticket._id}','replied','${ticket.username}')"
                    >
                        Send Reply
                    </button>

                    <button
                        class="solve-btn"
                        onclick="replyTicket('${ticket._id}','solved','${ticket.username}')"
                    >
                        Mark Solved
                    </button>

                    <button
                        class="close-btn"
                        onclick="replyTicket('${ticket._id}','closed','${ticket.username}')"
                    >
                        Close
                    </button>

                </div>

            </div>

        </div>
    `;
}

function handleAdminSupportImageError(img) {
    handleAdminUploadedImageError(img, "Support image unavailable");
}

// ======================================
// REPLY
// ======================================

async function replyTicket(
    id,
    status,
    username
) {

    try {

        const textarea =
            document.getElementById(
                `reply-${id}`
            );

        const reply =
            textarea?.value?.trim() || "";

        const data =
            await adminFetch(

                `/api/admin/support/tickets/${id}/reply`,

                {
                    method: "PUT",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        reply,
                        status

                    })

                }

            );

        if (!data?.success) {

            showAdminToast?.(
                data?.message ||
                "Reply failed",
                "error"
            );

            return;

        }

        // LIVE USER REPLY
        if (
            supportSocket &&
            username
        ) {

            supportSocket.emit(
                "adminLiveReply",
                {
                    username,
                    message: reply,
                    reply,
                    status
                }
            );

        }

        showAdminSuccess(
            "Ticket updated successfully"
        );

        loadSupportTickets();

    } catch (error) {

        console.log(
            "Reply support ticket error:",
            error
        );

        showAdminToast?.(
            "Server error",
            "error"
        );

    }

}

// ======================================
// LIVE MESSAGE POPUP
// ======================================

function showLiveIncomingMessage(data) {

    const old =
        document.getElementById(
            "adminLiveMessagePopup"
        );

    if (old) old.remove();

    const popup =
        document.createElement("div");

    popup.id =
        "adminLiveMessagePopup";

    popup.innerHTML = `
        <strong>
            💬 Live Support Message
        </strong>

        <p>
            ${data.username || "User"}
        </p>

        <small>
            ${data.message || ""}
        </small>
    `;

    popup.style.position = "fixed";
    popup.style.right = "20px";
    popup.style.bottom = "20px";
    popup.style.width = "320px";

    popup.style.padding = "18px";
    popup.style.borderRadius = "22px";

    popup.style.background =
        "linear-gradient(135deg,#7c3aed,#2563eb)";

    popup.style.color = "#fff";

    popup.style.zIndex = "999999";

    popup.style.boxShadow =
        "0 20px 50px rgba(0,0,0,.45)";

    document.body.appendChild(
        popup
    );

    setTimeout(() => {

        popup.remove();

    }, 5000);

}

// ======================================
// SUCCESS POPUP
// ======================================

function showAdminSuccess(
    message
) {
    if (window.AZIEL_UI?.toast) {
        window.AZIEL_UI.toast.success(message);
        return;
    }

    const old =
        document.getElementById(
            "adminSuccessPopup"
        );

    if (old) old.remove();

    const popup =
        document.createElement(
            "div"
        );

    popup.id =
        "adminSuccessPopup";

    popup.innerHTML =
        `✅ ${message}`;

    popup.style.position =
        "fixed";

    popup.style.bottom =
        "20px";

    popup.style.right =
        "20px";

    popup.style.background =
        "linear-gradient(135deg,#22c55e,#16a34a)";

    popup.style.color =
        "#fff";

    popup.style.padding =
        "14px 18px";

    popup.style.borderRadius =
        "16px";

    popup.style.fontWeight =
        "800";

    popup.style.zIndex =
        "999999";

    popup.style.boxShadow =
        "0 12px 40px rgba(0,0,0,.35)";

    document.body.appendChild(
        popup
    );

    setTimeout(() => {

        popup.remove();

    }, 3000);

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
window.replyTicket =
    replyTicket;

window.loadSupportTickets =
    loadSupportTickets;

function getAdminSupportContainer() {
    return (
        document.getElementById("supportTickets") ||
        document.getElementById("adminSupportList")
    );
}

function escapeAdminSupportHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
