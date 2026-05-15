document.addEventListener("DOMContentLoaded", () => {

    loadSupportTickets();

    document
        .getElementById(
            "refreshSupportBtn"
        )
        ?.addEventListener(
            "click",
            loadSupportTickets
        );

});


// ======================
// LOAD SUPPORT TICKETS
// ======================

async function loadSupportTickets() {

    const box =
        document.getElementById(
            "supportTickets"
        );

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
            data.tickets.map(ticket => `

                <div class="support-ticket-card">

                    <h2>
                        ${ticket.subject}
                    </h2>

                    <p>
                        <b>User:</b>
                        ${ticket.username}
                    </p>

                    <p>
                        <b>Type:</b>
                        ${ticket.type}
                    </p>

                    <p>
                        ${ticket.message}
                    </p>

                    <span class="ticket-status-badge">
                        ${ticket.status}
                    </span>

                    ${ticket.screenshot
                    ? `
                        <img
                            src="/uploads/support/${ticket.screenshot}"
                            class="ticket-image-admin"
                            onclick="window.open('/uploads/support/${ticket.screenshot}','_blank')"
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

            `).join("");

    } catch (error) {

        console.log(error);

        box.innerHTML =
            "Server error.";

    }

}


// ======================
// REPLY TICKET
// ======================

async function replyTicket(id, status) {

    try {

        const reply =
            document.getElementById(
                `reply-${id}`
            ).value;

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

        alert(
            "Ticket updated"
        );

        loadSupportTickets();

    } catch (error) {

        console.log(error);

        alert(
            "Server error"
        );

    }

}

window.replyTicket =
    replyTicket;