// frontend/js/support.js
// AZIEL V2.5 Support Ticket System
// Live Chat is handled by frontend/js/live-chat.js

let allTickets = [];
let currentFilter = "all";
let supportSocketStarted = false;
const supportT = (key, fallback, params) => window.AZIEL_LOCALE?.t?.(key, fallback, params) || fallback;

function supportApiUrl(path) {
    if (window.AZIEL?.apiUrl) {
        return window.AZIEL.apiUrl(path);
    }

    const base = location.port === "5500"
        ? `${location.protocol}//${location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost"}:3000`
        : "";

    return `${base}${path}`;
}

function getSupportAuthHeaders() {
    return window.AZIEL?.authHeaders?.() || {};
}

document.addEventListener("DOMContentLoaded", () => {
    initSupportForm();
    initCategoryCards();
    initTicketTabs();
    initFaq();
    startSupportSocket();
    loadMyTickets();
});
window.addEventListener("aziel:locale-changed", () => {
    renderFaq();
    renderTickets();
});

/* ===============================
   INIT
================================ */

function initSupportForm() {
    const form = document.getElementById("supportForm");
    if (!form) return;

    form.addEventListener("submit", submitSupportTicket);
}

function initCategoryCards() {
    document.querySelectorAll(".category-card").forEach(card => {
        card.addEventListener("click", () => {
            const type = card.dataset.type || "general";

            document.querySelectorAll(".category-card").forEach(item => {
                item.classList.remove("active");
            });

            card.classList.add("active");

            const select = document.getElementById("ticketType");
            if (select) select.value = type;

            const subject = document.getElementById("ticketSubject");
            if (subject && !subject.value.trim()) {
                subject.value = getSubjectByType(type);
            }
        });
    });
}

function initTicketTabs() {
    document.querySelectorAll(".ticket-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".ticket-tab").forEach(item => {
                item.classList.remove("active");
            });

            tab.classList.add("active");

            currentFilter = tab.dataset.filter || "all";
            renderTickets();
        });
    });
}

function getSubjectByType(type) {
    const subjects = {
        order: supportT("support.subject.order", "My order is not completed"),
        payment: supportT("support.subject.payment", "Payment issue"),
        wallet: supportT("support.subject.wallet", "Wallet balance problem"),
        account: supportT("support.subject.account", "Account login issue"),
        general: supportT("support.subject.general", "Need help")
    };

    return subjects[type] || "Need help";
}

const faqData = [
    {
        questionKey: "support.faq.pending.question",
        question: "My order is still pending",
        answerKey: "support.faq.pending.answer",
        answer: "Orders are usually completed within a few minutes after payment. If your order is still pending, submit a support ticket with your Order ID."
    },
    {
        questionKey: "support.faq.payment.question",
        question: "Payment was successful but my order is not completed",
        answerKey: "support.faq.payment.answer",
        answer: "Payment confirmation may take a short time. If your order remains pending, contact support and include your payment details or Order ID."
    },
    {
        questionKey: "support.faq.wallet.question",
        question: "Wallet balance not updated",
        answerKey: "support.faq.wallet.answer",
        answer: "Wallet balance updates automatically after successful payment. If the balance is not updated, create a ticket with your payment method and amount."
    },
    {
        questionKey: "support.faq.password.question",
        question: "I forgot my password",
        answerKey: "support.faq.password.answer",
        answer: "Use the Forgot Password page to receive an OTP by email and reset your password securely."
    },
    {
        questionKey: "support.faq.refund.question",
        question: "Can I cancel or refund my order?",
        answerKey: "support.faq.refund.answer",
        answer: "Orders that are already processed cannot usually be cancelled. For special cases, submit a support ticket and our team will review it."
    },
    {
        questionKey: "support.faq.reply.question",
        question: "How long does support take to reply?",
        answerKey: "support.faq.reply.answer",
        answer: "Our support team replies as soon as possible during working hours. Order and payment issues are handled first."
    }
];

function initFaq() {
    renderFaq();

    document.addEventListener("click", (e) => {
        const btn = e.target.closest(".faq-question");
        if (!btn) return;

        const item = btn.closest(".faq-item");
        if (!item) return;

        item.classList.toggle("active");
    });
}

