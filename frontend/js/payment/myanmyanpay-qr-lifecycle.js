(function () {
    "use strict";

    const VALIDITY_MS = 15 * 60 * 1000;
    const KEYS = Object.freeze({
        payWithin: "payment.mmqrExpiry.payWithin",
        activeInstruction: "payment.mmqrExpiry.activeInstruction",
        activeWarning: "payment.mmqrExpiry.activeWarning",
        expiredTitle: "payment.mmqrExpiry.expiredTitle",
        expiredWarning: "payment.mmqrExpiry.expiredWarning",
        expiredExplanation: "payment.mmqrExpiry.expiredExplanation",
        startNewPayment: "payment.mmqrExpiry.startNewPayment",
        startNewTopup: "payment.mmqrExpiry.startNewTopup"
    });
    const COPY = Object.freeze({
        en: Object.freeze({
            payWithin: "Pay within {time}",
            activeInstruction: "Scan and complete your payment before the timer ends.\nYour payment will be confirmed automatically.",
            activeWarning: "Do not make a payment after the timer reaches 00:00.",
            expiredTitle: "QR Expired",
            expiredWarning: "Do not make a payment using this QR.",
            expiredExplanation: "This payment QR has expired.\nPayments made using an expired QR will not be accepted by AZIEL.",
            startNewPayment: "Start New Payment",
            startNewTopup: "Start New Top-up"
        }),
        my: Object.freeze({
            payWithin: "{time} အတွင်း ငွေပေးချေပါ",
            activeInstruction: "အချိန်မကုန်မီ QR ကို Scan ဖတ်ပြီး ငွေပေးချေပါ။\nငွေပေးချေမှု အောင်မြင်ပါက အလိုအလျောက် အတည်ပြုပေးပါမည်။",
            activeWarning: "Timer 00:00 ရောက်ပြီးနောက် ဒီ QR ဖြင့် ငွေမပေးချေပါနှင့်။",
            expiredTitle: "QR သက်တမ်းကုန်သွားပါပြီ",
            expiredWarning: "ဒီ QR ဖြင့် ငွေမပေးချေပါနှင့်။",
            expiredExplanation: "ဒီ Payment QR ရဲ့ သက်တမ်းကုန်သွားပါပြီ။\nသက်တမ်းကုန်ပြီးသော QR ဖြင့် ပြုလုပ်သည့် ငွေပေးချေမှုကို AZIEL မှ လက်ခံမည်မဟုတ်ပါ။",
            startNewPayment: "Payment အသစ်စတင်ရန်",
            startNewTopup: "Top-up အသစ်စတင်ရန်"
        }),
        th: Object.freeze({
            payWithin: "ชำระเงินภายใน {time}",
            activeInstruction: "สแกน QR และชำระเงินให้เสร็จก่อนหมดเวลา\nระบบจะยืนยันการชำระเงินให้อัตโนมัติ",
            activeWarning: "อย่าชำระเงินด้วย QR นี้หลังจากเวลาถึง 00:00",
            expiredTitle: "QR หมดอายุแล้ว",
            expiredWarning: "อย่าชำระเงินด้วย QR นี้",
            expiredExplanation: "QR สำหรับการชำระเงินนี้หมดอายุแล้ว\nAZIEL จะไม่รับการชำระเงินที่ทำผ่าน QR ที่หมดอายุแล้ว",
            startNewPayment: "เริ่มการชำระเงินใหม่",
            startNewTopup: "เริ่มเติมเงินใหม่"
        })
    });

    function language() {
        const value = String(window.AZIEL_I18N?.getLang?.() || document.documentElement?.lang || "en").toLowerCase();
        return value.startsWith("my") ? "my" : value.startsWith("th") ? "th" : "en";
    }

    function installTranslations() {
        window.AZIEL_LANG = window.AZIEL_LANG || {};
        Object.entries(COPY).forEach(([code, translations]) => {
            window.AZIEL_LANG[code] = window.AZIEL_LANG[code] || {};
            Object.entries(translations).forEach(([name, translated]) => {
                window.AZIEL_LANG[code][KEYS[name]] = translated;
            });
        });
    }

    function text(key, params = {}) {
        installTranslations();
        const fallback = COPY[language()]?.[key] || COPY.en[key] || key;
        const template = window.AZIEL_I18N?.t?.(KEYS[key], fallback) || fallback;
        return Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), template);
    }

    function state(createdAt, now = Date.now()) {
        const startedAtMs = new Date(createdAt).getTime();
        const nowMs = Number(now);
        if (!createdAt || !Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return Object.freeze({ valid: false, expired: false, remainingSeconds: 0, deadlineMs: 0 });
        const deadlineMs = startedAtMs + VALIDITY_MS;
        const remainingSeconds = Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
        return Object.freeze({ valid: true, expired: remainingSeconds === 0, remainingSeconds, deadlineMs });
    }

    function format(seconds) {
        const safe = Math.max(0, Math.floor(Number(seconds) || 0));
        return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
    }

    function start({ createdAt, onTick, onExpire, onLocaleChange, now = Date.now, setInterval: schedule = window.setInterval.bind(window), clearInterval: clear = window.clearInterval.bind(window) } = {}) {
        let timer = null;
        let expiredNotified = false;
        const tick = () => {
            const current = state(createdAt, now());
            onTick?.(current);
            if (current.expired && !expiredNotified) {
                expiredNotified = true;
                onExpire?.(current);
            }
            if ((!current.valid || current.expired) && timer !== null) {
                clear(timer);
                timer = null;
            }
            return current;
        };
        const initial = tick();
        if (initial.valid && !initial.expired) timer = schedule(tick, 1000);
        const localeChanged = () => onLocaleChange?.(state(createdAt, now()));
        window.addEventListener?.("aziel:languageChanged", localeChanged);
        window.addEventListener?.("aziel:locale-changed", localeChanged);
        return () => {
            if (timer !== null) clear(timer);
            timer = null;
            window.removeEventListener?.("aziel:languageChanged", localeChanged);
            window.removeEventListener?.("aziel:locale-changed", localeChanged);
        };
    }

    installTranslations();
    window.addEventListener?.("aziel:languageChanged", installTranslations);
    window.addEventListener?.("aziel:locale-changed", installTranslations);
    window.AZIEL_MYANMYANPAY_QR_LIFECYCLE = Object.freeze({ VALIDITY_MS, KEYS, COPY, text, state, format, start });
})();
