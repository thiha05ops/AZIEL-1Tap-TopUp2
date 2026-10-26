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
    let installInvoker = null;

    function syncActions() {
        const standalone = isStandalone();
        document.documentElement.classList.toggle("az-pwa-standalone", standalone);
        const visible = !standalone && (isIos || Boolean(deferredPrompt));
        document.querySelectorAll("[data-aziel-install-action]").forEach(button => {
            button.hidden = !visible;
            button.setAttribute("aria-hidden", String(!visible));
            button.toggleAttribute("inert", !visible);
        });
    }

    function closeMobileDrawer() {
        const header = document.querySelector(".az-header.mobile-menu-open");
        if (!header) return;
        header.classList.remove("mobile-menu-open");
        document.body.classList.remove("az-mobile-drawer-open");
        header.querySelector(".az-mobile-menu-btn")?.setAttribute("aria-expanded", "false");
    }

    function icon(path) {
        return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${path}"/></svg>`;
    }

    function showIosInstructions(invoker) {
        installInvoker = invoker || document.activeElement;
        let dialog = document.getElementById("azPwaInstallDialog");
        if (!dialog) {
            dialog = document.createElement("dialog");
            dialog.id = "azPwaInstallDialog";
            dialog.className = "az-pwa-install-dialog";
            dialog.innerHTML = `
                <div class="az-pwa-install-dialog__body" role="document">
                    <div class="az-pwa-install-dialog__handle" aria-hidden="true"></div>
                    <button class="az-pwa-install-dialog__x" type="button" data-aziel-install-close aria-label="Close">${icon("M6 6l12 12M18 6 6 18")}</button>
                    <h2 data-aziel-install-title></h2>
                    <p class="az-pwa-install-dialog__intro" data-aziel-install-copy></p>
                    <ol class="az-pwa-install-steps">
                        <li>${icon("M12 16V3M7.5 7.5 12 3l4.5 4.5M5 12v8h14v-8")}<span data-aziel-install-step="share"></span></li>
                        <li>${icon("M12 5v14M5 12h14")}<span data-aziel-install-step="home"></span></li>
                        <li>${icon("m5 12 4 4L19 6")}<span data-aziel-install-step="add"></span></li>
                    </ol>
                    <button class="az-pwa-install-dialog__done" type="button" data-aziel-install-close data-aziel-install-done></button>
                </div>`;
            dialog.addEventListener("click", event => {
                if (event.target === dialog || event.target.closest("[data-aziel-install-close]")) dialog.close();
            });
            dialog.addEventListener("close", () => installInvoker?.focus?.());
            document.body.appendChild(dialog);
        }
        dialog.querySelector("[data-aziel-install-title]").textContent = t("pwa_install_ios_title", "Add AZIEL to Home Screen");
        dialog.querySelector("[data-aziel-install-copy]").textContent = isSafari
            ? t("pwa_install_ios_safari", "In Safari, follow these steps:")
            : t("pwa_install_ios_other", "In your browser, follow these steps:");
        dialog.querySelector('[data-aziel-install-step="share"]').textContent = t("pwa_install_step_share", "Tap Share");
        dialog.querySelector('[data-aziel-install-step="home"]').textContent = t("pwa_install_step_home", "Choose Add to Home Screen");
        dialog.querySelector('[data-aziel-install-step="add"]').textContent = t("pwa_install_step_add", "Tap Add");
        dialog.querySelector("[data-aziel-install-done]").textContent = t("pwa_install_close", "Got it");
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
    window.addEventListener("aziel:headerSurfaceChanged", syncActions);

    document.addEventListener("click", async event => {
        const action = event.target.closest("[data-aziel-install-action]");
        if (!action || isStandalone()) return;
        closeMobileDrawer();
        if (isIos) {
            showIosInstructions(action);
            return;
        }
        if (!deferredPrompt) return;
        const prompt = deferredPrompt;
        deferredPrompt = null;
        syncActions();
        await prompt.prompt();
        await prompt.userChoice.catch(() => null);
    });

    window.AZIEL_PWA_INSTALL = Object.freeze({ syncActions, isStandalone });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncActions, { once: true });
    else syncActions();
})();