function renderFaq() {
    const box = document.getElementById("faqList");
    if (!box) return;

    box.innerHTML = faqData.map((faq, index) => `
        <div class="faq-item ${index === 0 ? "active" : ""}">
            <button class="faq-question" type="button">
                <span>${escapeHTML(supportT(faq.questionKey, faq.question))}</span>
                <i class="fa-solid fa-chevron-down"></i>
            </button>

            <div class="faq-answer">
                ${escapeHTML(supportT(faq.answerKey, faq.answer))}
            </div>
        </div>
    `).join("");
}

/* ===============================
   SUBMIT TICKET
================================ */

async function submitSupportTicket(e) {
    e.preventDefault();

    const username = getSupportUsername();

    if (!username) {
        showFormMessage(supportT("support.loginToSubmit", "Please login first to submit a support ticket."), "error");
        return;
    }

    const form = document.getElementById("supportForm");
    const btn = document.getElementById("submitTicketBtn");

    const type = document.getElementById("ticketType")?.value;
    const subject = document.getElementById("ticketSubject")?.value.trim();
    const message = document.getElementById("ticketMessage")?.value.trim();
    const orderId = document.getElementById("ticketOrderId")?.value.trim();
    const screenshot = document.getElementById("ticketScreenshot")?.files[0];

    if (!type || !subject || !message) {
        showFormMessage(supportT("validation.requiredFields", "Please fill all required fields."), "error");
        return;
    }

    try {
        setSubmitLoading(true);

        const formData = new FormData();

        formData.append("username", username);
        formData.append("type", type);
        formData.append("subject", subject);
        formData.append("message", message);

        if (orderId) formData.append("orderId", orderId);
        if (screenshot) formData.append("screenshot", screenshot);

        const res = await fetch(supportApiUrl("/api/support/ticket"), {
            method: "POST",
            headers: getSupportAuthHeaders(),
            body: formData
        });

        const data = await safeJson(res);

        if (!res.ok || !data.success) {
            showFormMessage(data.message || supportT("support.submitFailed", "Submit failed. Please try again."), "error");
            return;
        }

        showFormMessage(supportT("support.submitSuccess", "Support ticket submitted successfully."), "success");

        form?.reset();
        resetCategoryCards();

        await loadMyTickets();

    } catch (error) {
        console.log("Submit support error:", error);
        showFormMessage(supportT("common.serverErrorLater", "Server error. Please try again later."), "error");
    } finally {
        setSubmitLoading(false);
    }
}

function setSubmitLoading(isLoading) {
    const btn = document.getElementById("submitTicketBtn");
    if (!btn) return;

    if (window.AZIEL_UI?.button) {
        if (isLoading) {
            window.AZIEL_UI.button.setLoading(btn, { text: supportT("support.submitting", "Submitting...") });
        } else {
            window.AZIEL_UI.button.reset(btn);
        }
        return;
    }

    btn.disabled = isLoading;

    btn.innerHTML = isLoading
        ? `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHTML(supportT("support.submitting", "Submitting..."))}`
        : `<i class="fa-solid fa-paper-plane"></i> ${escapeHTML(supportT("support.submit", "Submit Ticket"))}`;
}

function resetCategoryCards() {
    document.querySelectorAll(".category-card").forEach(card => {
        card.classList.remove("active");
    });

    const first = document.querySelector('.category-card[data-type="order"]');
    if (first) first.classList.add("active");

    const select = document.getElementById("ticketType");
    if (select) select.value = "order";
}

function showFormMessage(text, type = "info") {
    const msg = document.getElementById("supportMsg");
    if (!msg) return;

    msg.innerText = text;
    msg.className = `support-msg ${type}`;

    const method = type === "success"
        ? "success"
        : type === "error"
            ? "error"
            : "info";

    window.AZIEL_UI?.toast?.[method]?.(text);
}

/* ===============================
   LOAD TICKETS
================================ */

