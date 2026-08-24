// frontend/js/admin-wallet.js
// AZIEL Admin V2.5 Wallet Command Center

let adminWalletInitialized = false;
let currentWalletContext = {};
let currentWalletView = "pending";
let allWalletTopups = [];
let selectedTopupId = "";
let selectedTopupContext = null;
let walletTransactionPage = 1;
let walletTransactionTotalPages = 1;
let walletRefreshTimer = null;
let walletQueueSearchTimer = null;
const adminWalletPaging = {
    topups: {
        limit: 50,
        nextCursor: "",
        hasMore: false,
        loadingMore: false,
        requestId: 0
    },
    transactions: {
        limit: 50,
        nextCursor: "",
        hasMore: false,
        cursorStack: [""],
        requestId: 0
    }
};

document.addEventListener("DOMContentLoaded", () => {
    initAdminWalletController();
});

function initAdminWalletController() {
    if (adminWalletInitialized) return;
    adminWalletInitialized = true;

    initSlipZoom();
    bindWalletTabs();
    bindWalletQueueFilters();
    bindWalletTransactions();
    bindWalletAdjustment();
    bindWalletRealtime();

    if (isAdminSectionActive("wallet") || !document.getElementById("section-wallet")) {
        currentWalletContext = getAdminHashContext("wallet");
        applyWalletContext(currentWalletContext);
        loadWalletView();
    }

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "wallet") {
            currentWalletContext = event.detail.context || {};
            applyWalletContext(currentWalletContext);
            loadWalletView();
        }
    });

    window.addEventListener("aziel:admin-locale-changed", () => {
        renderWalletTopups(allWalletTopups);
        renderSelectedTopup();
    });
}

function bindWalletTabs() {
    document.querySelectorAll(".wallet-command-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            currentWalletView = btn.dataset.walletView || "pending";
            selectedTopupId = "";
            selectedTopupContext = null;
            resetWalletTransactionPaging();
            updateWalletHash();
        });
    });
}

function bindWalletQueueFilters() {
    document.getElementById("walletQueueSearch")?.addEventListener("input", () => {
        clearTimeout(walletQueueSearchTimer);
        walletQueueSearchTimer = setTimeout(() => {
            selectedTopupId = "";
            selectedTopupContext = null;
            loadWalletTopups(true);
        }, 250);
    });

    ["walletQueueRegion", "walletQueueCurrency", "walletQueuePaymentMethod", "walletQueueSort"].forEach(id => {
        document.getElementById(id)?.addEventListener("change", () => {
            selectedTopupId = "";
            selectedTopupContext = null;
            loadWalletTopups(true);
        });
    });
}

function bindWalletTransactions() {
    document.getElementById("walletTransactionSearchBtn")?.addEventListener("click", () => {
        resetWalletTransactionPaging();
        loadWalletTransactions();
    });

    document.getElementById("walletTransactionSearch")?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            resetWalletTransactionPaging();
            loadWalletTransactions();
        }
    });

    document.getElementById("walletTransactionType")?.addEventListener("change", () => {
        resetWalletTransactionPaging();
        loadWalletTransactions();
    });

    document.getElementById("walletTransactionCurrency")?.addEventListener("change", () => {
        resetWalletTransactionPaging();
        loadWalletTransactions();
    });

    document.getElementById("walletPrevPage")?.addEventListener("click", () => {
        if (walletTransactionPage <= 1) return;
        adminWalletPaging.transactions.cursorStack.pop();
        adminWalletPaging.transactions.nextCursor = "";
        walletTransactionPage = Math.max(walletTransactionPage - 1, 1);
        loadWalletTransactions();
    });

    document.getElementById("walletNextPage")?.addEventListener("click", () => {
        if (!adminWalletPaging.transactions.hasMore) return;
        adminWalletPaging.transactions.cursorStack[walletTransactionPage] = adminWalletPaging.transactions.nextCursor;
        walletTransactionPage += 1;
        loadWalletTransactions();
    });
}

function resetWalletTransactionPaging() {
    walletTransactionPage = 1;
    walletTransactionTotalPages = 1;
    adminWalletPaging.transactions.nextCursor = "";
    adminWalletPaging.transactions.hasMore = false;
    adminWalletPaging.transactions.cursorStack = [""];
}

function bindWalletAdjustment() {
    document.getElementById("walletAdjustSubmitBtn")?.addEventListener("click", submitWalletAdjustment);
}

function bindWalletRealtime() {
    if (window.AZIEL?.realtime) {
        ["admin:wallet-updated", "wallet:updated", "wallet:topup-updated", "adminNewUpdate"].forEach(eventName => {
            window.AZIEL.realtime.on(eventName, scheduleWalletRefresh, { role: "admin" });
        });
    }
}

function scheduleWalletRefresh() {
    if (!isAdminSectionActive("wallet")) return;
    clearTimeout(walletRefreshTimer);
    walletRefreshTimer = setTimeout(() => loadWalletView(false), 900);
}

