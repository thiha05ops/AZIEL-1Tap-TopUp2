const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const ADMIN_CATALOG = path.join(ROOT, "frontend/js/admin-catalog.js");
const ADMIN_CSS = path.join(ROOT, "frontend/css/admin/admin-design-system.css");

const source = fs.readFileSync(ADMIN_CATALOG, "utf8");
const css = fs.readFileSync(ADMIN_CSS, "utf8");

function functionBody(name) {
    const start = source.indexOf(`function ${name}`);
    assert(start >= 0, `${name} missing`);

    const braceStart = source.indexOf("{", start);
    let depth = 0;

    for (let index = braceStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === "{") depth += 1;
        if (char === "}") depth -= 1;
        if (depth === 0) return source.slice(braceStart + 1, index);
    }

    throw new Error(`${name} body not found`);
}

const saveBody = functionBody("handlePackageEditSave");
const openBody = functionBody("openPackageEditPanel");
const mutateBody = functionBody("mutateCatalog");

const closeIndex = saveBody.indexOf("closePackageEditPanel();");
const confirmIndex = saveBody.indexOf("confirmCatalogAction");

assert(closeIndex >= 0, "Save flow must close Edit Package modal");
assert(confirmIndex >= 0, "Save flow must open confirmation");
assert(closeIndex < confirmIndex, "Edit Package modal must close before confirmation opens");

assert(saveBody.includes("catalogPackageEditDraft = draft"), "Draft must be preserved before confirmation");
assert(saveBody.includes("reopenPackageEditPanel(product, pkg, draft)"), "Confirmation cancel/failure must reopen editor with draft");
assert(saveBody.includes("catalogPackageSavePending"), "Save flow must guard duplicate saves");
assert(saveBody.includes("validatePackageEditDraft"), "Draft must validate before confirmation");
assert(openBody.includes("draft?.values?.MM") && openBody.includes("draft?.values?.TH"), "Editor must reopen with draft values");
assert(source.includes("abandonPackageEditDraft"), "Edit cancel must abandon draft");
assert(mutateBody.includes("return data"), "Mutation helper must return backend result for failure recovery");

assert(!/\bwindow\.confirm\s*\(/.test(source), "Admin Catalog must not use native confirm");
assert(!/[^.\w]confirm\s*\(/.test(source.replace(/confirmCatalogAction/g, "")), "Admin Catalog must not call native confirm");
assert(!/9999999|2147483647/.test(css), "Fix must not rely on extreme z-index layering");

console.log("Admin catalog modal flow verification checks passed.");
