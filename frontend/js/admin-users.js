document.addEventListener("DOMContentLoaded", () => {
    loadAdminUsers();
});

async function loadAdminUsers() {

    const box =
        document.getElementById("adminUsersList") ||
        document.getElementById("usersList");

    if (!box) return;

    try {

        const token =
            localStorage.getItem("adminToken");

        const res = await fetch(
            "/api/admin/users",
            {
                headers: {
                    Authorization:
                        `Bearer ${token}`
                }
            }
        );

        const data = await res.json();
        console.log("ADMIN USERS DATA:", data);

        if (!data.success) {

            box.innerHTML =
                "<p>Failed to load users.</p>";

            return;

        }

        renderUsers(
            data.users || []
        );

    } catch (error) {

        console.log(
            "Load users error:",
            error
        );

    }

}

function renderUsers(users) {
    const box =
        document.getElementById("adminUsersList") ||
        document.getElementById("usersList");

    if (!box) return;

    if (!users.length) {
        box.innerHTML = `
            <div class="admin-list-empty">
                Users will appear here.
            </div>
        `;
        return;
    }

    box.innerHTML = users.map(user => `
        <div class="admin-user-card">
            <div class="user-top">
                <div>
                    <h3>${user.username || "Unknown"}</h3>
                    <span>${user.region || "MM"}</span>
                </div>

                <span class="${user.isBlocked ? "user-badge blocked" : "user-badge active"}">
                    ${user.isBlocked ? "Blocked" : "Active"}
                </span>
            </div>

            <div class="user-stats">
                <div>
                    <small>Orders</small>
                    <strong>${user.totalOrders || 0}</strong>
                </div>

                <div>
                    <small>Total Spent</small>
                    <strong>${Number(user.totalSpent || 0).toLocaleString()}</strong>
                </div>

                <div>
                    <small>MMK</small>
                    <strong>${Number(user.wallet?.MMK || 0).toLocaleString()}</strong>
                </div>

                <div>
                    <small>THB</small>
                    <strong>${Number(user.wallet?.THB || 0).toLocaleString()}</strong>
                </div>
            </div>

            <div class="user-actions">
                <button onclick="toggleUserBlock('${user._id}')">
                    ${user.isBlocked ? "Unblock" : "Block"}
                </button>

                <button onclick="deleteUser('${user._id}')">
                    Delete
                </button>
            </div>
        </div>
    `).join("");
}