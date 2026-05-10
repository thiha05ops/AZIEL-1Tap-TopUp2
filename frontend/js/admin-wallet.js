// frontend/js/admin-wallet.js

const ADMIN_PASSWORD = "AZIEL2026";

document.addEventListener(
    "DOMContentLoaded",
    loadWalletTopups
);

async function loadWalletTopups() {
    try {
        const res = await fetch(
            "/api/admin/wallet/topups",
            {
                headers: {
                    "x-admin-password": ADMIN_PASSWORD
                }
            }
        );

        const data = await res.json();

        if (!data.success) {
            alert(data.message || "Failed to load wallet topups");
            return;
        }

        renderTopups(data.topups || []);

    } catch (error) {
        console.log("Wallet topup load error:", error);
    }
}

function renderTopups(topups) {
    const box = document.getElementById("walletTopups");

    if (!box) return;

    if (!topups.length) {
        box.innerHTML = `<p>No wallet topups found.</p>`;
        return;
    }

    box.innerHTML = "";

    topups.forEach(item => {
        const status = (item.status || "pending").toLowerCase();
        const isPending = status === "pending";

        const slip =
            item.paymentSlip ||
            item.slip ||
            item.filename ||
            "";

        box.innerHTML += `
            <div class="topup-card">

                <h2>${item.username || "Unknown User"}</h2>

                <p>
                    Amount:
                    ${Number(item.amount || 0).toLocaleString()}
                    ${item.currency || ""}
                </p>

                <p>
                    Payment:
                    ${item.paymentMethod || "-"}
                </p>

                <p>
                    Status:
                    <span class="status-${status}">
                        ${status}
                    </span>
                </p>

                ${slip
                ? `
                        <img
                            class="topup-slip"
                            src="/uploads/${slip}"
                            alt="Payment slip"
                        >
                    `
                : `<p>No slip uploaded</p>`
            }

                <div class="topup-actions">

                    <button
                        class="approve-btn"
                        onclick="updateStatus('${item._id}', 'approved')"
                        ${!isPending ? "disabled" : ""}
                    >
                        ${status === "approved" ? "Approved" : "Approve"}
                    </button>

                    <button
                        class="reject-btn"
                        onclick="updateStatus('${item._id}', 'rejected')"
                        ${!isPending ? "disabled" : ""}
                    >
                        ${status === "rejected" ? "Rejected" : "Reject"}
                    </button>

                </div>

            </div>
        `;
    });
}

async function updateStatus(id, status) {
    if (!id) {
        alert("Missing topup ID");
        return;
    }

    if (!confirm(`Are you sure to ${status} this topup?`)) {
        return;
    }

    try {
        const res = await fetch(
            `/api/admin/wallet/topups/${id}/status`,
            {
                method: "PUT",

                headers: {
                    "Content-Type": "application/json",
                    "x-admin-password": ADMIN_PASSWORD
                },

                body: JSON.stringify({ status })
            }
        );

        const data = await res.json();

        if (!data.success) {
            alert(data.message || "Update failed");
            return;
        }

        alert(`Topup ${status}`);

        loadWalletTopups();

    } catch (error) {
        console.log("Wallet status update error:", error);
        alert("Server error");
    }
}