function applyWalletContext(context = {}) {
    if (context.view) {
        currentWalletView = context.view;
    } else if (context.status === "pending") {
        currentWalletView = "pending";
    }

    if (!["pending", "approved", "rejected", "transactions", "adjustments"].includes(currentWalletView)) {
        currentWalletView = "pending";
    }
}

function loadWalletView(showLoading = true) {
    syncWalletTabs();

    document.querySelectorAll(".wallet-view-panel").forEach(panel => panel.classList.remove("active"));
    document.getElementById(currentWalletView === "transactions"
        ? "walletTransactionsWorkspace"
        : currentWalletView === "adjustments"
            ? "walletAdjustmentWorkspace"
            : "walletTopupWorkspace")?.classList.add("active");

    if (currentWalletView === "transactions") {
        loadWalletTransactions(showLoading);
        renderSelectedTopup();
        return;
    }

    if (currentWalletView === "adjustments") {
        renderAdjustmentDetail();
        return;
    }

    loadWalletTopups(showLoading);
}

async function loadWalletTopups(showLoading = true, options = {}) {
    const box = document.getElementById("adminWalletList");
    if (!box) return;

    const paging = adminWalletPaging.topups;
    const append = Boolean(options.append);
    if (append && (paging.loadingMore || !paging.hasMore)) return;
    if (!append) {
        paging.nextCursor = "";
        paging.hasMore = false;
    }
    paging.loadingMore = append;
    const requestId = ++paging.requestId;

    if (showLoading && !append) {
        box.innerHTML = `<div class="admin-dashboard-skeleton"></div><div class="admin-dashboard-skeleton"></div>`;
    } else if (append) {
        renderWalletTopups(allWalletTopups);
    }

    try {
        const data = await adminFetch(buildWalletTopupsEndpoint(append ? paging.nextCursor : ""));
        if (requestId !== paging.requestId) return;

        if (!data || !data.success) {
            renderWalletError(data?.message || adminT("something_went_wrong"));
            return;
        }

        const incoming = Array.isArray(data.topups) ? data.topups : Array.isArray(data.items) ? data.items : [];
        allWalletTopups = append ? mergeWalletTopups(allWalletTopups, incoming) : incoming;
        paging.hasMore = Boolean(data.pagination?.hasMore);
        paging.nextCursor = data.pagination?.nextCursor || "";
        reconcileSelectedTopup();
        renderWalletTopups(allWalletTopups);
        await loadSelectedTopupContext();
    } catch (error) {
        console.log("Wallet topup load error:", error);
        renderWalletError(adminT("something_went_wrong"));
    } finally {
        if (requestId === paging.requestId) {
            paging.loadingMore = false;
            renderWalletTopups(allWalletTopups);
        }
    }
}

function buildWalletTopupsEndpoint(cursor = "") {
    const params = new URLSearchParams();
    params.set("limit", String(adminWalletPaging.topups.limit));
    if (currentWalletView === "pending") params.set("status", "pending");
    if (currentWalletView === "approved") params.set("status", "approved");
    if (currentWalletView === "rejected") params.set("status", "rejected");
    const q = document.getElementById("walletQueueSearch")?.value?.trim() || "";
    const region = document.getElementById("walletQueueRegion")?.value || "";
    const currency = document.getElementById("walletQueueCurrency")?.value || "";
    const paymentMethod = document.getElementById("walletQueuePaymentMethod")?.value || "";
    const sort = document.getElementById("walletQueueSort")?.value || "newest";
    if (cursor) params.set("cursor", cursor);
    if (q) params.set("q", q);
    if (region) params.set("region", region);
    if (currency) params.set("currency", currency);
    if (paymentMethod) params.set("paymentMethod", paymentMethod);
    params.set("sort", sort);
    const query = params.toString();
    return query ? `/api/admin/wallet/topups?${query}` : "/api/admin/wallet/topups";
}

function mergeWalletTopups(current = [], incoming = []) {
    const seen = new Set(current.map(item => String(item._id)));
    const merged = current.slice();
    incoming.forEach(item => {
        const id = String(item._id || "");
        if (!id || seen.has(id)) return;
        seen.add(id);
        merged.push(item);
    });
    return merged;
}

function reconcileSelectedTopup() {
    if (selectedTopupId && allWalletTopups.some(item => String(item._id) === String(selectedTopupId))) return;
    selectedTopupId = allWalletTopups[0]?._id || "";
    selectedTopupContext = null;
}

