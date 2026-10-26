(function initializeOfflineHome() {
    const COPY = Object.freeze({
        en: { eyebrow: "AZIEL 1Tap Shop", title: "You're offline", description: "Your public Home is available in offline mode. Connect to refresh games, prices, and promotions.", notice: "Connection required for live actions.", checking: "Checking the AZIEL connection…", unavailable: "AZIEL is still unavailable. Try again when your connection improves.", retry: "Try connection", games: "Games", services: "Digital services", offers: "AZIEL offers", status: "Offline" },
        my: { eyebrow: "AZIEL 1Tap Shop", title: "အင်တာနက်ချိတ်ဆက်မှု မရှိပါ", description: "AZIEL ပင်မစာမျက်နှာကို Offline အနေဖြင့် ကြည့်နိုင်ပါသည်။ ဂိမ်းများ၊ စျေးနှုန်းများနှင့် Promotion များကို အသစ်ရယူရန် အင်တာနက်ချိတ်ဆက်ပါ။", notice: "အွန်လိုင်းလုပ်ဆောင်ချက်များအတွက် အင်တာနက်ချိတ်ဆက်ရန် လိုအပ်ပါသည်။", checking: "AZIEL ချိတ်ဆက်မှုကို စစ်ဆေးနေပါသည်…", unavailable: "AZIEL ကို မချိတ်ဆက်နိုင်သေးပါ။ အင်တာနက်ကောင်းလာသည့်အခါ ထပ်မံကြိုးစားပါ။", retry: "ချိတ်ဆက်မှု စစ်ဆေးမည်", games: "ဂိမ်းများ", services: "ဒစ်ဂျစ်တယ်ဝန်ဆောင်မှုများ", offers: "AZIEL အထူးကမ်းလှမ်းချက်များ", status: "Offline" },
        th: { eyebrow: "AZIEL 1Tap Shop", title: "คุณออฟไลน์อยู่", description: "คุณยังดูหน้าหลักแบบออฟไลน์ได้ เชื่อมต่ออินเทอร์เน็ตเพื่ออัปเดตเกม ราคา และโปรโมชั่น", notice: "ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อใช้งานฟังก์ชันออนไลน์", checking: "กำลังตรวจสอบการเชื่อมต่อกับ AZIEL…", unavailable: "ยังเชื่อมต่อ AZIEL ไม่ได้ โปรดลองอีกครั้งเมื่อสัญญาณดีขึ้น", retry: "ลองเชื่อมต่อ", games: "เกม", services: "บริการดิจิทัล", offers: "ข้อเสนอจาก AZIEL", status: "ออฟไลน์" }
    });
    const stored = (() => { try { return localStorage.getItem("azielLanguage"); } catch { return null; } })();
    const lang = Object.prototype.hasOwnProperty.call(COPY, stored) ? stored : "my";
    const copy = COPY[lang];
    const notice = document.querySelector("[data-offline-notice]");
    const retry = document.querySelector("[data-offline-retry]");
    let recovery = null;
    let lastAttempt = 0;

    document.documentElement.lang = lang;
    document.querySelectorAll("[data-offline-copy]").forEach(node => { node.textContent = copy[node.dataset.offlineCopy]; });
    document.querySelector("[data-offline-status]").textContent = copy.status;
    notice.textContent = copy.notice;

    async function refreshPublicHomeCache() {
        const controller = navigator.serviceWorker?.controller;
        if (!controller || typeof MessageChannel === "undefined") return;
        await new Promise(resolve => {
            const channel = new MessageChannel();
            const timeout = window.setTimeout(resolve, 2500);
            channel.port1.onmessage = () => { window.clearTimeout(timeout); resolve(); };
            controller.postMessage({ type: "REFRESH_PUBLIC_HOME" }, [channel.port2]);
        });
    }

    async function recover() {
        if (recovery || Date.now() - lastAttempt < 3000) return recovery;
        lastAttempt = Date.now();
        retry.disabled = true;
        notice.textContent = copy.checking;
        recovery = (async () => {
            const abort = new AbortController();
            const timeout = window.setTimeout(() => abort.abort(), 5000);
            try {
                const response = await fetch("/ready", { cache: "no-store", credentials: "same-origin", signal: abort.signal });
                if (!response.ok) throw new Error("backend-not-ready");
                await refreshPublicHomeCache();
                window.location.replace("/");
            } catch {
                notice.textContent = copy.unavailable;
            } finally {
                window.clearTimeout(timeout);
                retry.disabled = false;
                recovery = null;
            }
        })();
        return recovery;
    }

    retry.addEventListener("click", recover);
    window.addEventListener("online", recover);
})();
