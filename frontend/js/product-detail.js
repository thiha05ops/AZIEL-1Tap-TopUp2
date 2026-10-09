// Generic canonical product-detail shell for canonical products without a dedicated static page.

(function () {
    function productCodeFromUrl() {
        const queryCode = new URLSearchParams(window.location.search).get("product");
        const pathMatch = window.location.pathname.match(/^\/products\/([a-z0-9][a-z0-9-]{0,79})\/?$/i);
        return String(queryCode || pathMatch?.[1] || "").trim().toLowerCase();
    }

    function applyText(selector, value) {
        const node = document.querySelector(selector);
        if (!node) return;
        node.removeAttribute("data-i18n");
        node.setAttribute("data-i18n-skip", "true");
        node.textContent = value;
    }

    function applyPlaceholder(selector, value) {
        const node = document.querySelector(selector);
        if (!node) return;
        node.removeAttribute("data-i18n-placeholder");
        node.setAttribute("data-i18n-skip", "true");
        node.setAttribute("placeholder", value);
    }

    const productCode = productCodeFromUrl();
    if (productCode) {
        const canonicalUrl = `${window.location.origin}/products/${encodeURIComponent(productCode)}`;
        document.getElementById("productCanonicalUrl")?.setAttribute("href", canonicalUrl);
        document.getElementById("productOpenGraphUrl")?.setAttribute("content", canonicalUrl);
    }
    const route = window.AZIEL_CATALOG_PRESENTATION?.resolveProductRoute?.("", productCode) || "";

    if (!route) {
        document.documentElement.dataset.publicProductState = "HIDDEN";
        return;
    }

    document.getElementById("packages")?.setAttribute("data-game", productCode);

    async function bootstrap() {
        try {
            await window.AZIEL_CATALOG?.ensureFresh?.();
        } catch (_) {
            document.documentElement.dataset.publicProductState = "HIDDEN";
            return null;
        }
        const product = window.AZIEL_CATALOG?.getProduct?.(productCode);
        if (!product) {
            document.documentElement.dataset.publicProductState = "HIDDEN";
            return null;
        }
        const name = product.name || productCode;
        const tag = product.displayMarketLabel || String(product.catalogCategory || "Product").replaceAll("_", " ");
        const packagePrompt = product.productKnowledge?.shortDescription || product.description || "Select an available package.";
        applyText("[data-product-title]", name);
        applyText("[data-product-tag]", tag);
        applyText("[data-package-prompt]", packagePrompt);
        applyText("[data-product-summary-name]", name);
        window.renderPackageSelectorState?.();

        const publicContract = product.customerInputContract?.verified === true
            ? product.customerInputContract
            : (() => {
                const livePackages = (product.packages || []).filter(
                    pkg => pkg.customerInputContract?.verified === true
                );
                if (!livePackages.length) return null;
                const fingerprints = new Set(
                    livePackages.map(pkg => JSON.stringify({
                        fields: pkg.customerInputContract.fields,
                        noCustomerInput: pkg.customerInputContract.noCustomerInput
                    }))
                );
                return fingerprints.size === 1
                    ? livePackages[0].customerInputContract
                    : null;
            })();
        const contract = publicContract
            ? {
                accountFields: publicContract.fields || [],
                noCustomerInput: publicContract.noCustomerInput === true
            }
            : null;
        const accountCard = document.getElementById("userId")?.closest(".form-card");
        const firstField = contract?.accountFields?.[0];
        if (!contract || (!firstField && !contract.noCustomerInput)) {
            document.documentElement.dataset.publicProductState = "SETUP_INCOMPLETE";
            return product;
        }
        if (!firstField) accountCard?.setAttribute("hidden", "");
        if (firstField) applyText('label[for="userId"]', firstField.label);
        if (firstField) applyPlaceholder("#userId", firstField.key === "riotId" ? "Name#TAG" : `Enter ${firstField.label}`);
        const applyConstraints=(input,field)=>{if(!input)return;const numeric=["number","numeric-text"].includes(field.type);input.type=numeric?"text":field.type||"text";if(numeric)input.inputMode="numeric";if(field.constraints?.pattern)input.pattern=field.constraints.pattern;if(field.constraints?.minLength!=null)input.minLength=field.constraints.minLength;if(field.constraints?.maxLength!=null)input.maxLength=field.constraints.maxLength;input.required=field.required!==false};
        if (firstField?.type === "select" && Array.isArray(firstField.options) && firstField.options.length) { const original=document.getElementById("userId"),select=document.createElement("select");select.id="userId";select.required=firstField.required!==false;select.innerHTML=`<option value="" disabled selected>Select ${firstField.label}</option>`;firstField.options.forEach(option=>{const node=document.createElement("option");node.value=String(option.value||"");node.textContent=String(option.label||option.value||"");select.appendChild(node)});original?.replaceWith(select) } else if (firstField) applyConstraints(document.getElementById("userId"),firstField);
        const resolvedAccountFields = contract.accountFields.map((field, index) => ({
            ...field,
            selector: field.selector || (index === 0 ? "#userId" : `#supplierInput${index + 1}`)
        }));

        resolvedAccountFields.slice(1).forEach((field, index) => {
            const inputId = String(field.selector).replace(/^#/, "");
            if (document.getElementById(inputId)) return;
            const label = document.createElement("label"); label.htmlFor = inputId; label.textContent = field.label;
            let input;
            if (field.type === "select" && Array.isArray(field.options) && field.options.length) {
                input = document.createElement("select");
                input.id = inputId;
                const placeholder = document.createElement("option");
                placeholder.value = "";
                placeholder.textContent = `Select ${field.label}`;
                placeholder.disabled = true;
                placeholder.selected = true;
                input.appendChild(placeholder);
                field.options.forEach(option => {
                    const node = document.createElement("option");
                    node.value = String(option.value || "");
                    node.textContent = String(option.label || option.value || "");
                    input.appendChild(node);
                });
                input.required = field.required !== false;
            } else {
                input = document.createElement("input");
                input.id = inputId;
                input.placeholder = `Enter ${field.label}`;
                applyConstraints(input, field);
            }
            accountCard?.append(label, input);
        });

        window.AZIEL_GAME_FLOW?.init({
            game: name,
            gameKey: productCode,
            userIdSelector: "#userId",
            zoneIdSelector: resolvedAccountFields.find(field => ["zoneId", "serverId"].includes(field.key))?.selector || "",
            zoneRequired: contract.accountFields.some(field => field.key === "zoneId" && field.required),
            userIdRequiredMessage: firstField?.requiredMessage || "",
            accountFields: resolvedAccountFields,
            pendingReturnUrl: `/products/${encodeURIComponent(productCode)}`
        });
        return product;
    }

    window.AZIEL_GENERIC_PRODUCT_DETAIL = Object.freeze({ bootstrap });
    bootstrap();
})();