function renderWalletTopups(topups) {
    const box = document.getElementById("adminWalletList");
    if (!box) return;
    const listScrollTop = box.scrollTop;

    if (!topups.length) {
        box.innerHTML = `
            <div class="admin-empty-box wallet-empty-state">
                ${escapeHTML(currentWalletView === "pending" ? adminT("no_pending_wallet_topups") : "No wallet records match this queue.")}
            </div>
        `;
        return;
    }

    const rows = topups.map(item => {
        const selected = String(item._id) === String(selectedTopupId);
        const status = String(item.status || "pending").toLowerCase();
        const evidence = item.hasPaymentEvidence ? adminT("slip_attached") : adminT("no_payment_evidence");

        return `
            <button class="wallet-queue-row ${selected ? "active" : ""}" type="button" data-id="${escapeHTML(item._id)}">
                <span class="wallet-row-customer">
                    <strong>${escapeHTML(item.username || "-")}</strong>
                    <small>${escapeHTML(item.region || "-")} · ${escapeHTML(item.topupId || "-")}</small>
                </span>
                <span class="wallet-row-amount">
                    <b>${Number(item.amount || 0).toLocaleString()} ${escapeHTML(item.currency || "")}</b>
                    <small>${escapeHTML(formatPaymentName(item.paymentMethod || "-"))}</small>
                </span>
                <span class="admin-status ${escapeHTML(normalizeTopupStatus(status))}">
                    ${escapeHTML(formatTopupStatus(status))}
                </span>
                <span class="wallet-row-time">
                    <b>${escapeHTML(formatRelativeTime(item.createdAt))}</b>
                    <small>${escapeHTML(evidence)}</small>
                </span>
            </button>
        `;
    }).join("");

    const paging = adminWalletPaging.topups;
    const loadMore = paging.hasMore ? `
        <button class="admin-load-more-btn" type="button" id="walletTopupsLoadMoreBtn" ${paging.loadingMore ? "disabled" : ""}>
            ${escapeHTML(paging.loadingMore ? adminT("loading") : adminT("load_more", "Load More"))}
        </button>
    ` : "";

    box.innerHTML = rows + loadMore;
    box.scrollTop = listScrollTop;

    box.querySelectorAll(".wallet-queue-row").forEach(row => {
        row.addEventListener("click", async () => {
            selectedTopupId = row.dataset.id || "";
            selectedTopupContext = null;
            renderWalletTopups(allWalletTopups);
            await loadSelectedTopupContext();
            window.AZIEL_ADMIN_LAYOUT?.showDetail?.("wallet");
        });
    });

    document.getElementById("walletTopupsLoadMoreBtn")?.addEventListener("click", () => loadWalletTopups(false, { append: true }));
}

async function loadSelectedTopupContext() {
    if (!selectedTopupId) {
        selectedTopupContext = null;
        renderSelectedTopup();
        return;
    }

    try {
        const data = await adminFetch(`/api/admin/wallet/topups/${encodeURIComponent(selectedTopupId)}/context`);
        if (!data?.success) {
            selectedTopupContext = null;
            renderSelectedTopup(data?.message || adminT("something_went_wrong"));
            return;
        }

        selectedTopupContext = data;
        renderSelectedTopup();
    } catch (error) {
        console.log("Wallet context load error:", error);
        selectedTopupContext = null;
        renderSelectedTopup(adminT("something_went_wrong"));
    }
}

