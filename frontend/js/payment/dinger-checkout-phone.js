(function () {
    "use strict";

    let profilePromise = null;
    let inputTouched = false;

    function isWavePay(payment = window.selectedPaymentData || {}) {
        return String(payment.key || "").trim().toLowerCase() === "dinger_wavepay_pin";
    }

    function normalize(value) {
        let phone = String(value || "").trim().replace(/[\s().-]/g, "");
        if (phone.startsWith("+95")) phone = `0${phone.slice(3)}`;
        else if (phone.startsWith("95")) phone = `0${phone.slice(2)}`;
        return /^09\d{7,9}$/.test(phone) ? phone : "";
    }

    async function loadSavedPhone() {
        if (!profilePromise) {
            profilePromise = fetch("/api/profile/me", {
                credentials: "same-origin",
                headers: window.PaymentUtils?.authHeaders?.() || {}
            }).then(async response => {
                const data = await response.json().catch(() => ({}));
                return response.ok && data?.success ? String(data.user?.phone || "") : "";
            }).catch(() => "");
        }
        return profilePromise;
    }

    function ensureField() {
        const grid = document.getElementById("paymentGrid");
        if (!grid) return null;
        let field = document.getElementById("dingerWavePhoneField");
        if (!field) {
            field = document.createElement("div");
            field.id = "dingerWavePhoneField";
            field.className = "dinger-wave-phone";
            field.hidden = true;
            field.innerHTML = `<label for="dingerWavePhone">Myanmar mobile number</label><p>Used by Dinger to open the secure Wave Pay payment flow. Your Wave Pay PIN is entered only on Dinger.</p><input id="dingerWavePhone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="16" placeholder="09xxxxxxxxx" aria-describedby="dingerWavePhoneHelp"><small id="dingerWavePhoneHelp">Enter a Myanmar mobile number beginning with 09.</small>`;
            grid.insertAdjacentElement("afterend", field);
            field.querySelector("input")?.addEventListener("input", () => {
                inputTouched = true;
                field.classList.remove("has-error");
            });
        }
        return field;
    }

    async function refresh() {
        const field = ensureField();
        if (!field) return;
        const wave = isWavePay();
        field.hidden = !wave;
        if (!wave) return;
        const input = field.querySelector("input");
        if (!inputTouched && input && !input.value) input.value = await loadSavedPhone();
    }

    async function phoneFor(payment) {
        if (!isWavePay(payment)) return "";
        await refresh();
        const field = ensureField();
        const input = field?.querySelector("input");
        const phone = normalize(input?.value);
        field?.classList.toggle("has-error", !phone);
        if (!phone) {
            input?.focus();
            throw new Error("Enter a valid Myanmar mobile number beginning with 09.");
        }
        input.value = phone;
        return phone;
    }

    document.addEventListener("paymentChanged", refresh);
    document.addEventListener("DOMContentLoaded", refresh);
    window.AZIEL_DINGER_CHECKOUT_PHONE = Object.freeze({ phoneFor, normalize, refresh });
})();
