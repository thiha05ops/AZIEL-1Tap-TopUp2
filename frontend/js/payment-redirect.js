// frontend/js/payment-redirect.js

window.pendingOrderData = null;

async function createPaymentAndRedirect(orderData) {
    try {
        const payment =
            window.selectedPaymentData ||
            getPaymentFromActiveCard();

        if (!payment || !payment.key) {
            alert("Please select payment method");
            return;
        }

        if (payment.paymentType === "auto") {
            alert("Auto payment is coming soon. Please use manual payment for now.");
            return;
        }

        window.pendingOrderData = {
            ...orderData,
            paymentMethod: payment.key,
            paymentDisplayName: window.AZIEL_PAYMENT_DISPLAY?.from?.(payment.method, payment.method) || payment.method,
            paymentType: payment.paymentType,
            provider: payment.provider
        };

        openPaymentConfirmModal(
            window.pendingOrderData,
            payment
        );

    } catch (error) {
        console.log("Payment modal error:", error);
        alert("Payment preview error");
    }
}

function getPaymentFromActiveCard() {
    const card = document.querySelector(".pay-card.active");

    if (!card) return null;

    return {
        key: card.dataset.method || "",
        method: window.AZIEL_PAYMENT_DISPLAY?.from?.(card.dataset.name || card.dataset.method, card.dataset.name || "") ||
            card.dataset.name ||
            "",
        logo: card.dataset.logo || "",
        qrImage: card.dataset.qr || "",
        accountName: card.dataset.accountName || "",
        accountNumber: card.dataset.accountNumber || "",
        paymentType: card.dataset.paymentType || "manual",
        provider: card.dataset.provider || "manual",
        maintenanceMessage: card.dataset.maintenanceMessage || ""
    };
}

function openPaymentConfirmModal(order, payment) {
    const modal = document.getElementById("paymentConfirmModal");

    if (!modal) {
        alert("Payment modal not found in mlbb.html");
        return;
    }

    setText("modalGame", order.game || "-");
    setText("modalPackage", order.packageName || "-");
    setText(
        "modalAmount",
        `${Number(order.amount || 0).toLocaleString()} ${order.currency || ""}`
    );
    setText("modalPayment", window.AZIEL_PAYMENT_DISPLAY?.from?.(payment.method || order.paymentMethod, payment.method || order.paymentMethod || "-") || payment.method || order.paymentMethod || "-");
    setText("modalUserId", order.userId || "-");
    setText("modalZoneId", order.zoneId || "-");
    setText(
        "modalAccountName",
        payment.accountName
            ? `Account Name: ${payment.accountName}`
            : ""
    );
    setText(
        "modalAccountNumber",
        payment.accountNumber
            ? `Account Number: ${payment.accountNumber}`
            : ""
    );

    const logo = document.getElementById("modalPaymentLogo");
    if (logo) {
        logo.src = payment.logo || "assets/logo.png";
        logo.style.display = "block";
    }

    const qr = document.getElementById("modalQrImage");
    if (qr) {
        if (payment.qrImage) {
            qr.src = payment.qrImage;
            qr.style.display = "block";
        } else {
            qr.style.display = "none";
        }
    }

    const slip = document.getElementById("modalPaymentSlip");
    if (slip) slip.value = "";

    modal.classList.add("show");
}

function closePaymentConfirmModal() {
    document
        .getElementById("paymentConfirmModal")
        ?.classList.remove("show");
}

async function confirmPaymentOrder() {
    const order = window.pendingOrderData;

    if (!order) {
        alert("Missing order data");
        return;
    }

    const slipInput =
        document.getElementById("modalPaymentSlip");

    const slipFile =
        slipInput?.files?.[0];

    if (!slipFile) {
        alert("Please upload payment screenshot");
        return;
    }

    const btn =
        document.getElementById("confirmPaymentOrderBtn");

    if (btn) {
        btn.disabled = true;
        btn.innerText = "Submitting...";
    }

    try {
        const formData = new FormData();

        Object.keys(order).forEach(key => {
            formData.append(key, order[key]);
        });

        formData.append("paymentSlip", slipFile);

        const res = await fetch("/api/orders", {
            method: "POST",
            headers: window.AZIEL?.authHeaders?.() || {},
            body: formData
        });

        const data = await res.json();

        if (!data.success) {
            alert(data.message || "Order submit failed");
            return;
        }

        closePaymentConfirmModal();

        if (typeof showSuccessModal === "function") {
            showSuccessModal(order.orderId);
        } else {
            alert("Order submitted successfully");
            window.location.href = `tracking.html?orderId=${order.orderId}`;
        }

    } catch (error) {
        console.log("Confirm order error:", error);
        alert("Server error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "Confirm Order";
        }
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

document.addEventListener("DOMContentLoaded", () => {
    document
        .getElementById("closePaymentModal")
        ?.addEventListener("click", closePaymentConfirmModal);

    document
        .getElementById("confirmPaymentOrderBtn")
        ?.addEventListener("click", confirmPaymentOrder);

    document
        .getElementById("paymentConfirmModal")
        ?.addEventListener("click", e => {
            if (e.target.id === "paymentConfirmModal") {
                closePaymentConfirmModal();
            }
        });
});
