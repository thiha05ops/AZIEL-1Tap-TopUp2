// AZIEL centralized user-facing payment display names.

(function () {
    const LABELS = Object.freeze({
        ayapay: "AYA Pay",
        kbzpay: "KBZPay",
        wavepay: "WavePay",
        promptpay: "PromptPay",
        scb: "SCB",
        bangkokbank: "Bangkok Bank",
        wallet: "AZIEL Wallet",
        azielwallet: "AZIEL Wallet"
    });

    function normalize(value) {
        return String(value || "")
            .toLowerCase()
            .trim()
            .replace(/aziel\s*wallet/g, "azielwallet")
            .replace(/bangkok\s*bank/g, "bangkokbank")
            .replace(/prompt\s*pay/g, "promptpay")
            .replace(/\s+/g, "")
            .replace(/[-_]/g, "")
            .replace(/[^a-z0-9]/g, "");
    }

    function from(value, fallback = "") {
        const key = normalize(value);
        if (LABELS[key]) return LABELS[key];
        if (key.includes("ayapay")) return LABELS.ayapay;
        if (key.includes("kbzpay")) return LABELS.kbzpay;
        if (key.includes("wavepay")) return LABELS.wavepay;
        if (key.includes("promptpay")) return LABELS.promptpay;
        if (key.includes("bangkokbank")) return LABELS.bangkokbank;
        if (key === "scb" || key.includes("scb")) return LABELS.scb;
        if (key === "wallet" || key.includes("azielwallet")) return LABELS.wallet;
        return fallback || String(value || "");
    }

    function method(method = {}, fallback = "Payment") {
        return from(
            method.key ||
            method.paymentMethod ||
            method.method ||
            method.name ||
            method.provider ||
            "",
            from(method.method || method.name || method.paymentMethod || "", fallback)
        );
    }

    function replaceInText(value = "") {
        let text = String(value ?? "");
        [
            [/\baya[\s_-]*pay\b/gi, LABELS.ayapay],
            [/\bkbz[\s_-]*pay\b/gi, LABELS.kbzpay],
            [/\bwave[\s_-]*pay\b/gi, LABELS.wavepay],
            [/\bprompt[\s_-]*pay\b/gi, LABELS.promptpay],
            [/\bbangkok[\s_-]*bank\b/gi, LABELS.bangkokbank],
            [/\baziel[\s_-]*wallet\b/gi, LABELS.wallet],
            [/\bwallet\b/gi, LABELS.wallet],
            [/\bscb\b/gi, LABELS.scb]
        ].forEach(([pattern, label]) => {
            text = text.replace(pattern, label);
        });
        return text;
    }

    window.AZIEL_PAYMENT_DISPLAY = Object.freeze({
        labels: LABELS,
        normalize,
        from,
        method,
        replaceInText
    });
})();
