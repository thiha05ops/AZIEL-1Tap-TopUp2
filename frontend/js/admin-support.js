// frontend/js/admin-support.js

document.addEventListener(
    "DOMContentLoaded",
    () => {

        loadSupportTickets();

        setupRefreshButton();

    }
);


// ======================
// REFRESH BUTTON
// ======================

function setupRefreshButton() {

    const btn =
        document.getElementById(
            "refreshSupportBtn"
        );

    if (!btn) return;

    btn.addEventListener(
        "click",
        () => {

            loadSupportTickets();

        }
    );

}


// ======================
// LOAD TICKETS
// ======================

async function loadSupportTickets() {

    const box =
        document.getElementById(
            "supportTickets"
        );

    if (!box) return;

    box.innerHTML =
        `<p>Loading support tickets...</p>`;

    try {

        const data =
            await adminFetch(
                "/api/admin/support/tickets"
            );

        if (
            !data ||
            !data.success
        ) {

            box.innerHTML =
                "Failed to load tickets.";

            return;

        }

        if (
            !data.tickets ||
            !data.tickets.length
        ) {

            box.innerHTML = `
                <p>
                    No support tickets found.
                </p>
            `;

            return;

        }

        box.innerHTML =
            data.tickets
                .map(renderTicketCard)
                .join("");

    } catch (error) {

        console.log(
            "Load support tickets error:",
            error
        );

        box.innerHTML =
            "Server error.";

    }

}


// ======================
// RENDER CARD
// ======================

function renderTicketCard(
    ticket
) {

    const screenshot =
        ticket.screenshot
            ? `/uploads/support/${ticket.screenshot}`
            : "";

    return `
        <div class="support-ticket-card">

            <h2>
                ${ticket.subject || "-"}
            </h2>

            <p>
                <b>User:</b>
                ${ticket.username || "-"}
            </p>

            <p>
                <b>Ticket ID:</b>
                ${ticket.ticketId || "-"}
            </p>

            <p>
                <b>Type:</b>
                ${ticket.type || "general"}
            </p>

            <p>
                ${ticket.message || ""}
            </p>

            <span
                class="ticket-status-badge
                status-${ticket.status || "open"}"
            >
                ${ticket.status || "open"}
            </span>

            ${screenshot
            ? `
                        <img
                            src="${screenshot}"
                            class="ticket-image-admin"
                            onclick="window.open('${screenshot}','_blank')"
                        >
                    `
            : ""
        }

            ${ticket.adminReply
            ? `
                        <div class="ticket-admin-reply">

                            <h4>
                                Admin Reply
                            </h4>

                            <p>
                                ${ticket.adminReply}
                            </p>

                        </div>
                    `
            : ""
        }

            <div class="admin-reply-box">

                <textarea
                    id="reply-${ticket._id}"
                    placeholder="Write reply..."
                ></textarea>

                <div class="reply-actions">

                    <button
                        class="reply-btn"
                        onclick="replyTicket('${ticket._id}','open')"
                    >
                        Send Reply
                    </button>

                    <button
                        class="close-btn"
                        onclick="replyTicket('${ticket._id}','closed')"
                    >
                        Close Ticket
                    </button>

                </div>

            </div>

        </div>
    `;

}


// ======================
// REPLY
// ======================

async function replyTicket(
    id,
    status
) {

    try {

        const textarea =
            document.getElementById(
                `reply-${id}`
            );

        const reply =
            textarea?.value?.trim() || "";

        const data =
            await adminFetch(

                `/api/admin/support/tickets/${id}/reply`,

                {
                    method: "PUT",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        reply,
                        status

                    })

                }

            );

        if (
            !data ||
            !data.success
        ) {

            alert(
                data?.message ||
                "Reply failed"
            );

            return;

        }

        showAdminSuccess(
            "Ticket updated successfully"
        );

        loadSupportTickets();

    } catch (error) {

        console.log(
            "Reply support ticket error:",
            error
        );

        alert(
            "Server error"
        );

    }

}


// ======================
// SUCCESS POPUP
// ======================

function showAdminSuccess(
    message
) {

    const old =
        document.getElementById(
            "adminSuccessPopup"
        );

    if (old) old.remove();

    const popup =
        document.createElement(
            "div"
        );

    popup.id =
        "adminSuccessPopup";

    popup.innerHTML =
        `✅ ${message}`;

    document.body.appendChild(
        popup
    );

    popup.style.position =
        "fixed";

    popup.style.bottom =
        "20px";

    popup.style.right =
        "20px";

    popup.style.background =
        "linear-gradient(135deg,#22c55e,#16a34a)";

    popup.style.color =
        "#fff";

    popup.style.padding =
        "14px 18px";

    popup.style.borderRadius =
        "16px";

    popup.style.fontWeight =
        "800";

    popup.style.zIndex =
        "999999";

    popup.style.boxShadow =
        "0 12px 40px rgba(0,0,0,.35)";

    setTimeout(() => {

        popup.remove();

    }, 3000);

}


window.replyTicket =
    replyTicket;

window.loadSupportTickets =
    loadSupportTickets;