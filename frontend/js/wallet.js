// frontend/js/wallet.js

document.addEventListener("DOMContentLoaded", () => {

    const username =
        localStorage.getItem("username");

    if (!username) {

        window.location.href =
            "login.html";

        return;
    }

    loadWallet();

    initWalletQrPreview();

    const submitBtn =
        document.getElementById(
            "submitTopupBtn"
        );

    submitBtn?.addEventListener(
        "click",
        submitTopup
    );

});


// ==============================
// LOAD WALLET
// ==============================

async function loadWallet() {

    try {

        const username =
            localStorage.getItem(
                "username"
            );

        const region =
            localStorage.getItem(
                "selectedRegion"
            ) || "MM";

        const currency =
            region === "TH"
                ? "THB"
                : "MMK";

        const res =
            await fetch(
                `/api/wallet/${username}?currency=${currency}`
            );

        const data =
            await res.json();

        if (!data.success) {

            alert(
                data.message ||
                "Wallet load failed"
            );

            return;
        }

        renderWallet(
            data.balance,
            data.currency
        );

        renderWalletHistory(
            data.topups || []
        );

    } catch (error) {

        console.log(error);

    }

}


// ==============================
// RENDER WALLET
// ==============================

function renderWallet(
    balance,
    currency
) {

    const balanceText =
        document.getElementById(
            "walletBalance"
        );

    if (!balanceText) return;

    const symbol =
        currency === "THB"
            ? "฿"
            : "Ks";

    balanceText.innerText =
        `${Number(balance).toLocaleString()} ${symbol}`;

}


// ==============================
// WALLET HISTORY
// ==============================

function renderWalletHistory(
    history
) {

    const container =
        document.getElementById(
            "walletHistory"
        );

    if (!container) return;

    if (!history.length) {

        container.innerHTML =
            `
            <div class="empty-wallet">
                No wallet history.
            </div>
            `;

        return;
    }

    container.innerHTML =
        history.map(item => {

            const statusClass =
                item.status === "approved"
                    ? "approved"
                    : "pending";

            return `
            <div class="wallet-history-card">

                <h3>
                    ${Number(item.amount)
                    .toLocaleString()}
                    ${item.currency || "MMK"}
                </h3>

                <p>
                    ${item.paymentMethod}
                </p>

                <span class="${statusClass}">
                    ${item.status}
                </span>

            </div>
            `;

        }).join("");

}


// ==============================
// SUBMIT TOPUP
// ==============================

async function submitTopup() {

    try {

        const username =
            localStorage.getItem(
                "username"
            );

        const amount =
            document.getElementById(
                "walletAmount"
            )?.value;

        const paymentMethod =
            document.getElementById(
                "paymentMethod"
            )?.value;

        const slip =
            document.getElementById(
                "walletSlip"
            )?.files[0];

        const region =
            localStorage.getItem(
                "selectedRegion"
            ) || "MM";

        const currency =
            region === "TH"
                ? "THB"
                : "MMK";

        if (
            !amount ||
            !paymentMethod ||
            !slip
        ) {

            alert(
                "Please fill all fields"
            );

            return;
        }

        const formData =
            new FormData();

        formData.append(
            "username",
            username
        );

        formData.append(
            "amount",
            amount
        );

        formData.append(
            "paymentMethod",
            paymentMethod
        );

        formData.append(
            "currency",
            currency
        );

        formData.append(
            "slip",
            slip
        );

        const submitBtn =
            document.getElementById(
                "submitTopupBtn"
            );

        submitBtn.disabled = true;

        submitBtn.innerText =
            "Submitting...";

        const res =
            await fetch(
                "/api/wallet/topup",
                {
                    method: "POST",
                    body: formData
                }
            );

        const data =
            await res.json();

        if (!data.success) {

            alert(
                data.message ||
                "Topup failed"
            );

            submitBtn.disabled = false;

            submitBtn.innerText =
                "Submit Top Up";

            return;
        }

        alert(
            "Wallet topup submitted ✅"
        );

        window.location.reload();

    } catch (error) {

        console.log(error);

        alert(
            "Server error"
        );

    }

}


// ==============================
// QR PREVIEW
// ==============================

function initWalletQrPreview() {

    const qrBox =
        document.getElementById(
            "walletQrBox"
        );

    const qrImg =
        document.getElementById(
            "walletQrImage"
        );

    const qrTitle =
        document.getElementById(
            "walletQrTitle"
        );

    const paymentInput =
        document.getElementById(
            "paymentMethod"
        );

    if (
        !qrBox ||
        !qrImg ||
        !qrTitle ||
        !paymentInput
    ) {

        console.log(
            "Wallet QR elements missing"
        );

        return;
    }

    const qrData = {

        kbzpay: {
            name: "KBZPay",
            qr: "assets/payment/kbzpay-qr.png"
        },

        wavepay: {
            name: "WavePay",
            qr: "assets/payment/wavepay-qr.png"
        },

        ayapay: {
            name: "AYA Pay",
            qr: "assets/payment/ayapay-qr.png"
        },

        promptpay: {
            name: "PromptPay",
            qr: "assets/payment/promptpay-qr.png"
        },

        scb: {
            name: "SCB",
            qr: "assets/payment/scb-qr.png"
        }

    };

    function showQr() {

        const method =
            paymentInput.value;

        if (
            !method ||
            !qrData[method]
        ) {

            qrBox.style.display =
                "none";

            return;
        }

        qrTitle.innerText =
            qrData[method].name + " QR";

        qrImg.src =
            qrData[method].qr;

        qrBox.style.display =
            "block";
    }

    document.addEventListener(
        "paymentChanged",
        showQr
    );

    document.addEventListener(
        "click",
        (e) => {

            if (
                e.target.closest(".pay-card")
            ) {

                setTimeout(
                    showQr,
                    100
                );

            }

        }
    );

    showQr();

}