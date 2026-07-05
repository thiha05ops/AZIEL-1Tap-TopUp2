// frontend/js/payment/payment-utils.js
// AZIEL Payment Utilities V2.5

(function () {

    const API_BASE =
        location.port === "5500"
            ? "http://localhost:3000"
            : "";

    function apiUrl(path) {
        return `${API_BASE}${path}`;
    }

    function normalizeUrl(path) {

        if (!path) return "";

        if (
            path.startsWith("http") ||
            path.startsWith("data:")
        ) {
            return path;
        }

        path = path.replace(/^\/+/, "");

        if (location.port === "5500") {
            return path;
        }

        return "/" + path;
    }

    function escapeHTML(value) {

        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function copy(text) {

        navigator.clipboard.writeText(String(text));

        if (window.showAdminToast) {
            showAdminToast("Copied", "success");
        } else {
            alert("Copied");
        }

    }

    function showLoading() {

        document
            .getElementById("orderLoadingOverlay")
            ?.classList.add("show");

    }

    function hideLoading() {

        document
            .getElementById("orderLoadingOverlay")
            ?.classList.remove("show");

    }

    let timer = null;

    function startCountdown(seconds = 600) {

        stopCountdown();

        const countdown =
            document.getElementById("countdown");

        if (!countdown) return;

        function tick() {

            const m = Math.floor(seconds / 60);
            const s = seconds % 60;

            countdown.innerText =
                `${m}:${String(s).padStart(2, "0")}`;

            if (seconds <= 0) {

                stopCountdown();

                return;

            }

            seconds--;

        }

        tick();

        timer = setInterval(tick, 1000);

    }

    function stopCountdown() {

        if (timer) {

            clearInterval(timer);

            timer = null;

        }

    }

    window.PaymentUtils = {

        apiUrl,

        normalizeUrl,

        escapeHTML,

        copy,

        showLoading,

        hideLoading,

        startCountdown,

        stopCountdown

    };

})();