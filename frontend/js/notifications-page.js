// frontend/js/notifications-page.js
// Notification Center consumes AZIEL_NOTIFICATIONS.

let activeNotificationFilter = "all";

const notificationFilters = [
    ["all", "All"],
    ["unread", "Unread"],
    ["promotions", "Promotions"],
    ["orders", "Orders"],
    ["payments", "Payments"],
    ["wallet", "Wallet"],
    ["support", "Support"],
    ["system", "System"]
];

document.addEventListener("DOMContentLoaded", () => {
    activeNotificationFilter = readFilterFromUrl();
    initNotificationPage();
});

function initNotificationPage() {
    renderNotificationFilters();
    bindNotificationPageActions();

    if (!window.AZIEL_NOTIFICATIONS) {
        renderNotificationError("Notification system is unavailable.");
        return;
    }

    window.AZIEL_NOTIFICATIONS.subscribe(renderNotificationPage);
    window.AZIEL_NOTIFICATIONS.init().then(() => {
        if (["promotions", "unread"].includes(activeNotificationFilter)) {
            window.AZIEL_NOTIFICATIONS.load({ force: true, filter: activeNotificationFilter });
        }
    });

    window.addEventListener("popstate", () => {
        activeNotificationFilter = readFilterFromUrl();
        renderNotificationFilters();
        loadFilterNotifications();
    });
}

function bindNotificationPageActions() {
    document.getElementById("markAllReadBtn")?.addEventListener("click", async event => {
        const btn = event.currentTarget;

        try {
            window.AZIEL_UI?.button?.setLoading(btn, { text: "Marking..." });
            await window.AZIEL_NOTIFICATIONS?.markAllRead();
            window.AZIEL_UI?.toast?.success("Notifications marked read.");
        } catch (error) {
            const message = window.AZIEL_UI?.error?.normalize?.(error, "Could not mark notifications read.") ||
                "Could not mark notifications read.";
            window.AZIEL_UI?.toast?.error(message);
        } finally {
            window.AZIEL_UI?.button?.reset(btn);
        }
    });

    document.getElementById("loadMoreNotificationsBtn")?.addEventListener("click", async event => {
        const btn = event.currentTarget;

        try {
            window.AZIEL_UI?.button?.setLoading(btn, { text: "Loading..." });
            await window.AZIEL_NOTIFICATIONS?.loadMore();
        } finally {
            window.AZIEL_UI?.button?.reset(btn);
        }
    });
}

function renderNotificationFilters() {
    const box = document.getElementById("notificationFilters");
    if (!box) return;

    box.setAttribute("role", "tablist");
    box.setAttribute("aria-label", "Notification filters");

    box.innerHTML = notificationFilters.map(([key, label]) => `
        <button class="noti-filter ${key === activeNotificationFilter ? "active" : ""}" type="button" data-filter="${key}" role="tab" aria-selected="${key === activeNotificationFilter ? "true" : "false"}" aria-controls="notificationsList" tabindex="${key === activeNotificationFilter ? "0" : "-1"}">
            ${escapeHTML(label)}
        </button>
    `).join("");

    box.querySelectorAll(".noti-filter").forEach(btn => {
        btn.addEventListener("click", () => {
            activateNotificationFilter(btn.dataset.filter || "all");
        });

        btn.addEventListener("keydown", event => {
            if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const buttons = Array.from(box.querySelectorAll(".noti-filter"));
            const index = buttons.indexOf(btn);
            let nextIndex = index;

            if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
            if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
            if (event.key === "Home") nextIndex = 0;
            if (event.key === "End") nextIndex = buttons.length - 1;

            const nextFilter = buttons[nextIndex]?.dataset.filter || "all";
            activateNotificationFilter(nextFilter, { focus: true });
        });
    });
}

function activateNotificationFilter(filter, options = {}) {
    activeNotificationFilter = filter || "all";
    writeFilterToUrl(activeNotificationFilter);
    renderNotificationFilters();
    loadFilterNotifications();

    if (options.focus) {
        requestAnimationFrame(() => {
            document.querySelector(`.noti-filter[data-filter="${CSS.escape(activeNotificationFilter)}"]`)?.focus({ preventScroll: true });
        });
    }
}

function loadFilterNotifications() {
    if (["promotions", "unread"].includes(activeNotificationFilter)) {
        window.AZIEL_NOTIFICATIONS?.load?.({ force: true, filter: activeNotificationFilter });
        return;
    }

    window.AZIEL_NOTIFICATIONS?.load?.({ force: true, filter: "all" });
}