function renderSelectedTopup(errorMessage = "") {
    const panel = document.getElementById("adminWalletDetailPanel");
    if (!panel) return;

    if (currentWalletView === "transactions") {
        panel.innerHTML = `<div class="order-detail-empty"><strong>${escapeHTML(adminT("transaction_ledger"))}</strong></div>`;
        return;
    }

    if (currentWalletView === "adjustments") {
        renderAdjustmentDetail();
        return;
    }

    if (errorMessage) {
        panel.innerHTML = `<div class="admin-dashboard-error"><strong>${escapeHTML(errorMessage)}</strong></div>`;
        return;
    }

    const topup = selectedTopupContext?.topup;
    const wallet = selectedTopupContext?.wallet;
    const customerSummary = selectedTopupContext?.customerSummary || {};
    const transactions = selectedTopupContext?.recentTransactions || [];
    const notes = selectedTopupContext?.notes || [];

    if (!topup) {
        panel.innerHTML = `<div class="order-detail-empty"><strong>${escapeHTML(adminT("select_topup_to_review"))}</strong></div>`;
        return;
    }

    const currency = topup.currency || "MMK";
    const currentBalance = Number(wallet?.wallet?.[currency] || 0);
    const expectedBalance = currentBalance + Number(topup.amount || 0);

    panel.innerHTML = `
        <div class="wallet-review-sticky">
            <div class="order-detail-head wallet-review-head">
                <div>
                    <button class="admin-mobile-back-btn" type="button" data-mobile-back="wallet">
                        ← ${escapeHTML(adminT("back_to_wallet", "Wallet"))}
                    </button>
                    <span>${escapeHTML(adminT("topup_review"))}</span>
                    <h3>${escapeHTML(topup.topupId || "-")}</h3>
                </div>
                <div class="wallet-review-head-meta">
                    <strong>${Number(topup.amount || 0).toLocaleString()} ${escapeHTML(currency)}</strong>
                    <span class="admin-status ${escapeHTML(normalizeTopupStatus(topup.status))}">
                        ${escapeHTML(formatTopupStatus(topup.status))}
                    </span>
                </div>
            </div>
            ${renderTopupActions(topup, currentBalance, expectedBalance)}
        </div>

        <div class="wallet-review-scroll">
            <section class="order-detail-section wallet-customer-summary">
                <h4>Customer Summary</h4>
                <div class="wallet-summary-grid">
                    ${renderWalletSummaryItem("Customer Name", customerSummary.displayName || topup.username)}
                    ${renderWalletSummaryItem("Region", customerSummary.region || topup.region || wallet?.region || "-")}
                    ${renderWalletSummaryItem("Wallet Balance", `${currentBalance.toLocaleString()} ${currency}`)}
                    ${renderWalletSummaryItem("Total Spend MMK", formatMoney(customerSummary.totalSpend?.MMK, "MMK"))}
                    ${renderWalletSummaryItem("Total Spend THB", formatMoney(customerSummary.totalSpend?.THB, "THB"))}
                    ${renderWalletSummaryItem("Orders", Number(customerSummary.totalOrders || 0).toLocaleString())}
                    ${renderWalletSummaryItem("Member Since", formatDate(customerSummary.memberSince))}
                    ${renderWalletSummaryItem("Reward Tags", renderWalletTags(customerSummary.tags || []), true)}
                </div>
            </section>

            <section class="order-detail-section">
                <h4>Payment Evidence</h4>
                ${renderTopupEvidence(topup)}
            </section>

            <section class="order-detail-section">
                <h4>Timeline</h4>
                ${renderWalletTimeline(topup, transactions)}
            </section>

            <section class="order-detail-section">
                <h4>Private Notes</h4>
                ${renderWalletReviewNotes(notes)}
            </section>

            <section class="order-detail-section">
                <h4>${escapeHTML(adminT("topup_request"))}</h4>
                <div class="wallet-summary-grid">
                    ${renderWalletSummaryItem(adminT("payment_method"), formatPaymentName(topup.paymentMethod))}
                    ${renderWalletSummaryItem(adminT("reference"), topup.transactionId || topup.topupId || "-")}
                    ${renderWalletSummaryItem(adminT("created"), formatDate(topup.createdAt))}
                    ${renderWalletSummaryItem(adminT("updated"), formatDate(topup.updatedAt))}
                </div>
            </section>
        </div>
    `;

    panel.querySelector('[data-mobile-back="wallet"]')?.addEventListener("click", () => {
        window.AZIEL_ADMIN_LAYOUT?.showList?.("wallet");
    });
    bindTopupDetailActions(panel, topup, currentBalance, expectedBalance);
}

function renderWalletSummaryItem(label, value, raw = false) {
    return `
        <div>
            <span>${escapeHTML(label)}</span>
            <strong>${raw ? value : escapeHTML(value || "-")}</strong>
        </div>
    `;
}

function renderWalletTags(tags = []) {
    if (!tags.length) return escapeHTML("None");
    return `<span class="customer-tags">${tags.map(tag => `<em>${escapeHTML(tag)}</em>`).join("")}</span>`;
}

function renderTopupActions(topup, currentBalance, expectedBalance) {
    if (String(topup.status || "") !== "pending") {
        return `<div class="order-action-row muted">${escapeHTML(adminT("view_details_only"))}</div>`;
    }

    return `
        <div class="order-action-row">
            <button class="order-primary-action" type="button" data-wallet-action="approve">
                ${escapeHTML(adminT("approve_topup"))}
            </button>
            <details class="admin-mobile-action-overflow" ${window.AZIEL_ADMIN_LAYOUT?.isMobile?.() ? "" : "open"}>
                <summary aria-label="More wallet actions"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i><span>More</span></summary>
                <div class="admin-mobile-action-menu">
                    <button class="order-danger-action" type="button" data-wallet-action="reject">
                        ${escapeHTML(adminT("reject_topup"))}
                    </button>
                </div>
            </details>
            <small class="wallet-expected-balance">
                ${escapeHTML(adminT("expected_balance"))}: ${expectedBalance.toLocaleString()} ${escapeHTML(topup.currency || "")}
            </small>
        </div>
    `;
}

function renderWalletDetailSection(titleKey, rows) {
    return `
        <section class="order-detail-section">
            <h4>${escapeHTML(adminT(titleKey))}</h4>
            ${rows.map(([labelKey, value]) => `
                <p>
                    <span>${escapeHTML(adminT(labelKey))}</span>
                    <b>${escapeHTML(value || "-")}</b>
                </p>
            `).join("")}
        </section>
    `;
}

function renderTopupEvidence(topup) {
    const url = getTopupEvidenceUrl(topup);
    if (!url) return `<div class="order-evidence-empty">${escapeHTML(adminT("no_payment_evidence"))}</div>`;
    if (isAdminUploadedImageFailed(url)) return `<div class="order-evidence-empty">${escapeHTML(adminT("payment_evidence_unavailable"))}</div>`;

    return `
        <div class="order-evidence-preview wallet-slip-viewer">
            <img src="${escapeHTML(url)}" data-src="${escapeHTML(url)}" alt="${escapeHTML(adminT("payment_evidence"))}" onerror="handleAdminWalletImageError(this)">
            <div class="wallet-slip-actions">
                <button type="button" data-wallet-action="view-evidence" data-src="${escapeHTML(url)}">Zoom</button>
                <a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Open Full Size</a>
                <a href="${escapeHTML(url)}" download>Download</a>
                <button type="button" data-wallet-action="fit-width">Fit Width</button>
                <button type="button" data-wallet-action="fit-height">Fit Height</button>
            </div>
        </div>
    `;
}

