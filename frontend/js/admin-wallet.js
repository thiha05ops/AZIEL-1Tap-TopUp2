// frontend/js/admin-wallet.js

const ADMIN_PASSWORD = "AZIEL2026";

document.addEventListener(
    "DOMContentLoaded",
    loadWalletTopups
);

async function loadWalletTopups() {

    try {

        const res =
            await fetch(
                "/api/admin/wallet/topups",
                {
                    headers: {
                        "x-admin-password":
                            ADMIN_PASSWORD
                    }
                }
            );

        const data =
            await res.json();

        if (!data.success) {

            alert(data.message);

            return;
        }

        renderTopups(data.topups);

    } catch (error) {

        console.log(error);

    }

}

function renderTopups(topups) {

    const box =
        document.getElementById(
            "walletTopups"
        );

    if (!topups.length) {

        box.innerHTML = `
            <p>No wallet topups found.</p>
        `;

        return;
    }

    box.innerHTML = "";

    topups.forEach(item => {

        box.innerHTML += `
            <div class="topup-card">

                <h2>
                    ${item.username}
                </h2>

                <p>
                    Amount:
                    ${item.amount}
                    ${item.currency}
                </p>

                <p>
                    Payment:
                    ${item.paymentMethod}
                </p>

                <p>
                    Status:
                    ${item.status}
                </p>

                <img
                    src="/uploads/${item.paymentSlip}"
                >

                ${item.status === "pending"
                ?
                `
                    <div class="topup-actions">

                        <button
                            class="approve-btn"
                            onclick="updateStatus(
                                '${item._id}',
                                'approved'
                            )"
                        >
                            Approve
                        </button>

                        <button
                            class="reject-btn"
                            onclick="updateStatus(
                                '${item._id}',
                                'rejected'
                            )"
                        >
                            Reject
                        </button>

                    </div>
                    `
                :
                ""
            }

            </div>
        `;

    });

}

async function updateStatus(id, status) {

    try {

        const res =
            await fetch(
                `/api/admin/wallet/topups/${id}/status`,
                {
                    method: "PUT",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "x-admin-password":
                            ADMIN_PASSWORD
                    },

                    body: JSON.stringify({
                        status
                    })
                }
            );

        const data =
            await res.json();

        if (!data.success) {

            alert(data.message);

            return;
        }

        alert(
            `Topup ${status}`
        );

        loadWalletTopups();

    } catch (error) {

        console.log(error);

    }

}