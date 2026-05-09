function showAdminAlert(text) {

    let alertBox =
        document.getElementById(
            "adminLiveAlert"
        );

    if (!alertBox) {

        alertBox =
            document.createElement("div");

        alertBox.id =
            "adminLiveAlert";

        document.body.appendChild(
            alertBox
        );

    }

    alertBox.innerHTML = `
        <div style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:20px;
        ">

            <div>
                ${text}
            </div>

            <button
                onclick="
                    document.getElementById(
                        'adminLiveAlert'
                    ).style.display='none'
                "
                style="
                    background:#111827;
                    color:white;
                    border:none;
                    padding:8px 14px;
                    border-radius:10px;
                    cursor:pointer;
                    font-weight:700;
                "
            >
                Close
            </button>

        </div>
    `;

    alertBox.style.position =
        "fixed";

    alertBox.style.top =
        "20px";

    alertBox.style.right =
        "20px";

    alertBox.style.background =
        "linear-gradient(135deg,#ffd700,#ffb800)";

    alertBox.style.color =
        "#111";

    alertBox.style.padding =
        "18px 22px";

    alertBox.style.borderRadius =
        "18px";

    alertBox.style.fontWeight =
        "900";

    alertBox.style.zIndex =
        "99999";

    alertBox.style.minWidth =
        "320px";

    alertBox.style.boxShadow =
        "0 0 30px rgba(255,215,0,.45)";

    alertBox.style.display =
        "block";

    setTimeout(() => {

        if (alertBox) {

            alertBox.style.display =
                "none";

        }

    }, 5000);

}