function renderWalletTimeline(topup, transactions = []) {
    const rows = [
        { label: "Created", date: topup.createdAt },
        { label: "Slip Uploaded", date: topup.paymentEvidence?.uploadedAt || (topup.hasPaymentEvidence ? topup.updatedAt : null) },
        { label: "Reviewed", date: ["approved", "rejected"].includes(String(topup.status || "")) ? topup.updatedAt : null },
        { label: "Approved", date: String(topup.status || "") === "approved" ? topup.updatedAt : null },
        { label: "Rejected", date: String(topup.status || "") === "rejected" ? topup.updatedAt : null },
        { label: "Credited", date: transactions.find(item => String(item.type || "").includes("topup"))?.createdAt || null }
    ].filter(item => item.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (!rows.length) return `<div class="order-evidence-empty">No wallet timeline yet.</div>`;

    return `
        <div class="wallet-review-timeline">
            ${rows.map(item => `
                <div>
                    <i></i>
                    <span>${escapeHTML(item.label)}</span>
                    <time>${escapeHTML(formatDate(item.date))}</time>
                </div>
            `).join("")}
        </div>
    `;
}

function renderWalletReviewNotes(notes = []) {
    return `
        <form id="walletReviewNoteForm" class="customer-note-form">
            <textarea id="walletReviewNoteInput" rows="3" placeholder="Add a private wallet review note"></textarea>
            <button class="admin-primary-btn" type="submit">Add Note</button>
        </form>
        ${notes.length ? `<div class="customer-notes-list">${notes.map(note => `
            <article class="customer-note-card">
                <textarea data-wallet-note-body="${escapeHTML(note._id)}">${escapeHTML(note.body)}</textarea>
                <div>
                    <span>${escapeHTML(note.adminName || "Admin")} · ${escapeHTML(formatDate(note.createdAt))}</span>
                    <button class="admin-secondary-btn" type="button" data-save-wallet-note="${escapeHTML(note._id)}">Save</button>
                    <button class="admin-danger-btn" type="button" data-delete-wallet-note="${escapeHTML(note._id)}">Delete</button>
                </div>
            </article>
        `).join("")}</div>` : `<div class="order-evidence-empty">No private notes yet.</div>`}
    `;
}

function renderRecentTransactions(transactions) {
    if (!transactions.length) {
        return `<div class="order-evidence-empty">${escapeHTML(adminT("no_wallet_transactions_found"))}</div>`;
    }

    return `
        <div class="wallet-context-transactions">
            ${transactions.map(renderTransactionRow).join("")}
        </div>
    `;
}

function renderTransactionRow(item) {
    const direction = getTransactionDirection(item);
    const sign = direction === "debit" ? "-" : "+";
    const amountClass = direction === "debit" ? "debit" : "credit";

    return `
        <div class="wallet-transaction-row">
            <span>
                <strong>${escapeHTML(formatWalletType(item.type))}</strong>
                <small>${escapeHTML(item.transactionId || item.referenceId || "-")}</small>
            </span>
            <b class="${amountClass}">${sign}${Number(item.amount || 0).toLocaleString()} ${escapeHTML(item.currency || "")}</b>
            <small>
                ${escapeHTML(adminT("balance_before"))}: ${escapeHTML(formatRecordedBalance(item.balanceBefore, item.currency))}
                · ${escapeHTML(adminT("balance_after"))}: ${escapeHTML(formatRecordedBalance(item.balanceAfter, item.currency))}
                · ${escapeHTML(formatDate(item.createdAt))}
            </small>
        </div>
    `;
}

function bindTopupDetailActions(panel, topup, currentBalance, expectedBalance) {
    panel.querySelector('[data-wallet-action="view-evidence"]')?.addEventListener("click", event => {
        openSlipModal(event.currentTarget.dataset.src || "");
    });
    panel.querySelector('[data-wallet-action="fit-width"]')?.addEventListener("click", () => {
        panel.querySelector(".wallet-slip-viewer")?.classList.remove("fit-height");
        panel.querySelector(".wallet-slip-viewer")?.classList.add("fit-width");
    });
    panel.querySelector('[data-wallet-action="fit-height"]')?.addEventListener("click", () => {
        panel.querySelector(".wallet-slip-viewer")?.classList.remove("fit-width");
        panel.querySelector(".wallet-slip-viewer")?.classList.add("fit-height");
    });

    panel.querySelector('[data-wallet-action="approve"]')?.addEventListener("click", event => {
        approveTopup(topup, currentBalance, expectedBalance, event.currentTarget);
    });

    panel.querySelector('[data-wallet-action="reject"]')?.addEventListener("click", event => {
        rejectTopup(topup, event.currentTarget);
    });
    panel.querySelector("#walletReviewNoteForm")?.addEventListener("submit", async event => {
        event.preventDefault();
        const input = document.getElementById("walletReviewNoteInput");
        const body = input?.value?.trim() || "";
        if (!body) return;
        const data = await adminFetch(`/api/admin/wallet/topups/${encodeURIComponent(topup._id)}/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body })
        });
        showAdminToast?.(data?.success ? "Note added" : data?.message || "Note could not be saved.", data?.success ? "success" : "error");
        if (data?.success) loadSelectedTopupContext();
    });
    panel.querySelectorAll("[data-save-wallet-note]").forEach(button => {
        button.addEventListener("click", () => saveWalletReviewNote(topup._id, button.dataset.saveWalletNote));
    });
    panel.querySelectorAll("[data-delete-wallet-note]").forEach(button => {
        button.addEventListener("click", () => deleteWalletReviewNote(topup._id, button.dataset.deleteWalletNote));
    });
}

async function saveWalletReviewNote(topupId, noteId) {
    const input = Array.from(document.querySelectorAll("[data-wallet-note-body]"))
        .find(item => item.dataset.walletNoteBody === noteId);
    const body = input?.value?.trim() || "";
    if (!body) return;
    const data = await adminFetch(`/api/admin/wallet/topups/${encodeURIComponent(topupId)}/notes/${encodeURIComponent(noteId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body })
    });
    showAdminToast?.(data?.success ? "Note saved" : data?.message || "Note update failed", data?.success ? "success" : "error");
    if (data?.success) loadSelectedTopupContext();
}

async function deleteWalletReviewNote(topupId, noteId) {
    const confirmed = await confirmWalletAction({
        title: "Delete note",
        message: "Delete this private wallet note?",
        confirmText: "Delete",
        danger: true
    });
    if (!confirmed) return;
    const data = await adminFetch(`/api/admin/wallet/topups/${encodeURIComponent(topupId)}/notes/${encodeURIComponent(noteId)}`, { method: "DELETE" });
    showAdminToast?.(data?.success ? "Note deleted" : data?.message || "Note delete failed", data?.success ? "success" : "error");
    if (data?.success) loadSelectedTopupContext();
}

async function approveTopup(topup, currentBalance, expectedBalance, btn) {
    const confirmed = await confirmWalletAction({
        title: adminT("approve_wallet_topup"),
        message: `${adminT("credit_this_amount")}\n\n${topup.username}\n${Number(topup.amount || 0).toLocaleString()} ${topup.currency}\n${adminT("current_balance")}: ${currentBalance.toLocaleString()} ${topup.currency}\n${adminT("expected_balance")}: ${expectedBalance.toLocaleString()} ${topup.currency}`,
        confirmText: adminT("approve_topup")
    });

    if (!confirmed) return;

    await updateTopupStatus(topup._id, "approved", btn);
}

async function rejectTopup(topup, btn) {
    const confirmed = await confirmWalletAction({
        title: adminT("reject_topup"),
        message: `${adminT("reject_topup")}?\n\n${topup.topupId || ""}\n${topup.username || ""}`,
        confirmText: adminT("reject_topup"),
        danger: true
    });

    if (!confirmed) return;

    await updateTopupStatus(topup._id, "rejected", btn);
}

async function updateTopupStatus(id, status, btn = null) {
    try {
        window.AZIEL_UI?.button?.setLoading(btn, { text: adminT("loading") });
        disableTopupActionButtons(true);

        const data = await adminFetch(`/api/admin/wallet/topups/${id}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
        });

        if (!data || !data.success) {
            showAdminToast?.(data?.message || adminT("something_went_wrong"), "error");
            return;
        }

        showAdminToast?.(status === "approved" ? adminT("topup_approved") : adminT("topup_rejected"), "success");
        dispatchWalletDashboardRefresh();
        await loadWalletTopups(false);
    } catch (error) {
        console.log("Wallet topup update error:", error);
        showAdminToast?.(adminT("something_went_wrong"), "error");
    } finally {
        disableTopupActionButtons(false);
        window.AZIEL_UI?.button?.reset(btn);
    }
}

function disableTopupActionButtons(disabled) {
    document.querySelectorAll('#adminWalletDetailPanel [data-wallet-action="approve"], #adminWalletDetailPanel [data-wallet-action="reject"]')
        .forEach(button => {
            button.disabled = disabled;
        });
}

async function loadWalletTransactions(showLoading = true) {
    const box = document.getElementById("adminWalletTransactions");
    if (!box) return;
    const paging = adminWalletPaging.transactions;
    const requestId = ++paging.requestId;

    if (showLoading) box.innerHTML = `<div class="admin-dashboard-skeleton"></div><div class="admin-dashboard-skeleton"></div>`;

    try {
        const data = await adminFetch(buildTransactionsEndpoint());
        if (requestId !== paging.requestId) return;

        if (!data?.success) {
            box.innerHTML = `<div class="admin-dashboard-error"><strong>${escapeHTML(data?.message || adminT("something_went_wrong"))}</strong></div>`;
            return;
        }

        paging.hasMore = Boolean(data.pagination?.hasMore);
        paging.nextCursor = data.pagination?.nextCursor || "";
        walletTransactionTotalPages = paging.hasMore ? walletTransactionPage + 1 : walletTransactionPage;
        renderWalletTransactions(data.transactions || data.items || []);
        updateWalletPagination();
    } catch (error) {
        console.log("Wallet transaction load error:", error);
        box.innerHTML = `<div class="admin-dashboard-error"><strong>${escapeHTML(adminT("something_went_wrong"))}</strong></div>`;
    }
}

function buildTransactionsEndpoint() {
    const params = new URLSearchParams();
    const q = document.getElementById("walletTransactionSearch")?.value.trim() || "";
    const type = document.getElementById("walletTransactionType")?.value || "";
    const currency = document.getElementById("walletTransactionCurrency")?.value || "";

    params.set("limit", adminWalletPaging.transactions.limit);
    const cursor = adminWalletPaging.transactions.cursorStack[walletTransactionPage - 1] || "";
    if (cursor) params.set("cursor", cursor);
    if (q) params.set("q", q);
    if (type) params.set("type", type);
    if (currency) params.set("currency", currency);

    return `/api/admin/wallet/transactions?${params.toString()}`;
}

function renderWalletTransactions(transactions) {
    const box = document.getElementById("adminWalletTransactions");
    if (!box) return;

    if (!transactions.length) {
        box.innerHTML = `<div class="admin-empty-box">${escapeHTML(adminT("no_wallet_transactions_found"))}</div>`;
        return;
    }

    box.innerHTML = transactions.map(item => `
        <div class="wallet-ledger-row">
            <span>
                <strong>${escapeHTML(item.username || "-")}</strong>
                <small>${escapeHTML(formatDate(item.createdAt))}</small>
            </span>
            ${renderTransactionRow(item)}
        </div>
    `).join("");
}

function updateWalletPagination() {
    setText("walletPageInfo", adminWalletPaging.transactions.hasMore ? `${walletTransactionPage} / …` : `${walletTransactionPage}`);
    const prev = document.getElementById("walletPrevPage");
    const next = document.getElementById("walletNextPage");
    if (prev) prev.disabled = walletTransactionPage <= 1;
    if (next) next.disabled = walletTransactionPage >= walletTransactionTotalPages;
}

async function submitWalletAdjustment() {
    const btn = document.getElementById("walletAdjustSubmitBtn");
    const username = document.getElementById("walletAdjustUsername")?.value.trim() || "";
    const direction = document.getElementById("walletAdjustDirection")?.value || "credit";
    const amount = Number(document.getElementById("walletAdjustAmount")?.value || 0);
    const currency = document.getElementById("walletAdjustCurrency")?.value || "MMK";
    let reason = document.getElementById("walletAdjustReason")?.value.trim() || "";

    if (!username || !amount || amount <= 0) {
        showAdminToast?.(adminT("wallet_adjustment_required"), "error");
        return;
    }

    if (!reason && window.AZIEL_ADMIN_ACTION_MODAL) {
        const result = await window.AZIEL_ADMIN_ACTION_MODAL.open({
            title: adminT("wallet_adjustment"),
            message: `${direction === "credit" ? adminT("credit_wallet") : adminT("debit_wallet")}: ${amount.toLocaleString()} ${currency} ${username}`,
            label: adminT("reason"),
            placeholder: adminT("reason"),
            required: true,
            confirmText: direction === "credit" ? adminT("confirm_credit") : adminT("confirm_debit")
        });

        if (!result.confirmed) return;
        reason = result.value;
    }

    const confirmed = await confirmWalletAction({
        title: direction === "credit" ? adminT("confirm_credit") : adminT("confirm_debit"),
        message: `${username}\n${direction === "credit" ? "+" : "-"}${amount.toLocaleString()} ${currency}\n${reason}`,
        confirmText: direction === "credit" ? adminT("confirm_credit") : adminT("confirm_debit"),
        danger: direction === "debit"
    });

    if (!confirmed) return;

    try {
        window.AZIEL_UI?.button?.setLoading(btn, { text: adminT("loading") });

        const data = await adminFetch("/api/admin/wallet/adjust", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, direction, amount, currency, reason })
        });

        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("something_went_wrong"), "error");
            return;
        }

        showAdminToast?.(adminT("wallet_adjustment_saved"), "success");
        document.getElementById("walletAdjustAmount").value = "";
        document.getElementById("walletAdjustReason").value = "";
        dispatchWalletDashboardRefresh();
        if (currentWalletView === "transactions") loadWalletTransactions(false);
    } catch (error) {
        console.log("Wallet adjustment error:", error);
        showAdminToast?.(adminT("something_went_wrong"), "error");
    } finally {
        window.AZIEL_UI?.button?.reset(btn);
    }
}

function renderAdjustmentDetail() {
    const panel = document.getElementById("adminWalletDetailPanel");
    if (!panel || currentWalletView !== "adjustments") return;

    panel.innerHTML = `
        <div class="order-detail-empty">
            <strong>${escapeHTML(adminT("wallet_adjustment"))}</strong>
            <small>${escapeHTML(adminT("wallet_adjustment_backend_owned"))}</small>
        </div>
    `;
}

async function confirmWalletAction(options = {}) {
    if (window.AZIEL_UI?.confirm) {
        return window.AZIEL_UI.confirm({
            title: options.title || "",
            message: options.message || "",
            confirmText: options.confirmText || adminT("save"),
            cancelText: adminT("cancel"),
            danger: Boolean(options.danger)
        });
    }

    showAdminToast?.(options.message || options.title || "", "info");
    return false;
}

function dispatchWalletDashboardRefresh() {
    window.dispatchEvent(new CustomEvent("aziel:admin-dashboard-refresh"));
    loadAdminDashboard?.(false);
}

function renderWalletError(message) {
    const box = document.getElementById("adminWalletList");
    if (!box) return;

    box.innerHTML = `
        <div class="admin-dashboard-error">
            <strong>${escapeHTML(message)}</strong>
            <button type="button" id="retryWalletBtn">${escapeHTML(adminT("retry"))}</button>
        </div>
    `;

    document.getElementById("retryWalletBtn")?.addEventListener("click", () => loadWalletTopups(true));
}

function syncWalletTabs() {
    document.querySelectorAll(".wallet-command-tab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.walletView === currentWalletView);
    });
}

function updateWalletHash() {
    const context = ["pending", "approved", "rejected"].includes(currentWalletView)
        ? { view: currentWalletView, status: currentWalletView }
        : { view: currentWalletView };
    window.openAdminSection?.("wallet", true, context);
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

    if (!modal || !img || !src) return;

    img.src = src;
    modal.classList.add("show");
}

function closeSlipModal() {
    document.getElementById("slipModal")?.classList.remove("show");
}

function getTopupEvidenceUrl(topup) {
    const evidence = topup?.paymentEvidence || {};
    const raw = evidence.url || evidence.key || evidence.storageKey || topup?.paymentSlip || "";
    return getAdminUploadedImageUrl(raw, { folder: "slips" });
}

function handleAdminWalletImageError(img) {
    handleAdminUploadedImageError(img, adminT("payment_evidence_unavailable"));
}

function isAdminSectionActive(section) {
    const sectionEl = document.getElementById(`section-${section}`);
    return !sectionEl || sectionEl.classList.contains("active");
}

function getAdminHashContext(sectionName) {
    const raw = window.location.hash ? window.location.hash.slice(1) : "";
    const [section = "", query = ""] = raw.split("?");

    if (section !== sectionName) return {};

    return Object.fromEntries(new URLSearchParams(query));
}

function normalizeTopupStatus(status) {
    if (status === "approved" || status === "completed" || status === "paid") return "completed";
    if (status === "rejected" || status === "cancelled" || status === "failed") return "cancelled";
    return status || "pending";
}

function formatTopupStatus(status) {
    return {
        pending: adminT("pending"),
        approved: adminT("approved"),
        rejected: adminT("rejected"),
        paid: adminT("paid"),
        completed: adminT("completed"),
        cancelled: adminT("cancelled"),
        failed: adminT("failed")
    }[status] || status || "-";
}

function formatWalletType(type) {
    return {
        topup: adminT("credit"),
        payment: adminT("debit"),
        refund: adminT("refund"),
        "wallet.topup": adminT("credit"),
        "wallet.payment": adminT("debit"),
        "wallet.refund": adminT("refund"),
        "wallet.reversal": adminT("wallet_reversal"),
        "wallet.adjustment": adminT("adjustment"),
        "wallet.migration": adminT("wallet_migration")
    }[type] || type || "-";
}

function getTransactionDirection(item) {
    if (item.direction === "credit" || item.direction === "debit") return item.direction;
    const type = String(item.type || "").toLowerCase();
    if (type.includes("payment")) return "debit";
    return "credit";
}

function formatRecordedBalance(value, currency) {
    return value === null || value === undefined
        ? adminT("not_recorded")
        : `${Number(value || 0).toLocaleString()} ${currency || ""}`;
}

function formatMoney(value, currency) {
    return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: currency === "THB" ? 2 : 0 })} ${currency}`;
}

function formatPaymentName(value) {
    return window.AZIEL_PAYMENT_DISPLAY?.from?.(value, value || "-") || value || "-";
}

function formatDate(date) {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function formatRelativeTime(date) {
    if (!date) return "-";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return "-";
    const seconds = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
    if (seconds < 60) return adminT("just_now");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return parsed.toLocaleDateString();
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function adminT(key, fallback = "") {
    return window.AZIEL_ADMIN_I18N?.t?.(key, fallback) || fallback || key;
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
window.handleAdminWalletImageError = handleAdminWalletImageError;
