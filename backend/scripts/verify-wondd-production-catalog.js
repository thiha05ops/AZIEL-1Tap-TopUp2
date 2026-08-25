const assert = require("assert");
const mongoose = require("mongoose");
const audit = require("../../docs/wondd-catalog-audit.json");
const Product = require("../models/CatalogProduct");
const Package = require("../models/CatalogPackage");
const Mapping = require("../models/SupplierProductMapping");
const { WONDD_FAMILIES, CONFIRMED_SERVICE_CODES } = require("../services/suppliers/wonddCatalogConfig");
const { buildWonddGameId } = require("../services/suppliers/wonddGameIdFormatters");

(async () => {
    assert.strictEqual(audit.response.packageCount, 153);
    assert.strictEqual(audit.response.gameCount, 11);
    assert.strictEqual(audit.response.exposesServicecode, false, "serviceid must remain separate from confirmed servicecode");
    assert.deepStrictEqual(CONFIRMED_SERVICE_CODES, { aovid: "rov", freefire: "freefire", undawn: "undawn", callofduty: "callofduty", deltaforce: "deltaforce", haikyuflyhigh: "haikyuflyhigh", pubg: "pubg", mlbb: "mlbb", valorant: "val", heartopia: "HTP" });
    assert.strictEqual(buildWonddGameId("mlbb", { userId: "123456789", zoneId: "1234" }), "123456789 1234");
    assert.throws(() => buildWonddGameId("pubg", { userId: "123" }), error => error.code === "WONDD_INPUT_CONTRACT_NOT_CONFIGURED");
    const ml86 = audit.games.find(game => game.serviceid === "9622").packages.find(row => row.packcode === "ML00086");
    assert.strictEqual(Number(ml86.netpricedealer), 41);
    await mongoose.connect(process.env.MONGO_URI);
    const mappings = await Mapping.find({ supplierCode: "WONDD", region: "TH" }).lean();
    assert.strictEqual(mappings.length, 131);
    assert.strictEqual(new Set(mappings.map(item => item.supplierPackageCode)).size, mappings.length);
    assert.strictEqual(new Set(mappings.map(item => `${item.productCode}:${item.packageCode}`)).size, mappings.length);
    const enabled = mappings.filter(item => item.enabled);
    assert.strictEqual(enabled.length, 39);
    assert.deepStrictEqual([...new Set(enabled.map(item => item.productCode))].sort(), ["freefire", "mlbb"]);
    assert.strictEqual(mappings.filter(item => item.mappingMetadata?.readiness?.inputReady).length, 39);
    assert.strictEqual(mappings.filter(item => item.mappingMetadata?.readiness?.pricingReady).length, 39);
    assert.strictEqual(mappings.filter(item => item.mappingMetadata?.readiness?.fulfillmentReady && item.enabled).length, 39);
    const supportedProducts = Object.values(WONDD_FAMILIES).filter(item => item.productCode).map(item => item.productCode);
    assert.strictEqual(await Product.countDocuments({ productCode: { $in: supportedProducts } }), 10);
    assert.strictEqual(await Package.countDocuments({ "metadata.wondd.packcode": { $exists: true } }), 131);
    await mongoose.disconnect();
    console.log("WonDD production catalog verifier passed (read-only; zero top-up calls).\n");
})().catch(async error => {
    await mongoose.disconnect().catch(() => null);
    console.error("WonDD production catalog verifier failed:", error.message);
    process.exitCode = 1;
});
