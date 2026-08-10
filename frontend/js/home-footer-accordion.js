(function () {
    const MOBILE_FOOTER_QUERY = "(max-width: 900px)";

    function setupFooterAccordion() {
        const footer = document.querySelector(".site-footer");
        if (!footer) return;

        const candidates = [...footer.children].filter(group => (
            group.querySelector?.("h4") && !group.querySelector(".payment-logos")
        ));
        const groups = candidates.map(prepareGroup).filter(Boolean);
        const media = window.matchMedia(MOBILE_FOOTER_QUERY);

        function prepareGroup(group) {
            const heading = group.querySelector("h4");
            if (!heading) return null;
            group.classList.add("footer-accordion-group");

            let trigger = group.querySelector(".footer-accordion-trigger");
            let panel = group.querySelector(".footer-accordion-panel");
            if (trigger && panel) return group;

            const panelId = `footer-${String(heading.textContent || "links").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-panel`;
            trigger = document.createElement("button");
            trigger.className = "footer-accordion-trigger";
            trigger.type = "button";
            trigger.setAttribute("aria-expanded", "false");
            trigger.setAttribute("aria-controls", panelId);

            const label = document.createElement("span");
            label.textContent = heading.textContent;
            if (heading.dataset.i18n) label.dataset.i18n = heading.dataset.i18n;
            const icon = document.createElement("i");
            icon.className = "fa-solid fa-chevron-down";
            icon.setAttribute("aria-hidden", "true");
            trigger.append(label, icon);

            panel = document.createElement("div");
            panel.className = "footer-accordion-panel";
            panel.id = panelId;
            while (heading.nextSibling) panel.appendChild(heading.nextSibling);
            heading.after(trigger, panel);
            return group;
        }

        function closeGroup(group) {
            const trigger = group.querySelector(".footer-accordion-trigger");
            const panel = group.querySelector(".footer-accordion-panel");
            group.classList.remove("is-open");
            trigger?.setAttribute("aria-expanded", "false");
            if (panel) panel.hidden = media.matches;
        }

        function syncBreakpoint() {
            groups.forEach(group => {
                const panel = group.querySelector(".footer-accordion-panel");
                if (media.matches) {
                    closeGroup(group);
                } else {
                    group.classList.remove("is-open");
                    group.querySelector(".footer-accordion-trigger")?.setAttribute("aria-expanded", "false");
                    if (panel) panel.hidden = false;
                }
            });
        }

        groups.forEach(group => {
            const trigger = group.querySelector(".footer-accordion-trigger");
            const panel = group.querySelector(".footer-accordion-panel");
            if (!trigger || !panel) return;

            trigger.addEventListener("click", () => {
                if (!media.matches) return;
                const willOpen = trigger.getAttribute("aria-expanded") !== "true";
                groups.forEach(closeGroup);
                if (willOpen) {
                    group.classList.add("is-open");
                    trigger.setAttribute("aria-expanded", "true");
                    panel.hidden = false;
                }
            });
        });

        media.addEventListener?.("change", syncBreakpoint);
        syncBreakpoint();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setupFooterAccordion, { once: true });
    } else {
        setupFooterAccordion();
    }
})();
