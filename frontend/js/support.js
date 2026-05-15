let supportSocketStarted = false;
document.addEventListener("DOMContentLoaded", () => {

    loadMyTickets();
    startSupportLiveSystem();

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
function startSupportLiveSystem() {

    if (supportSocketStarted)
        return;

    supportSocketStarted = true;

    if (typeof io === "undefined") {
        console.log(
            "Socket.IO not loaded"
        );
        return;
    }

    const username =
        localStorage.getItem(
            "username"
        );

    if (!username) return;

    const socket = io();

    socket.emit(
        "joinUser",
        username
    );



    socket.on(
        "newNotification",

        data => {

            console.log(
                "🔔 Support Live:",
                data
            );

            // support reply only
            if (
                data.title ===
                "Support Reply"
            ) {

                showSupportPopup(
                    data.message
                );

                playSupportSound();

                loadMyTickets();

            }

        }

    );

}
function showSupportPopup(message) {

    const old =
        document.querySelector(
            ".support-live-popup"
        );

    if (old) old.remove();

    const popup =
        document.createElement("div");

    popup.className =
        "support-live-popup";

    popup.innerHTML = `
        🔔 ${message}
    `;

    document.body.appendChild(
        popup
    );

    popup.style.position =
        "fixed";

    popup.style.top =
        "20px";

    popup.style.right =
        "-400px";

    popup.style.padding =
        "18px";

    popup.style.borderRadius =
        "18px";

    popup.style.background =
        "linear-gradient(135deg,#3b82f6,#2563eb)";

    popup.style.color =
        "#fff";

    popup.style.fontWeight =
        "800";

    popup.style.zIndex =
        "999999";

    popup.style.transition =
        ".4s";

    popup.style.boxShadow =
        "0 12px 40px rgba(0,0,0,.35)";

    setTimeout(() => {

        popup.style.right =
            "20px";

    }, 100);

    setTimeout(() => {

        popup.style.right =
            "-400px";

        setTimeout(() => {

            popup.remove();

        }, 400);

    }, 5000);

}
function playSupportSound() {

    const audio =
        new Audio(
            "/assets/sounds/notify.mp3"
        );

    audio.volume = 1;

    audio.play();

}