function renderNotificationPage(state) {
    const list = document.getElementById("notificationsList");
    const unread = document.getElementById("notificationUnreadContext");
    const loadMore = document.getElementById("loadMoreNotificationsBtn");

    if (unread) {
        const count = Number(state.unreadCount || 0);
        unread.textContent = count === 1
            ? "1 unread notification"
            : `${count.toLocaleString()} unread notifications`;
    }

    if (!list) return;

    if (state.loading && !state.notifications?.length) {
        if (window.AZIEL_UI?.state?.skeletonList) {
            window.AZIEL_UI.state.skeletonList(list, { rows: 5, lines: 3 });
        } else {
            list.innerHTML = renderNotificationSkeleton();
        }
        return;
    }

    if (state.error) {
        renderNotificationError(state.error);
        return;
    }

    const filtered = filterNotifications(state.notifications || []);

    if (!filtered.length) {
        if (window.AZIEL_UI?.state?.render) {
            window.AZIEL_UI.state.render(list, {
                type: "empty",
                title: activeNotificationFilter === "all" ? "No notifications yet" : "No matching notifications",
                message: "Order, wallet, payment, support and system updates will appear here."
            });
        } else {
            list.innerHTML = `
                <div class="noti-empty-state">
                    <i class="fa-regular fa-bell"></i>
                    <h2>${activeNotificationFilter === "all" ? "No notifications yet" : "No matching notifications"}</h2>
                    <p>Order, wallet, payment, support and system updates will appear here.</p>
                </div>
            `;
        }
    } else {
        list.innerHTML = filtered.map(renderNotificationItem).join("");
        window.AZIEL_MOTION?.enter(list, "fast");
    }

    bindNotificationItems();

    if (loadMore) {
        loadMore.hidden = !state.pagination?.hasMore;
        loadMore.disabled = Boolean(state.loading);
        loadMore.textContent = state.loading ? "Loading..." : "Load More";
    }
}

function filterNotifications(notifications) {
    if (activeNotificationFilter === "all") return notifications;
    if (activeNotificationFilter === "unread") {
        return notifications.filter(item => !item.read);
    }

    return notifications.filter(item => {
        if (activeNotificationFilter === "system") {
            return ["system", "announcements", "security"].includes(item.category);
        }

        return item.category === activeNotificationFilter;
    });
}

