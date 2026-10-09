"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");

async function main() {
    const paths = PackageSupplierSelection.schema.paths;
    assert.strictEqual(paths.productCode.options.required, true);
    assert.strictEqual(paths.productCode.options.immutable, true);
    assert.strictEqual(paths.packageCode.options.immutable, true);
    assert.deepStrictEqual(paths.customerMarket.options.enum, ["TH", "MM"]);
    assert.strictEqual(paths.supplierMappingId.options.ref, "SupplierProductMapping");
    assert.strictEqual(paths.selectedByUsernameSnapshot.options.maxlength, 120);
    assert.strictEqual(paths.reason.options.maxlength, 500);
    assert.strictEqual(paths.decisionVersion.options.min, 1);

    const indexes = PackageSupplierSelection.schema.indexes();
    const unique = indexes.find(([fields, options]) => options.unique && fields.productCode === 1 && fields.packageCode === 1 && fields.customerMarket === 1);
    assert(unique, "package/customer-market unique index is required");
    assert(indexes.some(([fields]) => fields.supplierMappingId === 1 && fields.customerMarket === 1));
    assert(indexes.some(([fields]) => fields.updatedAt === -1));

    const mappingId = new mongoose.Types.ObjectId();
    const th = new PackageSupplierSelection({ productCode: "game", packageCode: "PACK", customerMarket: "TH", supplierMappingId: mappingId, selectedByUsernameSnapshot: "owner" });
    const mm = new PackageSupplierSelection({ productCode: "game", packageCode: "PACK", customerMarket: "MM", supplierMappingId: mappingId, selectedByUsernameSnapshot: "owner" });
    await th.validate();
    await mm.validate();
    assert.notStrictEqual(th.customerMarket, mm.customerMarket, "TH and MM must support separate records");
    console.log("PASS PackageSupplierSelection schema and market-scoped indexes");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