async function loadMyTickets() {
    const username = getSupportUsername();
    const box = document.getElementById("myTickets");

    if (!box) return;

    if (!username) {
        box.innerHTML = renderEmptyState(
            supportT("support.loginFirst", "Please login first"),
            supportT("support.loginToView", "You need to login to view your support tickets.")
        );
        return;
    }

    try {
        if (window.AZIEL_UI?.state?.skeletonList) {
            window.AZIEL_UI.state.skeletonList(box, { rows: 2, lines: 2 });
        } else {
            box.innerHTML = renderTicketSkeleton();
        }

        const res = await fetch(
            supportApiUrl(`/api/support/my/${encodeURIComponent(username)}`),
            {
                headers: getSupportAuthHeaders()
            }
        );

        const data = await safeJson(res);

        if (!res.ok || !data.success || !Array.isArray(data.tickets) || !data.tickets.length) {
            allTickets = [];
            renderTickets();
            return;
        }

        allTickets = data.tickets;
        renderTickets();

    } catch (error) {
        console.log("Load tickets error:", error);

        if (window.AZIEL_UI?.state?.render) {
            window.AZIEL_UI.state.render(box, {
                type: "error",
                title: supportT("support.loadFailed", "Failed to load tickets"),
                message: supportT("common.checkConnection", "Please check your connection and try again later."),
                retry: loadMyTickets
            });
        } else {
            box.innerHTML = renderEmptyState(
                supportT("support.loadFailed", "Failed to load tickets"),
                supportT("common.checkConnection", "Please check your connection and try again later.")
            );
        }
    }
}

function renderTickets() {
    const box = document.getElementById("myTickets");
    if (!box) return;

    let tickets = Array.isArray(allTickets) ? allTickets : [];

    if (currentFilter !== "all") {
        tickets = tickets.filter(ticket =>
            normalizeStatus(ticket.status) === currentFilter
        );
    }

    if (!tickets.length) {
        if (window.AZIEL_UI?.state?.render) {
            window.AZIEL_UI.state.render(box, {
                type: "empty",
                title: supportT("support.noTickets", "No tickets found"),
                message: supportT("support.noTicketsHelp", "Your support tickets will appear here after you submit a ticket.")
            });
        } else {
            box.innerHTML = renderEmptyState(
                supportT("support.noTickets", "No tickets found"),
                supportT("support.noTicketsHelp", "Your support tickets will appear here after you submit a ticket.")
            );
        }
        return;
    }

    box.innerHTML = tickets.map(renderTicket).join("");
    window.AZIEL_MOTION?.enter(box, "fast");
}

/* ===============================
   RENDER TICKET
================================ */

function renderTicket(ticket) {
    const status = normalizeStatus(ticket.status);
    const type = ticket.type || "general";
    const screenshot = getTicketScreenshot(ticket);
    const createdAt = formatTicketDate(ticket.createdAt || ticket.updatedAt);

    return `
        <article class="ticket-item">

            <div class="ticket-top">

                <div>
                    <div class="ticket-title">
                        ${getTypeIcon(type)}
                        ${escapeHTML(ticket.subject || supportT("support.ticket", "Support Ticket"))}
                    </div>

                    <div class="ticket-meta">
                        ${escapeHTML(formatType(type))}
                        ${ticket.ticketId ? ` • ${escapeHTML(ticket.ticketId)}` : ""}
                        ${createdAt ? ` • ${escapeHTML(createdAt)}` : ""}
                    </div>
                </div>

                <span class="ticket-status ${escapeHTML(status)}">
                    ${escapeHTML(formatStatus(status))}
                </span>

            </div>

            ${ticket.orderId ? `
                <div class="ticket-meta">
                    <strong>${escapeHTML(supportT("support.orderId", "Order ID"))}:</strong> ${escapeHTML(ticket.orderId)}
                </div>
            ` : ""}

            <p class="ticket-message">
                ${escapeHTML(ticket.message || "")}
            </p>

            ${screenshot ? `
                <img
                    src="${escapeHTML(screenshot)}"
                    class="ticket-image"
                    onclick="window.open('${escapeHTML(screenshot)}', '_blank')"
                    alt="${escapeHTML(supportT("support.screenshotAlt", "Support screenshot"))}"
                >
            ` : ""}

            ${ticket.adminReply ? `
                <div class="ticket-reply">
                    <strong>${escapeHTML(supportT("support.adminReply", "Admin Reply"))}</strong>
                    <p>${escapeHTML(ticket.adminReply)}</p>
                </div>
            ` : ""}

        </article>
    `;
}

function renderEmptyState(title, text) {
    return `
        <div class="empty-tickets">
            <strong>${escapeHTML(title)}</strong>
            <p>${escapeHTML(text)}</p>
        </div>
    `;
}

