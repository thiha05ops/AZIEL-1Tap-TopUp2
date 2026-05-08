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

    const submitBtn =
        document.getElementById(
            "submitTopupBtn"
        );

    submitBtn?.addEventListener(
        "click",
        submitTopup
    );

});


// ======================
// LOAD WALLET
// ======================

async function loadWallet() {

    try {

        const username =
            localStorage.getItem("username");

        const region =
            localStorage.getItem("region")
            || "MM";

        const currencySymbol =
            region === "TH"
                ? "฿"
                : "Ks";

        const res =
            await fetch(
                `/api/wallet/${username}`
            );

        const data =
            await res.json();

        if (!data.success) return;

        document.getElementById(
            "walletBalance"
        ).innerText =
            `${data.balance.toLocaleString()} ${currencySymbol}`;

        renderHistory(data.topups);

    } catch (error) {

        console.log(error);

    }

}


// ======================
// RENDER HISTORY
// ======================

function renderHistory(topups) {

    const box =
        document.getElementById(
            "walletHistory"
        );

    if (
        !topups ||
        !topups.length
    ) {

        box.innerHTML = `
            <p class="empty-text">
                No wallet history yet.
            </p>
        `;

        return;
    }

    box.innerHTML = "";

    topups.forEach(item => {

        box.innerHTML += `
            <div class="wallet-history-item">

                <strong>
                    ${item.amount.toLocaleString()}
                    ${item.currency}
                </strong>

                <p>
                    ${item.paymentMethod}
                </p>

                <p class="status-${item.status}">
                    ${item.status}
                </p>

            </div>
        `;

    });

}


// ======================
// SUBMIT TOPUP
// ======================

async function submitTopup() {

    const amount =
        document.getElementById(
            "topupAmount"
        ).value;

    const paymentMethod =
        document.getElementById(
            "paymentMethod"
        ).value;

    const slip =
        document.getElementById(
            "topupSlip"
        ).files[0];

    const username =
        localStorage.getItem("username");

    const region =
        localStorage.getItem("region")
        || "MM";

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
            "Fill all wallet topup fields"
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
        "currency",
        currency
    );

    formData.append(
        "paymentMethod",
        paymentMethod
    );

    formData.append(
        "slip",
        slip
    );

    try {

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
                data.message
            );

            return;
        }

        alert(
            "Wallet topup submitted"
        );

        location.reload();

    } catch (error) {

        console.log(error);

        alert("Server error");

    }

}