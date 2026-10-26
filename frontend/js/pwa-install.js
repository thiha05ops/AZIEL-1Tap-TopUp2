(function initializeAzielPwaInstall() {
    if (window.__AZIEL_PWA_INSTALL_INITIALIZED__) return;
    window.__AZIEL_PWA_INSTALL_INITIALIZED__ = true;

    let deferredPrompt = null;
    const standaloneQuery = window.matchMedia?.("(display-mode: standalone)");
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isSafari = isIos && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

    const isStandalone = () => Boolean(standaloneQuery?.matches || navigator.standalone === true);
    const t = (key, fallback) => window.AZIEL_I18N?.t?.(key, fallback) || fallback;

    function syncActions() {
        const visible = !isStandalone() && (isIos || Boolean(deferredPrompt));
        document.querySelectorAll("[data-aziel-install-action]").forEach(button => {
            button.hidden = !visible;
            button.setAttribute("aria-hidden", String(!visible));
        });
    }

    function closeMobileDrawer() {
        const header = document.querySelector(".az-header.mobile-menu-open");
        if (!header) return;
        header.classList.remove("mobile-menu-open");
        document.body.classList.remove("az-mobile-drawer-open");
        header.querySelector(".az-mobile-menu-btn")?.setAttribute("aria-expanded", "false");
    }

    function showIosInstructions() {
        let dialog = document.getElementById("azPwaInstallDialog");
        if (!dialog) {
            dialog = document.createElement("dialog");
            dialog.id = "azPwaInstallDialog";
            dialog.className = "az-pwa-install-dialog";
            dialog.innerHTML = `
                <div class="az-pwa-install-dialog__body">
                    <h2 data-aziel-install-title></h2>
                    <p data-aziel-install-copy></p>
                    <button type="button" data-aziel-install-close></button>
                </div>`;
            dialog.addEventListener("click", event => {
                if (event.target === dialog || event.target.closest("[data-aziel-install-close]")) dialog.close();
            });
            document.body.appendChild(dialog);
        }
        dialog.querySelector("[data-aziel-install-title]").textContent = t("pwa_install_ios_title", "Add AZIEL to Home Screen");
        dialog.querySelector("[data-aziel-install-copy]").textContent = isSafari
            ? t("pwa_install_ios_safari", "Tap Share, then choose Add to Home Screen.")
            : t("pwa_install_ios_other", "Open your browser's Share menu, then choose Add to Home Screen.");
        dialog.querySelector("[data-aziel-install-close]").textContent = t("pwa_install_close", "Got it");
        dialog.showModal();
    }

    window.addEventListener("beforeinstallprompt", event => {
        event.preventDefault();
        deferredPrompt = event;
        syncActions();
    });

    window.addEventListener("appinstalled", () => {
        deferredPrompt = null;
        syncActions();
    });
    standaloneQuery?.addEventListener?.("change", syncActions);
    window.addEventListener("aziel:headerLoaded", syncActions);

    document.addEventListener("click", async event => {
        const action = event.target.closest("[data-aziel-install-action]");
        if (!action || isStandalone()) return;
        closeMobileDrawer();
        if (isIos) {
            showIosInstructions();
            return;
        }
        if (!deferredPrompt) return;
        const prompt = deferredPrompt;
        deferredPrompt = null;
        syncActions();
        await prompt.prompt();
        await prompt.userChoice.catch(() => null);
    });

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncActions, { once: true });
    else syncActions();
})();