function renderTicketSkeleton() {
    return `
        <div class="ticket-item">
            <div class="ticket-top">
                <div>
                    <div class="ticket-title">${escapeHTML(supportT("support.loadingTickets", "Loading tickets..."))}</div>
                    <div class="ticket-meta">${escapeHTML(supportT("common.pleaseWait", "Please wait"))}</div>
                </div>
            </div>
        </div>
        <div class="ticket-item">
            <div class="ticket-top">
                <div>
                    <div class="ticket-title">${escapeHTML(supportT("support.checkingStatus", "Checking ticket status..."))}</div>
                    <div class="ticket-meta">${escapeHTML(supportT("support.syncing", "Syncing support data"))}</div>
                </div>
            </div>
        </div>
    `;
}

/* ===============================
   HELPERS
================================ */

function getSupportUsername() {
    return (
        window.AZIEL?.user?.username ||
        localStorage.getItem("username") ||
        localStorage.getItem("azielUsername")
    );
}

async function safeJson(res) {
    try {
        return await res.json();
    } catch {
        return {};
    }
}

function getTicketScreenshot(ticket) {
    if (!ticket?.screenshot) return "";

    const value = String(ticket.screenshot || "").trim();
    const path = value.startsWith("http") || value.startsWith("/uploads")
        ? ticket.screenshot
        : `/uploads/support/${value}`;

    return normalizeUploadPath(path);
}

function normalizeUploadPath(path) {
    if (!path) return "";
    if (path.startsWith("http")) return path;

    if (location.port === "5500") {
        return `${location.protocol}//${location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost"}:3000${path}`;
    }

    return path;
}

function normalizeStatus(status) {
    const value = String(status || "").toLowerCase();

    if (!value) return "open";
    if (value === "pending") return "open";
    if (value === "answered") return "replied";
    if (value === "reply") return "replied";
    if (value === "done") return "solved";

    return value;
}

function getTypeIcon(type) {
    const icons = {
        order: `<i class="fa-solid fa-gamepad"></i>`,
        payment: `<i class="fa-solid fa-credit-card"></i>`,
        wallet: `<i class="fa-solid fa-wallet"></i>`,
        account: `<i class="fa-solid fa-user-shield"></i>`,
        general: `<i class="fa-solid fa-circle-question"></i>`
    };

    return icons[type] || icons.general;
}

function formatType(type) {
    const names = {
        order: supportT("support.type.order", "Order Issue"),
        payment: supportT("support.type.payment", "Payment Issue"),
        wallet: supportT("support.type.wallet", "Wallet Issue"),
        account: supportT("support.type.account", "Account Issue"),
        general: supportT("support.type.general", "General Help")
    };

    return names[type] || "General Help";
}

function formatStatus(status) {
    return supportT(`support.status.${normalizeStatus(status)}`, normalizeStatus(status));
}

function formatTicketDate(value) {
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

/* ===============================
   SOCKET
================================ */

function startSupportSocket() {
    if (supportSocketStarted) return;
    supportSocketStarted = true;

    const username = getSupportUsername();
    if (!username) return;

    const socket = getSupportSocket();
    if (!socket) return;

    socket.on("newNotification", data => {
        if (data?.title !== "Support Reply") return;

        showSupportPopup(data.message || supportT("support.adminReplied", "Admin replied to your ticket"));
        loadMyTickets();
    });

    socket.on("supportUpdated", data => {
        showSupportPopup(data?.message || supportT("support.ticketUpdated", "Your support ticket was updated"));
        loadMyTickets();
    });
}

function getSupportSocket() {
    if (window.AZIEL?.realtime) {
        return {
            on(eventName, handler) {
                window.AZIEL.realtime.on(eventName, handler);
            }
        };
    }

    if (typeof io === "undefined") {
        console.log("Socket.IO not loaded for support");
        return null;
    }

    console.log("Realtime client not loaded for support");
    return null;
}

function showSupportPopup(message) {
    window.AZIEL_UI?.toast?.info?.(message);

    const old = document.querySelector(".support-live-popup");
    if (old) old.remove();

    const popup = document.createElement("div");
    popup.className = "support-live-popup";
    popup.innerHTML = escapeHTML(message);

    document.body.appendChild(popup);
    window.AZIEL_MOTION?.enter(popup, "fast");

    setTimeout(() => {
        popup.classList.add("show");
    }, 80);

    setTimeout(() => {
        popup.classList.remove("show");

        setTimeout(() => {
            popup.remove();
        }, 350);
    }, 4500);
}

/* ===============================
   SECURITY
================================ */

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

window.loadMyTickets = loadMyTickets;
