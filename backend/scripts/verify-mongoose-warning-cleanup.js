const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const MODEL_EXPECTATIONS = [
    ["SitePlacement", { placementCode: 1 }, { unique: true }],
    ["PromoCode", { code: 1 }, { unique: true }],
    ["PromoUsageState", { code: 1 }, { unique: true }],
    ["AdminAccount", { usernameNormalized: 1 }, { unique: true }],
    ["AdminLoginChallenge", { challengeId: 1 }, { unique: true }],
    ["AdminSession", { sessionId: 1 }, { unique: true }]
];

function sameKeys(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function verifyIndexes() {
    MODEL_EXPECTATIONS.forEach(([modelName, expectedKeys, expectedOptions]) => {
        const model = require(path.join(ROOT, "backend/models", modelName));
        const matches = model.schema.indexes().filter(([keys]) => sameKeys(keys, expectedKeys));
        assert.strictEqual(matches.length, 1, `${modelName} must declare ${JSON.stringify(expectedKeys)} exactly once`);
        Object.entries(expectedOptions).forEach(([key, value]) => {
            assert.deepStrictEqual(matches[0][1][key], value, `${modelName} ${key} semantics changed`);
        });
    });

    const fulfillment = require(path.join(ROOT, "backend/models/FulfillmentAttempt"));
    const statusIndexes = fulfillment.schema.indexes().filter(([keys]) => sameKeys(keys, { orderId: 1, status: 1 }));
    assert.strictEqual(statusIndexes.length, 2, "FulfillmentAttempt must retain both partial uniqueness guards");
    assert.deepStrictEqual(new Set(statusIndexes.map(([, options]) => options.name)), new Set([
        "one_active_fulfillment_per_order",
        "one_successful_fulfillment_per_order"
    ]));
    statusIndexes.forEach(([, options]) => {
        assert.strictEqual(options.unique, true);
        assert(options.partialFilterExpression, `${options.name} partial filter missing`);
    });
}

function verifyModernUpdateOptions() {
    const roots = ["backend/services", "backend/routes", "backend/scripts/e2e-commerce-th.js"];
    const files = roots.flatMap(relative => {
        const absolute = path.join(ROOT, relative);
        if (fs.statSync(absolute).isFile()) return [absolute];
        return fs.readdirSync(absolute, { recursive: true })
            .filter(item => item.endsWith(".js"))
            .map(item => path.join(absolute, item));
    });
    const offenders = files.filter(file => /\bnew\s*:\s*(?:true|false)\b/.test(fs.readFileSync(file, "utf8")));
    assert.deepStrictEqual(offenders, [], `Deprecated Mongoose new option remains in: ${offenders.join(", ")}`);
}

async function main() {
    const warnings = [];
    const originalEmitWarning = process.emitWarning;
    const originalWarn = console.warn;
    process.emitWarning = function captureWarning(warning, ...args) {
        warnings.push(String(warning?.message || warning));
        return originalEmitWarning.call(process, warning, ...args);
    };
    console.warn = (...args) => {
        const message = args.map(String).join(" ");
        if (/mongoose|duplicate schema index|returnDocument|\bnew\b/i.test(message)) warnings.push(message);
        return originalWarn(...args);
    };

    try {
        verifyIndexes();
        verifyModernUpdateOptions();
        await new Promise(resolve => setImmediate(resolve));
    } finally {
        process.emitWarning = originalEmitWarning;
        console.warn = originalWarn;
    }

    assert.deepStrictEqual(warnings, [], `Unexpected Mongoose warnings:\n${warnings.join("\n")}`);
    console.log("Mongoose index declarations and update-option warning checks passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