function renderNotificationItem(item) {
    const action = getSafeAction(item.action);

    return `
        <article class="noti-card ${item.read ? "" : "unread"}" data-id="${escapeHTML(item.id)}">
            <div class="noti-icon">${getCategoryIcon(item.category, item.type)}</div>

            <div class="noti-content">
                <div class="noti-card-head">
                    <span class="noti-category">${escapeHTML(formatCategory(item.category))}</span>
                    <time>${escapeHTML(formatNotificationTime(item.createdAt))}</time>
                </div>

                <h2>${escapeHTML(formatPaymentText(item.title))}</h2>
                <p>${escapeHTML(formatPaymentText(item.message))}</p>
                ${renderPromotionMeta(item)}

                <div class="noti-card-actions">
                    ${action ? `
                        <a class="noti-action-link" href="${escapeHTML(action.url)}" data-action-read="${escapeHTML(item.id)}"${action.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>
                            ${escapeHTML(action.label || "Open")}
                        </a>
                    ` : ""}

                    ${item.read ? `
                        <span class="noti-read-state">Read</span>
                    ` : `
                        <button class="noti-read-btn" type="button" data-mark-read="${escapeHTML(item.id)}">
                            Mark read
                        </button>
                    `}
                </div>
            </div>
        </article>
    `;
}

function renderPromotionMeta(item = {}) {
    if (item.category !== "promotions") return "";

    const metadata = item.metadata || {};
    const range = formatPromotionRange(metadata.startsAt, metadata.endsAt);
    const promoCode = metadata.promoCode || "";

    return `
        <div class="noti-promo-meta">
            ${range ? `<span>${escapeHTML(range)}</span>` : ""}
            ${promoCode ? `
                <button type="button" class="noti-promo-code" data-copy-promo="${escapeHTML(promoCode)}">
                    ${escapeHTML(promoCode)}
                </button>
            ` : ""}
            ${item.status === "expired" ? `<span>Expired</span>` : ""}
        </div>
    `;
}

function bindNotificationItems() {
    document.querySelectorAll("[data-mark-read]").forEach(btn => {
        btn.addEventListener("click", () => {
            window.AZIEL_NOTIFICATIONS?.markRead(btn.dataset.markRead);
            window.AZIEL_MOTION?.emphasize(btn.closest(".noti-card"), "updated");
        });
    });

    document.querySelectorAll("[data-action-read]").forEach(link => {
        link.addEventListener("click", () => {
            window.AZIEL_NOTIFICATIONS?.markRead(link.dataset.actionRead);
            window.AZIEL_MOTION?.emphasize(link.closest(".noti-card"), "updated");
        });
    });

    document.querySelectorAll("[data-copy-promo]").forEach(btn => {
        btn.addEventListener("click", async event => {
            event.stopPropagation();
            const code = btn.dataset.copyPromo || "";
            try {
                await navigator.clipboard?.writeText?.(code);
                window.AZIEL_UI?.toast?.success?.("Promo code copied.");
            } catch (error) {
                window.AZIEL_UI?.toast?.info?.(code);
            }
        });
    });
}

function getSafeAction(action) {
    if (!action?.url) return null;

    const url = String(action.url || "");

    if (/^\s*javascript:/i.test(url)) return null;
    if (!url.startsWith("/") && !/^[a-z0-9_-]+\.html/i.test(url) && !/^https?:\/\//i.test(url)) return null;

    return {
        label: action.label || "Open",
        url,
        external: /^https?:\/\//i.test(url)
    };
}

function formatPaymentText(value) {
    return window.AZIEL_PAYMENT_DISPLAY?.replaceInText?.(value) || value || "";
}

function getCategoryIcon(category, type) {
    if (category === "orders" || type === "order") return '<i class="fa-solid fa-box"></i>';
    if (category === "payments") return '<i class="fa-solid fa-credit-card"></i>';
    if (category === "wallet") return '<i class="fa-solid fa-wallet"></i>';
    if (category === "support") return '<i class="fa-solid fa-headset"></i>';
    if (category === "promotions") return '<i class="fa-solid fa-gift"></i>';
    if (category === "announcements") return '<i class="fa-solid fa-bullhorn"></i>';
    return '<i class="fa-regular fa-bell"></i>';
}

function formatCategory(category) {
    return {
        orders: "Orders",
        payments: "Payments",
        wallet: "Wallet",
        support: "Support",
        announcements: "Announcement",
        promotions: "Promotion",
        security: "Security",
        system: "System"
    }[category] || "Notification";
}

function renderNotificationSkeleton() {
    return Array.from({ length: 5 }).map(() => `
        <div class="noti-card skeleton">
            <div class="noti-icon"></div>
            <div class="noti-content">
                <span></span>
                <h2></h2>
                <p></p>
            </div>
        </div>
    `).join("");
}

function renderNotificationError(message) {
    const list = document.getElementById("notificationsList");
    if (!list) return;

    if (window.AZIEL_UI?.state?.render) {
        window.AZIEL_UI.state.render(list, {
            type: "error",
            title: "Could not load notifications",
            message: message || "Please try again.",
            retry: () => window.AZIEL_NOTIFICATIONS?.init?.()
        });
        return;
    }

    list.innerHTML = `
        <div class="noti-empty-state error">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <h2>Could not load notifications</h2>
            <p>${escapeHTML(message || "Please try again.")}</p>
        </div>
    `;
}

function formatNotificationTime(date) {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return "";

    return parsed.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatPromotionRange(startsAt, endsAt) {
    const start = formatShortDate(startsAt);
    const end = formatShortDate(endsAt);
    if (start && end) return `${start} - ${end}`;
    if (end) return `Ends ${end}`;
    if (start) return `Starts ${start}`;
    return "";
}

function formatShortDate(value) {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleDateString([], {
        month: "short",
        day: "numeric"
    });
}

function readFilterFromUrl() {
    const raw = new URLSearchParams(window.location.search).get("filter") || "all";
    return notificationFilters.some(([key]) => key === raw) ? raw : "all";
}

function writeFilterToUrl(filter) {
    const url = new URL(window.location.href);
    if (filter && filter !== "all") {
        url.searchParams.set("filter", filter);
    } else {
        url.searchParams.delete("filter");
    }
    window.history.pushState({ filter }, "", url);
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
