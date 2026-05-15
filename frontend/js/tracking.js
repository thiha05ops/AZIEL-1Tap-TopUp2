// frontend/js/tracking.js

let lastStatus = "";

document.addEventListener("DOMContentLoaded", () => {

    const params =
        new URLSearchParams(
            window.location.search
        );

    const orderIdFromUrl =
        params.get("orderId");

    if (orderIdFromUrl) {

        document.getElementById(
            "orderIdInput"
        ).value = orderIdFromUrl;

        trackOrder(orderIdFromUrl);

    }

    document
        .getElementById("trackBtn")
        ?.addEventListener("click", () => {

            const orderId =
                document
                    .getElementById(
                        "orderIdInput"
                    )
                    .value
                    .trim();

            if (!orderId) {

                document
                    .getElementById(
                        "trackingResult"
                    )
                    .innerHTML = `
                        <p class="error-msg">
                            Please enter Order ID.
                        </p>
                    `;

                return;
            }

            trackOrder(orderId);

        });

    setInterval(
        checkLiveTracking,
        5000
    );

});


// ======================
// TRACK ORDER
// ======================

async function trackOrder(orderId) {

    const result =
        document.getElementById(
            "trackingResult"
        );

    result.innerHTML =
        `<p>Loading...</p>`;

    try {

        const res =
            await fetch(
                `/api/order/track/${orderId}`
            );

        const data =
            await res.json();

        if (
            !data.success ||
            !data.order
        ) {

            result.innerHTML = `
                <p class="error-msg">
                    ${data.message}
                </p>
            `;

            return;
        }

        const o = data.order;

        lastStatus = o.status;

        result.innerHTML = `
            <div class="track-card">

                <h2>${o.game}</h2>

                <p>
                    <b>Order ID:</b>
                    ${o.orderId}
                </p>

                <p>
                    <b>User ID:</b>
                    ${o.userId}
                </p>

                <p>
                    <b>Server:</b>
                    ${o.zoneId || "-"}
                </p>

                <p>
                    <b>Package:</b>
                    ${o.packageName}
                </p>

                <p>
                    <b>Amount:</b>
                    ${o.amount}
                    ${o.currency}
                </p>

                <p>
                    <b>Payment:</b>
                    ${o.paymentMethod}
                </p>

                <div class="tracking-wrapper">

                    <div class="tracking-timeline">

                        <div class="tracking-step"
                            id="stepPending">

                            <div class="tracking-circle"></div>

                            <span>Pending</span>

                        </div>

                        <div class="tracking-line"></div>

                        <div class="tracking-step"
                            id="stepPaid">

                            <div class="tracking-circle"></div>

                            <span>Paid</span>

                        </div>

                        <div class="tracking-line"></div>

                        <div class="tracking-step"
                            id="stepProcessing">

                            <div class="tracking-circle"></div>

                            <span>Processing</span>

                        </div>

                        <div class="tracking-line"></div>

                        <div class="tracking-step"
                            id="stepCompleted">

                            <div class="tracking-circle"></div>

                            <span>Completed</span>

                        </div>

                    </div>

                </div>

                <p class="track-note">
                    ${o.note ||
            "Please wait while we process your order."
            }
                </p>

            </div>
        `;

        updateTrackingSteps(
            o.status
        );

    } catch (error) {

        console.log(error);

        result.innerHTML = `
            <p class="error-msg">
                Server error.
            </p>
        `;

    }

}


// ======================
// LIVE TRACKING
// ======================

async function checkLiveTracking() {

    try {

        const params =
            new URLSearchParams(
                window.location.search
            );

        const orderId =
            params.get("orderId");

        if (!orderId) return;

        const res =
            await fetch(
                `/api/order/track/${orderId}`
            );

        const data =
            await res.json();

        if (
            !data.success ||
            !data.order
        ) return;

        const order =
            data.order;

        if (
            order.status !==
            lastStatus
        ) {

            lastStatus =
                order.status;

            showTrackingPopup(
                order.status
            );

            trackOrder(orderId);

        }

    } catch (error) {

        console.log(
            "Live tracking error:",
            error
        );

    }

}


// ======================
// UPDATE STEPS
// ======================

function updateTrackingSteps(status) {

    const steps = {

        pending_payment: [
            "stepPending"
        ],

        paid: [
            "stepPending",
            "stepPaid"
        ],

        processing: [
            "stepPending",
            "stepPaid",
            "stepProcessing"
        ],

        completed: [
            "stepPending",
            "stepPaid",
            "stepProcessing",
            "stepCompleted"
        ]

    };

    document
        .querySelectorAll(
            ".tracking-step"
        )
        .forEach(step => {

            step.classList.remove(
                "active"
            );

        });

    (
        steps[status] || []
    ).forEach(id => {

        document
            .getElementById(id)
            ?.classList.add(
                "active"
            );

    });

}


// ======================
// POPUP
// ======================

function showTrackingPopup(status) {

    const oldPopup =
        document.querySelector(
            ".tracking-popup"
        );

    if (oldPopup)
        oldPopup.remove();

    const popup =
        document.createElement("div");

    popup.className =
        "tracking-popup";

    popup.innerHTML = `
        🔔 Order Status Updated:
        <b>${status}</b>
    `;

    document.body.appendChild(
        popup
    );

    setTimeout(() => {

        popup.classList.add(
            "show"
        );

    }, 100);

    setTimeout(() => {

        popup.classList.remove(
            "show"
        );

        setTimeout(() => {

            popup.remove();

        }, 400);

    }, 4000);

}


// ======================
// STATUS CLASS
// ======================

function statusClass(status) {

    if (status === "paid")
        return "status-paid";

    if (status === "processing")
        return "status-processing";

    if (status === "completed")
        return "status-completed";

    if (
        status === "cancelled" ||
        status === "failed"
    )
        return "status-failed";

    return "status-pending";

}