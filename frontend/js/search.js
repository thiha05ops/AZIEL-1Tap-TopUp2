/* =========================
   CATALOG-BACKED LIVE SEARCH
========================= */

document.addEventListener("DOMContentLoaded", () => {
    initLiveSearch();
});

function escapeSearchHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

async function getSearchItems() {
    if (!window.AZIEL_CATALOG) return [];

    try {
        await window.AZIEL_CATALOG.load();
    } catch {
        return [];
    }

    return window.AZIEL_CATALOG.getProducts()
        .filter(item => item.route)
        .map(item => ({
            name: item.name,
            desc: item.searchDescription || item.description || "Top Up",
            img: window.AZIEL_CATALOG_PRESENTATION?.resolveProductImage?.(item) || item.image,
            fallbackImg: item.fallbackImage || window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(item.productCode) || "",
            link: item.route,
            productCode: item.productCode
        }));
}

async function initLiveSearch() {
    const input = document.getElementById("searchInput");
    const dropdown = document.getElementById("searchDropdown");

    if (!input || !dropdown) return;

    let searchItems = await getSearchItems();

    document.addEventListener("aziel:catalog-updated", async event => {
        if (event.detail?.status === "ready") {
            searchItems = await getSearchItems();
        }
    });

    input.addEventListener("input", () => {
        const keyword = input.value.toLowerCase().trim();

        if (!keyword) {
            dropdown.classList.remove("show");
            dropdown.innerHTML = "";
            return;
        }

        const results = searchItems.filter(item =>
            item.name.toLowerCase().includes(keyword) ||
            item.desc.toLowerCase().includes(keyword) ||
            item.productCode.toLowerCase().includes(keyword)
        );

        if (!results.length) {
            dropdown.innerHTML = `<div class="no-search">No result found</div>`;
            dropdown.classList.add("show");
            return;
        }

        dropdown.innerHTML = results.map(item => `
            <a href="${escapeSearchHtml(item.link)}" class="search-item" data-product-code="${escapeSearchHtml(item.productCode)}">
                <img src="${escapeSearchHtml(item.img)}" alt="${escapeSearchHtml(item.name)}"${window.AZIEL_CATALOG_PRESENTATION?.imageFallbackAttributes?.(item.fallbackImg) || ""}>
                <div>
                    <h4>${escapeSearchHtml(item.name)}</h4>
                    <p>${escapeSearchHtml(item.desc)}</p>
                </div>
            </a>
        `).join("");

        dropdown.classList.add("show");
        window.AZIEL_CATALOG_PRESENTATION?.bindImageFallbacks?.(dropdown);
    });

    document.addEventListener("click", e => {
        if (!e.target.closest(".search-box")) {
            dropdown.classList.remove("show");
        }
    });
}
