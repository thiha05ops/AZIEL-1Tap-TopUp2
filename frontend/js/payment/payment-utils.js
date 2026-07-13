// frontend/js/payment/payment-utils.js
// AZIEL Payment Utilities V2.5

(function () {
    const API_BASE = location.port === "5500"
        ? "http://localhost:3000"
        : "";

    let countdownTimer = null;

    function apiUrl(path) {
        return `${API_BASE}${path}`;
    }

    function authHeaders(extra = {}) {
        const token =
            window.AZIEL?.getToken?.() ||
            localStorage.getItem("token") ||
            sessionStorage.getItem("token") ||
            "";

        return {
            ...extra,
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };
    }

    function normalizeUrl(path) {
        if (!path) return "";
        if (path.startsWith("http") || path.startsWith("data:")) return path;

        path = path.replace(/^\/+/, "");
        path = path.replace(/^frontend\//, "");

        if (location.port === "5500") return path;

        return path.startsWith("assets/")
            ? path
            : `/${path}`;
    }

    function escapeHTML(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.innerText = value || "";
    }

    function showLoading() {
        if (window.AZIEL_UI?.loading) {
            window.AZIEL_UI.loading.show({ text: "Creating payment..." });
            return;
        }

        document.getElementById("orderLoadingOverlay")?.classList.add("show");
    }

    function hideLoading() {
        if (window.AZIEL_UI?.loading) {
            window.AZIEL_UI.loading.hide();
            return;
        }

        document.getElementById("orderLoadingOverlay")?.classList.remove("show");
    }

    function getDynamicArea() {
        return document.getElementById("paymentDynamicArea");
    }

    function clearDynamicArea() {
        const area = getDynamicArea();
        if (area) area.innerHTML = "";
    }

    function renderDynamic(html) {
        const area = getDynamicArea();
        if (!area) return;
        area.innerHTML = html;
    }

    async function copy(text) {
        try {
            await navigator.clipboard.writeText(String(text || ""));
            showToast("Copied");
        } catch (error) {
            console.log("Copy failed:", error);
            showToast("Copy failed");
        }
    }

    function showToast(message) {
        if (window.AZIEL_UI?.toast) {
            window.AZIEL_UI.toast.info(message);
            return;
        }

        let toast = document.getElementById("paymentToast");

        if (!toast) {
            toast = document.createElement("div");
            toast.id = "paymentToast";
            toast.className = "payment-toast";
            document.body.appendChild(toast);
        }

        toast.innerText = message;
        toast.classList.add("show");

        setTimeout(() => {
            toast.classList.remove("show");
        }, 1800);
    }

    function startCountdown(seconds = 600) {
        stopCountdown();

        const countdown = document.getElementById("countdown");
        if (!countdown) return;

        function tick() {
            const m = Math.floor(seconds / 60);
            const s = seconds % 60;

            countdown.innerText = `${m}:${String(s).padStart(2, "0")}`;

            if (seconds <= 0) {
                stopCountdown();

                const btn = document.getElementById("confirmPaymentOrderBtn");
                if (btn) {
                    btn.disabled = true;
                    btn.innerText = "Payment Expired";
                }

                return;
            }

            seconds--;
        }

        tick();
        countdownTimer = setInterval(tick, 1000);
    }

    function stopCountdown() {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
    }

    function prepareModal(orderData, paymentSession = {}) {
        const modal = document.getElementById("paymentConfirmModal");
        if (!modal) {
            showToast("Payment modal not found");
            return null;
        }

        const payment = window.selectedPaymentData || {};

        setText("modalOrderId", orderData.orderId);
        setText("modalGame", orderData.game);
        setText("modalPackage", orderData.packageName);
        setText("modalAmount", `${Number(orderData.amount || 0).toLocaleString()} ${orderData.currency}`);
        setText("modalPayment", paymentSession.paymentName || payment.method || orderData.paymentMethod);
        setText("modalUserId", orderData.userId);
        setText("modalZoneId", orderData.zoneId);

        const logo = document.getElementById("modalPaymentLogo");
        const logoPath = paymentSession.logo || payment.logo || "";

        if (logo) {
            logo.src = normalizeUrl(logoPath);
            logo.style.display = logoPath ? "block" : "none";
        }

        const closeBtn = document.getElementById("closePaymentModal");
        if (closeBtn) {
            closeBtn.onclick = () => {
                stopCountdown();
                modal.classList.remove("show");

                if (window.PaymentPromptPay?.stopPolling) {
                    window.PaymentPromptPay.stopPolling();
                }
            };
        }

        clearDynamicArea();

        return modal;
    }

    function setModalTitle(title) {
        const box = document.querySelector(".payment-confirm-box");
        const heading = box?.querySelector("h2");
        if (heading) heading.innerText = title;
    }

    function showSuccess(orderId, title = "Payment Submitted", message = "Your payment is submitted. Admin will process your top-up soon.") {
        const paymentModal = document.getElementById("paymentConfirmModal");
        paymentModal?.classList.remove("show");

        const success = document.getElementById("successModal");

        if (success) {
            const h2 = success.querySelector("h2");
            const p = success.querySelector("p");

            if (h2) h2.innerText = title;
            if (p) p.innerText = message;

            success.classList.add("show");
        }

        const trackBtn = document.getElementById("trackOrderBtn");
        if (trackBtn) {
            trackBtn.onclick = () => {
                window.location.href = `tracking.html?orderId=${orderId}`;
            };
        }

        const homeBtn = document.getElementById("backHomeBtn");
        if (homeBtn) {
            homeBtn.onclick = () => {
                window.location.href = "home.html";
            };
        }
    }

    function hideQr() {
        const qr = document.getElementById("modalQrImage");
        if (qr) {
            qr.removeAttribute("src");
            qr.style.display = "none";
        }
    }

    function showQr(src) {
        const qr = document.getElementById("modalQrImage");
        if (!qr) return;

        const finalSrc = normalizeUrl(src);

        if (!finalSrc) {
            hideQr();
            return;
        }

        qr.src = finalSrc;
        qr.style.display = "block";
        qr.style.width = "220px";
        qr.style.height = "220px";
        qr.style.objectFit = "contain";
        qr.style.background = "#fff";
        qr.style.padding = "10px";
    }

    async function submitSlip(orderData, file, msgEl, btnEl) {
        if (!file) {
            setMsg(msgEl, "Please upload payment slip.", "error");
            setManualSlipButtonState(btnEl, "initial");
            return false;
        }

        if (btnEl) {
            setManualSlipButtonState(btnEl, "uploading");
        }

        const fd = new FormData();
        fd.append("slip", file);

        const isManualAttempt = Boolean(orderData.manualPaymentAttemptId);
        const endpoint = isManualAttempt
            ? `/api/payment/manual/attempt/${encodeURIComponent(orderData.manualPaymentAttemptId)}/slip`
            : "/api/payment/submit";

        if (!isManualAttempt) {
            fd.append("orderId", orderData.orderId);
        }

        try {
            const res = await fetch(apiUrl(endpoint), {
                method: "POST",
                headers: authHeaders(),
                body: fd
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                setMsg(msgEl, data.message || "Slip submit failed.", "error");

                if (btnEl) {
                    setManualSlipButtonState(btnEl, file ? "selected" : "initial");
                }

                return false;
            }

            stopCountdown();
            setManualSlipButtonState(btnEl, "success");
            setMsg(
                msgEl,
                "Waiting for Verification. Your payment slip has been submitted. We'll notify you after verification.",
                "success"
            );
            showSuccess(
                data.order?.orderId || orderData.orderId,
                "Slip Submitted",
                "Waiting for Verification. Your payment slip has been submitted. We'll notify you after verification."
            );
            return true;

        } catch (error) {
            console.log("Submit slip error:", error);
            setMsg(msgEl, "Server error", "error");

            if (btnEl) {
                setManualSlipButtonState(btnEl, file ? "selected" : "initial");
            }

            return false;
        }
    }

    function claimManualSlipButton(btn) {
        if (!btn) return;
        btn.removeAttribute("data-i18n");
        btn.setAttribute("data-i18n-skip", "true");
        btn.dataset.paymentButtonMode = "manual-slip";
    }

    function setManualSlipButtonState(btn, state = "initial") {
        if (!btn) return;

        claimManualSlipButton(btn);

        const states = {
            initial: {
                text: "Upload Payment Slip",
                disabled: false
            },
            selected: {
                text: "Submit Payment Slip",
                disabled: false
            },
            uploading: {
                text: "Uploading Slip...",
                disabled: true
            },
            success: {
                text: "Slip Submitted",
                disabled: true
            }
        };
        const next = states[state] || states.initial;

        btn.disabled = next.disabled;
        btn.innerText = next.text;
        btn.dataset.manualSlipState = state;
    }

    function configureManualSlipButton(orderData, msgEl, btnEl) {
        if (!btnEl) return;

        const input = document.getElementById("manualPaymentSlip");
        setManualSlipButtonState(btnEl, input?.files?.[0] ? "selected" : "initial");

        btnEl.onclick = () => {
            const file = document.getElementById("manualPaymentSlip")?.files?.[0];

            if (!file) {
                document.getElementById("manualPaymentSlip")?.click();
                setMsg(msgEl, "Please upload your payment slip first.", "error");
                setManualSlipButtonState(btnEl, "initial");
                return;
            }

            submitSlip(orderData, file, msgEl, btnEl);
        };
    }

    function bindSlipPreview() {
        const input = document.getElementById("manualPaymentSlip");
        const previewBox = document.getElementById("manualSlipPreviewBox");
        const previewImg = document.getElementById("manualSlipPreviewImage");
        const removeBtn = document.getElementById("removeManualSlipBtn");
        const confirmBtn = document.getElementById("confirmPaymentOrderBtn");

        input?.addEventListener("change", () => {
            const file = input.files?.[0];
            setManualSlipButtonState(confirmBtn, file ? "selected" : "initial");
            if (!file) return;

            const reader = new FileReader();

            reader.onload = e => {
                if (previewImg) previewImg.src = e.target.result;
                if (previewBox) previewBox.style.display = "block";
            };

            reader.readAsDataURL(file);
        });

        removeBtn?.addEventListener("click", () => {
            if (input) input.value = "";
            if (previewImg) previewImg.src = "";
            if (previewBox) previewBox.style.display = "none";
            setManualSlipButtonState(confirmBtn, "initial");
        });
    }

    function setMsg(el, message, type = "success") {
        if (!el) return;

        el.innerHTML = `
            <p class="${type === "error" ? "error-msg" : "success-msg"}">
                ${escapeHTML(message)}
            </p>
        `;
    }

    window.PaymentUtils = {
        apiUrl,
        normalizeUrl,
        escapeHTML,
        setText,
        showLoading,
        hideLoading,
        getDynamicArea,
        clearDynamicArea,
        renderDynamic,
        copy,
        showToast,
        startCountdown,
        stopCountdown,
        prepareModal,
        setModalTitle,
        showSuccess,
        hideQr,
        showQr,
        submitSlip,
        authHeaders,
        bindSlipPreview,
        claimManualSlipButton,
        configureManualSlipButton,
        setManualSlipButtonState,
        setMsg
    };
})();
