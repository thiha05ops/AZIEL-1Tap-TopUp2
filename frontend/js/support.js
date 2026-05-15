document.addEventListener("DOMContentLoaded", () => {

    loadMyTickets();

    document
        .getElementById("supportForm")
        ?.addEventListener(
            "submit",
            submitSupportTicket
        );

});


// ======================
// SUBMIT TICKET
// ======================

async function submitSupportTicket(e) {

    e.preventDefault();

    const username =
        localStorage.getItem("username");

    if (!username) {

        alert("Please login first");

        return;
    }

    const msg =
        document.getElementById(
            "supportMsg"
        );

    const btn =
        document.getElementById(
            "submitTicketBtn"
        );

    btn.disabled = true;
    btn.innerText = "Submitting...";

    try {

        const formData =
            new FormData();

        formData.append(
            "username",
            username
        );

        formData.append(
            "type",
            document.getElementById(
                "ticketType"
            ).value
        );

        formData.append(
            "subject",
            document.getElementById(
                "ticketSubject"
            ).value
        );

        formData.append(
            "message",
            document.getElementById(
                "ticketMessage"
            ).value
        );

        const screenshot =
            document.getElementById(
                "ticketScreenshot"
            ).files[0];

        if (screenshot) {

            formData.append(
                "screenshot",
                screenshot
            );

        }

        const res =
            await fetch(
                "/api/support/ticket",
                {
                    method: "POST",
                    body: formData
                }
            );

        const data =
            await res.json();

        if (!data.success) {

            msg.style.color =
                "#ef4444";

            msg.innerText =
                data.message ||
                "Submit failed";

            return;
        }

        msg.style.color =
            "#22c55e";

        msg.innerText =
            "Support ticket submitted successfully";

        document
            .getElementById(
                "supportForm"
            )
            .reset();

        loadMyTickets();

    } catch (error) {

        console.log(error);

        msg.style.color =
            "#ef4444";

        msg.innerText =
            "Server error";

    } finally {

        btn.disabled = false;

        btn.innerText =
            "Submit Ticket";

    }

}


// ======================
// LOAD MY TICKETS
// ======================

async function loadMyTickets() {

    const username =
        localStorage.getItem(
            "username"
        );

    const box =
        document.getElementById(
            "myTickets"
        );

    if (!username) {

        box.innerHTML =
            "Please login first.";

        return;
    }

    try {

        const res =
            await fetch(
                `/api/support/my/${username}`
            );

        const data =
            await res.json();

        if (
            !data.success ||
            !data.tickets.length
        ) {

            box.innerHTML = `
                <p>
                    No support tickets yet.
                </p>
            `;

            return;
        }

        box.innerHTML =
            data.tickets.map(ticket => `

                <div class="ticket-item">

                    <h3>
                        ${ticket.subject}
                    </h3>

                    <p>
                        <b>Type:</b>
                        ${ticket.type}
                    </p>

                    <p>
                        ${ticket.message}
                    </p>

                    <span class="ticket-status">
                        ${ticket.status}
                    </span>

                    ${ticket.screenshot
                    ? `
                        <img
                            src="/uploads/support/${ticket.screenshot}"
                            class="ticket-image"
                            onclick="window.open('/uploads/support/${ticket.screenshot}','_blank')"
                        >
                    `
                    : ""
                }

                    ${ticket.adminReply
                    ? `
                        <div class="ticket-reply">

                            <b>
                                Admin Reply:
                            </b>

                            <p>
                                ${ticket.adminReply}
                            </p>

                        </div>
                    `
                    : ""
                }

                </div>

            `).join("");

    } catch (error) {

        console.log(error);

        box.innerHTML =
            "Failed to load tickets.";

    }

}