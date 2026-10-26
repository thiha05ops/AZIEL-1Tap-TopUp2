(function initializeOfflineHome() {
    const COPY = Object.freeze({
        en: { title: "Connection unavailable", description: "Browse the saved Home layout while AZIEL reconnects.", notice: "Online access is required for live actions.", checking: "Checking AZIEL…", unavailable: "AZIEL is still unavailable. Try again shortly.", retry: "Retry", section: "Explore AZIEL", connectionRequired: "Connection required", status: "Offline" },
        my: { title: "အင်တာနက် မချိတ်ဆက်ရသေးပါ", description: "AZIEL ပြန်လည်ချိတ်ဆက်နေစဉ် သိမ်းထားသော ပင်မစာမျက်နှာကို ကြည့်နိုင်ပါသည်။", notice: "လုပ်ဆောင်ချက်များအတွက် အင်တာနက်လိုအပ်ပါသည်။", checking: "AZIEL ချိတ်ဆက်မှု စစ်ဆေးနေပါသည်…", unavailable: "AZIEL ကို မချိတ်ဆက်နိုင်သေးပါ။ ခဏနေ ထပ်စမ်းပါ။", retry: "ထပ်စမ်းမည်", section: "AZIEL ကို လေ့လာရန်", connectionRequired: "အင်တာနက်လိုအပ်သည်", status: "အော့ဖ်လိုင်း" },
        th: { title: "ยังไม่ได้เชื่อมต่ออินเทอร์เน็ต", description: "ดูโครงหน้าหลักที่บันทึกไว้ระหว่างเชื่อมต่อ AZIEL อีกครั้ง", notice: "ฟังก์ชันต่าง ๆ ต้องใช้อินเทอร์เน็ต", checking: "กำลังตรวจสอบ AZIEL…", unavailable: "ยังเชื่อมต่อ AZIEL ไม่ได้ โปรดลองอีกครั้งในอีกสักครู่", retry: "ลองอีกครั้ง", section: "สำรวจ AZIEL", connectionRequired: "ต้องเชื่อมต่ออินเทอร์เน็ต", status: "ออฟไลน์" }
    });
    const stored = (() => { try { return localStorage.getItem("azielLanguage"); } catch { return null; } })();
    const lang = Object.prototype.hasOwnProperty.call(COPY, stored) ? stored : "my";
    const copy = COPY[lang];
    const storedRegion = (() => { try { return localStorage.getItem("shopRegion") || localStorage.getItem("selectedRegion") || localStorage.getItem("region"); } catch { return null; } })();
    const region = String(storedRegion || "MM").toUpperCase() === "TH" ? "TH · ฿" : "MM · Ks";
    const notice = document.querySelector("[data-offline-notice]");
    const retry = document.querySelector("[data-offline-retry]");
    let recovery = null;
    let lastAttempt = 0;

    document.documentElement.lang = lang;
    document.querySelectorAll("[data-offline-copy]").forEach(node => { node.textContent = copy[node.dataset.offlineCopy]; });
    document.querySelector("[data-offline-status]").textContent = copy.status;
    document.querySelector("[data-offline-region]").textContent = region;
    notice.textContent = copy.notice;

    const themeMedia = window.matchMedia?.("(prefers-color-scheme: dark)");
    const storedTheme = (() => { try { return localStorage.getItem("azielTheme") || localStorage.getItem("theme"); } catch { return null; } })();
    const followsSystemTheme = storedTheme !== "dark" && storedTheme !== "light";
    const syncSystemTheme = event => {
        if (!followsSystemTheme) return;
        const mode = event.matches ? "dark" : "light";
        document.documentElement.classList.toggle("theme-dark", mode === "dark");
        document.documentElement.classList.toggle("theme-light", mode === "light");
        document.documentElement.dataset.theme = mode;
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0d0d0f" : "#f5f6fb");
    };
    syncSystemTheme(themeMedia || { matches: document.documentElement.classList.contains("theme-dark") });
    themeMedia?.addEventListener?.("change", syncSystemTheme);

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
