setInterval(checkNewOrders, 5000);

let lastOrderCount = 0;

async function checkNewOrders() {

    try {

        const res =
            await fetch("/api/orders");

        const data =
            await res.json();

        if (!Array.isArray(data)) return;

        if (
            data.length > lastOrderCount &&
            lastOrderCount !== 0
        ) {

            showAdminAlert();

        }

        lastOrderCount =
            data.length;

    } catch (error) {

        console.log(error);

    }

}

function showAdminAlert() {

    const alertBox =
        document.getElementById(
            "adminAlert"
        );

    const sound =
        document.getElementById(
            "adminSound"
        );

    alertBox.style.display =
        "flex";

    sound.play();

}

function closeAdminAlert() {

    document.getElementById(
        "adminAlert"
    ).style.display = "none";

}