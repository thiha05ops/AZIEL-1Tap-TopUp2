// frontend/js/admin-live-chat.js
// Admin Live Chat controller. Supports standalone page and admin.html#chat.

(function () {
    let chats = [];
    let activeChat = null;
    let initialized = false;
    let loading = false;
    let hasLoadedOnce = false;
    let pollingTimer = null;
    let activeMessagePaging = {
        nextCursor: "",
        hasMore: false,
        loadingMore: false
    };

    document.addEventListener("DOMContentLoaded", initAdminLiveChat);

    function initAdminLiveChat() {
        if (initialized) return;

        const dom = getDom();
        if (!dom.root) return;

        initialized = true;
        ensureEmbeddedShell();
        bindEvents();
        bindSectionLifecycle();
        bindRealtimeRefresh();

        if (isChatSectionActive()) {
            loadAdminLiveChats();
        }

        startPolling();
    }

    function getDom() {
        const embeddedRoot = document.getElementById("adminLiveChatList");
        const standaloneList = document.getElementById("chatList");

        return {
            root: embeddedRoot || standaloneList,
            embeddedRoot,
            chatList: document.getElementById("adminLiveChatConversations") || standaloneList,
            messagesBox: document.getElementById("adminLiveChatMessages") || document.getElementById("messagesBox"),
            selectedUsername: document.getElementById("adminLiveChatSelectedUsername") || document.getElementById("selectedUsername"),
            selectedChatId: document.getElementById("adminLiveChatSelectedChatId") || document.getElementById("selectedChatId"),
            replyForm: document.getElementById("adminLiveChatReplyForm") || document.getElementById("replyForm"),
            replyInput: document.getElementById("adminLiveChatReplyInput") || document.getElementById("replyInput"),
            sendReplyBtn: document.getElementById("adminLiveChatSendReplyBtn") || document.getElementById("sendReplyBtn"),
            deleteChatBtn: document.getElementById("adminLiveChatDeleteBtn") || document.getElementById("deleteChatBtn"),
            refreshBtn: document.getElementById("adminLiveChatRefreshBtn") || document.getElementById("refreshBtn")
        };
    }

    function ensureEmbeddedShell() {
        const root = document.getElementById("adminLiveChatList");
        if (!root || root.dataset.adminLiveChatReady === "true") return;

        root.classList.remove("admin-list-empty");
        root.dataset.adminLiveChatReady = "true";
        root.innerHTML = `
            <div class="admin-chat-page admin-chat-page-embedded">
                <aside class="chat-sidebar">
                    <div class="sidebar-header">
                        <h2>Conversations</h2>
                        <button id="adminLiveChatRefreshBtn" type="button">Refresh</button>
                    </div>

                    <div id="adminLiveChatConversations" class="chat-list">
                        <p class="empty">Loading chats...</p>
                    </div>
                </aside>

                <main class="chat-panel">
                    <div class="chat-panel-header">
                        <div>
                            <button id="adminLiveChatBackBtn" class="admin-mobile-back-btn" type="button">
                                ← ${escapeHTML(window.AZIEL_ADMIN_I18N?.t?.("back_to_chats", "Chats") || "Chats")}
                            </button>
                            <h2 id="adminLiveChatSelectedUsername">Select a user</h2>
                            <p id="adminLiveChatSelectedChatId">No chat selected</p>
                        </div>

                        <button id="adminLiveChatDeleteBtn" class="delete-btn" type="button" disabled>
                            Delete
                        </button>
                    </div>

                    <div id="adminLiveChatMessages" class="messages-box">
                        <p class="empty">Choose a user chat from the left side.</p>
                    </div>

                    <form id="adminLiveChatReplyForm" class="reply-form">
                        <input id="adminLiveChatReplyInput" type="text" placeholder="Write admin reply..." disabled>
                        <button id="adminLiveChatSendReplyBtn" type="submit" disabled>Send</button>
                    </form>
                </main>
            </div>
        `;
    }

    function bindEvents() {
        const dom = getDom();

        dom.replyForm?.addEventListener("submit", sendAdminReply);
        dom.deleteChatBtn?.addEventListener("click", deleteActiveChat);
        dom.refreshBtn?.addEventListener("click", () => loadAdminLiveChats({ force: true }));
        document.getElementById("adminLiveChatBackBtn")?.addEventListener("click", () => {
            document.querySelector(".admin-chat-page")?.classList.remove("admin-chat-detail-open");
        });
    }

    function bindSectionLifecycle() {
        window.addEventListener("aziel:admin-section-opened", event => {
            if (event.detail?.section === "chat") {
                loadAdminLiveChats({ force: true });
            }
        });
    }

    function bindRealtimeRefresh() {
        if (!window.AZIEL?.realtime) return;

        window.AZIEL.realtime.on("liveChatMessage", () => {
            if (isChatSectionActive()) {
                loadAdminLiveChats({ preserveActive: true, source: "realtime" });
            }
        }, { role: "admin" });
    }

    function startPolling() {
        if (pollingTimer) return;

        pollingTimer = setInterval(() => {
            if (isChatSectionActive()) {
                loadAdminLiveChats({ preserveActive: true, silent: true });
            }
        }, 5000);
    }

    async function loadAdminLiveChats(options = {}) {
        const dom = getDom();
        if (!dom.chatList || loading) return;

        loading = true;

        if (!hasLoadedOnce && !options.silent) {
            dom.chatList.innerHTML = `<p class="empty">Loading chats...</p>`;
        }

        try {
            const data = await adminFetch("/api/live-chat/admin");

            if (!data?.success) {
                dom.chatList.innerHTML = `<p class="empty">${escapeHTML(data?.message || "Failed to load chats")}</p>`;
                return;
            }

            chats = Array.isArray(data.chats)
                ? data.chats.filter(chat => chat.status !== "deleted")
                : [];

            hasLoadedOnce = true;
            renderChatList(options);
            reconcileActiveChat(options);
        } catch (error) {
            console.error("Load admin live chats error:", error);
            dom.chatList.innerHTML = `<p class="empty">Server connection error</p>`;
        } finally {
            loading = false;
        }
    }

    function renderChatList(options = {}) {
        const dom = getDom();
        if (!dom.chatList) return;

        if (!chats.length) {
            dom.chatList.innerHTML = `<p class="empty">No active live chats</p>`;
            resetActiveChat();
            document.querySelector(".admin-chat-page")?.classList.remove("admin-chat-detail-open");
            return;
        }

        dom.chatList.innerHTML = "";

        chats.forEach(chat => {
            const lastMsg = getLastMessage(chat);
            const card = document.createElement("button");
            card.type = "button";
            card.className = `chat-user-card ${activeChat?.chatId === chat.chatId ? "active" : ""}`;
            card.dataset.chatId = chat.chatId || "";

            card.innerHTML = `
                <h3>${escapeHTML(chat.username || "Guest")}</h3>
                <p>${escapeHTML(lastMsg?.text || "No message")}</p>
                <span class="chat-time">${escapeHTML(formatTime(chat.lastMessageAt || lastMsg?.createdAt))}</span>
            `;

            card.addEventListener("click", () => {
                activeChat = chat;
                syncActiveMessagePaging(chat);
                renderChatList({ silent: true });
                renderMessages(chat, { animateNewOnly: true });
                markAdminRead(chat.chatId);
                document.querySelector(".admin-chat-page")?.classList.add("admin-chat-detail-open");
            });

            dom.chatList.appendChild(card);
        });

        if (!options.silent) {
            window.AZIEL_MOTION?.enter(dom.chatList, "fast");
        }
    }

    function reconcileActiveChat(options = {}) {
        if (!activeChat) return;

        const updated = chats.find(chat => chat.chatId === activeChat.chatId);
        if (!updated) {
            resetActiveChat();
            return;
        }

        const previousMessageCount = activeChat.messages?.length || 0;
        activeChat = updated;
        syncActiveMessagePaging(updated);
        renderMessages(updated, {
            animateNewOnly: Boolean(options.source === "realtime" || options.preserveActive),
            previousMessageCount
        });
    }

    function renderMessages(chat, options = {}) {
        const dom = getDom();
        if (!dom.messagesBox) return;

        if (dom.selectedUsername) dom.selectedUsername.textContent = chat.username || "Guest";
        if (dom.selectedChatId) dom.selectedChatId.textContent = chat.chatId || "No chat ID";
        if (dom.replyInput) dom.replyInput.disabled = false;
        if (dom.sendReplyBtn) dom.sendReplyBtn.disabled = false;
        if (dom.deleteChatBtn) dom.deleteChatBtn.disabled = false;

        const messages = Array.isArray(chat.messages) ? chat.messages : [];
        syncActiveMessagePaging(chat);
        const animateFrom = options.animateNewOnly
            ? Number(options.previousMessageCount ?? messages.length - 1)
            : messages.length;
        const loadOlder = activeMessagePaging.hasMore ? `
            <button class="admin-load-more-btn" type="button" id="adminLiveChatLoadOlderBtn" ${activeMessagePaging.loadingMore ? "disabled" : ""}>
                ${escapeHTML(activeMessagePaging.loadingMore ? "Loading..." : "Load older messages")}
            </button>
        ` : "";

        dom.messagesBox.innerHTML = loadOlder;

        messages.forEach((msg, index) => {
            const div = document.createElement("div");
            div.className = `message ${escapeClass(msg.sender || "user")}`;
            div.innerHTML = `
                ${escapeHTML(msg.text || "")}
                <small>${escapeHTML(msg.sender || "user")} • ${escapeHTML(formatTime(msg.createdAt))}</small>
            `;

            dom.messagesBox.appendChild(div);

            if (index >= animateFrom) {
                window.AZIEL_MOTION?.enter(div, "fast");
            }
        });

        document.getElementById("adminLiveChatLoadOlderBtn")?.addEventListener("click", loadOlderActiveMessages);

        if (!options.preserveScroll) {
            dom.messagesBox.scrollTop = dom.messagesBox.scrollHeight;
        }
    }

    function syncActiveMessagePaging(chat) {
        const messages = Array.isArray(chat?.messages) ? chat.messages : [];
        const total = Number(chat?.messagesTotal || messages.length);
        activeMessagePaging.hasMore = total > messages.length;
        activeMessagePaging.nextCursor = activeMessagePaging.hasMore ? String(messages[0]?._id || "") : "";
    }

    async function loadOlderActiveMessages() {
        if (!activeChat?.chatId || activeMessagePaging.loadingMore || !activeMessagePaging.hasMore) return;

        const dom = getDom();
        const previousHeight = dom.messagesBox?.scrollHeight || 0;
        activeMessagePaging.loadingMore = true;
        renderMessages(activeChat, { preserveScroll: true });

        try {
            const params = new URLSearchParams({
                limit: "50",
                before: activeMessagePaging.nextCursor
            });
            const data = await adminFetch(`/api/live-chat/admin/${encodeURIComponent(activeChat.chatId)}/messages?${params.toString()}`);
            if (!data?.success) {
                showAdminToast?.(data?.message || "Failed to load messages", "error");
                return;
            }

            const older = Array.isArray(data.messages) ? data.messages : [];
            activeChat.messages = mergeChatMessages(older, activeChat.messages || []);
            activeChat.messagesTotal = Number(activeChat.messagesTotal || activeChat.messages.length);
            activeMessagePaging.hasMore = Boolean(data.pagination?.hasMore);
            activeMessagePaging.nextCursor = data.pagination?.nextCursor || "";
            renderMessages(activeChat, { preserveScroll: true });
            if (dom.messagesBox) {
                dom.messagesBox.scrollTop = Math.max(0, dom.messagesBox.scrollHeight - previousHeight);
            }
        } finally {
            activeMessagePaging.loadingMore = false;
            renderMessages(activeChat, { preserveScroll: true });
        }
    }

    function mergeChatMessages(older = [], current = []) {
        const seen = new Set();
        return [...older, ...current].filter(message => {
            const key = String(message._id || `${message.sender}:${message.createdAt}:${message.text}`);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    async function sendAdminReply(event) {
        event.preventDefault();

        const dom = getDom();
        if (!activeChat || !dom.replyInput) return;

        const message = dom.replyInput.value.trim();
        if (!message) return;

        try {
            window.AZIEL_UI?.button?.setLoading(dom.sendReplyBtn, { text: "Sending..." });

            const data = await adminFetch(`/api/live-chat/admin/reply/${encodeURIComponent(activeChat.chatId)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message })
            });

            if (!data?.success) {
                showAdminToast?.(data?.message || "Reply failed", "error");
                return;
            }

            dom.replyInput.value = "";
            const previousMessageCount = activeChat.messages?.length || 0;
            activeChat = data.chat;
            syncActiveMessagePaging(activeChat);
            renderMessages(activeChat, { animateNewOnly: true, previousMessageCount });
            await loadAdminLiveChats({ preserveActive: true, silent: true });
            showAdminToast?.("Reply sent", "success");
        } catch (error) {
            console.error("Admin live chat reply error:", error);
            showAdminToast?.("Server error", "error");
        } finally {
            window.AZIEL_UI?.button?.reset(dom.sendReplyBtn);
        }
    }

    async function deleteActiveChat() {
        if (!activeChat) return;

        const confirmed = window.AZIEL_UI?.confirm
            ? await window.AZIEL_UI.confirm({
                title: "Delete chat",
                message: "Delete this live chat conversation?",
                confirmText: "Delete"
            })
            : confirm("Delete this live chat conversation?");

        if (!confirmed) return;

        const chatId = activeChat.chatId;
        const data = await adminFetch(`/api/live-chat/admin/delete/${encodeURIComponent(chatId)}`, {
            method: "DELETE"
        });

        if (!data?.success) {
            showAdminToast?.(data?.message || "Delete failed", "error");
            return;
        }

        activeChat = null;
        resetActiveChat();
        await loadAdminLiveChats({ force: true });
        showAdminToast?.("Chat deleted", "success");
    }

    async function markAdminRead(chatId) {
        if (!chatId) return;

        try {
            await adminFetch(`/api/live-chat/admin/read/${encodeURIComponent(chatId)}`, {
                method: "PUT"
            });
        } catch (error) {
            console.log("Mark admin chat read error:", error);
        }
    }

    function resetActiveChat() {
        const dom = getDom();
        activeChat = null;

        if (dom.selectedUsername) dom.selectedUsername.textContent = "Select a user";
        if (dom.selectedChatId) dom.selectedChatId.textContent = "No chat selected";
        if (dom.messagesBox) dom.messagesBox.innerHTML = `<p class="empty">Choose a user chat from the left side.</p>`;
        if (dom.replyInput) {
            dom.replyInput.value = "";
            dom.replyInput.disabled = true;
        }
        if (dom.sendReplyBtn) dom.sendReplyBtn.disabled = true;
        if (dom.deleteChatBtn) dom.deleteChatBtn.disabled = true;
    }

    function getLastMessage(chat) {
        const messages = Array.isArray(chat?.messages) ? chat.messages : [];
        return messages.length ? messages[messages.length - 1] : null;
    }

    function isChatSectionActive() {
        const section = document.getElementById("section-chat");
        return !section || section.classList.contains("active") || window.location.hash === "#chat";
    }

    function formatTime(date) {
        if (!date) return "";
        const parsed = new Date(date);
        return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString();
    }

    function escapeHTML(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function escapeClass(value) {
        return String(value || "user").replace(/[^a-z0-9_-]/gi, "");
    }

    window.loadAdminLiveChats = loadAdminLiveChats;
})();
