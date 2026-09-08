"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    createPricingQuote
} = require("../services/commerce/pricingQuoteRuntime");
const {
    toPublicQuote
} = require("../services/commerce/pricingQuoteApplicationService");
const mongoose = require("mongoose");
const PromoCode = require("../models/PromoCode");
const PromoUsageState = require("../models/PromoUsageState");
const UserCoupon = require("../models/UserCoupon");
const {
    claimCoupon,
    cleanupExpiredUserCoupons,
    consumeUserCoupon,
    releaseUserCoupon,
    reserveUserCoupon,
    USER_COUPON_STATUS
} = require("../services/userCouponService");

const root = path.join(__dirname, "..", "..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function includes(file, needle, message) {
    assert(read(file).includes(needle), message || `${file} must include ${needle}`);
}

function notIncludes(file, needle, message) {
    assert(!read(file).includes(needle), message || `${file} must not include ${needle}`);
}

function matches(file, pattern, message) {
    assert(pattern.test(read(file)), message || `${file} must match ${pattern}`);
}

includes("backend/models/UserCoupon.js", "AVAILABLE", "UserCoupon must model claimable AVAILABLE lifecycle.");
includes("backend/models/UserCoupon.js", "RESERVED", "UserCoupon must model reservation lifecycle.");
includes("backend/models/UserCoupon.js", "USED", "UserCoupon must model permanent use lifecycle.");
includes("backend/models/UserCoupon.js", "EXPIRED", "UserCoupon must model expiry lifecycle.");
includes("backend/models/UserCoupon.js", "userCouponSchema.index({ userId: 1, promoCodeId: 1 }, { unique: true })", "One user may claim a campaign only once.");

includes("backend/routes/coupons.js", '"/coupons/available"', "Public available coupon API must exist.");
includes("backend/routes/coupons.js", '"/coupons/:campaignId/claim"', "Authenticated claim API must exist.");
includes("backend/routes/coupons.js", '"/coupons/mine"', "Authenticated owned coupon API must exist.");
includes("backend/server.js", "\"coupons\"", "Coupon routes must be mounted.");

includes("backend/services/userCouponService.js", "findOneAndUpdate", "Claim/reserve operations must be atomic database updates.");
includes("backend/services/userCouponService.js", "status: USER_COUPON_STATUS.AVAILABLE", "Reservation must only claim AVAILABLE coupons.");
includes("backend/services/userCouponService.js", "status: USER_COUPON_STATUS.USED", "Consumption must persist USED state.");
includes("backend/services/userCouponService.js", "COUPON_RESERVATION_UNAVAILABLE", "Concurrent/double use must fail closed.");
includes("backend/services/userCouponService.js", "cleanupExpiredUserCoupons", "Expired reservations must be releasable by lifecycle cleanup.");
matches("backend/services/userCouponService.js", /findOneAndUpdate\(\s*query,\s*\{\s*\$set:\s*\{[\s\S]*lastReleasedAt/s, "Release must be an atomic compare-and-set update.");
notIncludes("backend/services/userCouponService.js", "coupon.status = nextStatus;", "Release must not use stale-document mutation before save.");
matches("backend/services/userCouponService.js", /if\s*\(transition\.modifiedCount\s*<=\s*0\)\s*return false;[\s\S]*decrementReservedUsage\(coupon\.promoCode,[\s\S]*if\s*\(wonCleanup\)\s*\{[\s\S]*released\s*\+=\s*1/s, "Cleanup must decrement reservedCount only when it wins the RESERVED transition.");
matches("backend/services/userCouponService.js", /\$inc:\s*\{\s*reservedCount:\s*1\s*\}/, "Successful new reserve must increment reservedCount exactly once.");
matches("backend/services/userCouponService.js", /existingUsed[\s\S]*idempotent:\s*true[\s\S]*findOneAndUpdate\(/, "Idempotent consume retry must return before counter mutation.");
matches("backend/services/userCouponService.js", /\$inc:\s*\{\s*reservedCount:\s*-1,\s*consumedCount:\s*1\s*\}/, "Successful consume must move one reservation to consumed exactly once.");
matches("backend/services/userCouponService.js", /reservationToken:\s*token/, "Reserve/consume/release filters must bind the reservation token.");
includes("backend/services/userCouponService.js", "COUPON_RELEASE_ID_REQUIRED", "Release must require reservation identity before mutating state.");
matches("backend/services/userCouponService.js", /reservedOrderId:\s*order/, "Consume must bind the reserved order identity.");
matches("backend/services/userCouponService.js", /if\s*\(user\)\s*query\.userId\s*=\s*normalizeUserId\(user\)/, "Release must include user ownership when supplied.");

includes("backend/services/commerce/commercePromotionBridgeService.js", "selectedUserCouponId", "Commerce bridge must identify owned coupons from immutable snapshots.");
includes("backend/services/commerce/commercePromotionBridgeService.js", "reserveUserCoupon", "Checkout must reserve UserCoupon at order boundary.");
includes("backend/services/commerce/commercePromotionBridgeService.js", "consumeUserCoupon", "Payment success must consume UserCoupon through bridge.");
includes("backend/services/commerce/commercePromotionBridgeService.js", "releaseUserCoupon", "Failed/expired/cancelled flows must release UserCoupon through bridge.");

includes("backend/models/PricingQuote.js", "couponSnapshot", "PricingQuote must persist immutable coupon snapshot.");
includes("backend/models/CommerceOrder.js", "couponSnapshot", "CommerceOrder must persist immutable coupon snapshot.");
includes("backend/services/commerce/pricingQuoteRuntime.js", "couponSnapshot", "Pricing runtime must carry coupon snapshot.");
includes("backend/services/commerce/orderSnapshotRuntime.js", "couponSnapshot", "Order snapshot runtime must carry coupon snapshot.");

includes("frontend/js/home-coupon-preview.js", "/api/coupons/available", "Home Available Coupons must use coupon authority.");
includes("frontend/js/home-coupon-preview.js", "/api/coupons/", "Claim button must call claim endpoint.");
includes("frontend/js/game-flow.js", "userCouponSelect", "Product Detail must render owned coupon selector.");
includes("frontend/js/game-flow.js", "/api/coupons/mine", "Product Detail must load owned coupons.");
includes("frontend/js/product-checkout.js", "userCouponId", "Checkout review must send owned coupon identity.");
matches("frontend/js/game-flow.js", /\.\.\.\(getActivePromoQuote\(flow,\s*pkg\)\?\.userCouponId\s*\?\s*\{\s*promoCode:\s*""\s*\}/s, "UserCoupon checkout draft must clear internal generated promo code.");

notIncludes("frontend/js/game-flow.js", "promoCodeInput", "Customer Product Detail must not render a typed promo code input.");
notIncludes("frontend/js/home-coupon-preview.js", "Claim persistence is intentionally not simulated here", "Home claim must be real, not simulated.");
matches("backend/routes/promos.js", /createPromo\(\{\s*\.\.\.req\.body,\s*code:\s*""\s*\}/s, "Admin create must ignore manual coupon code submission.");
matches("backend/services/promoCodeService.js", /catch\s*\(error\)\s*\{[\s\S]*error\?\.code\s*!==\s*11000[\s\S]*payload\.code[\s\S]*throw error/s, "Generated PromoCode identifiers must retry on duplicate-key while DB uniqueness remains authoritative.");
includes("backend/models/PromoCode.js", "unique: true", "PromoCode.code must retain database-enforced uniqueness.");
includes("backend/services/userCouponService.js", "withCouponTransaction", "UserCoupon lifecycle transitions must use Mongo transaction/session authority.");
matches("backend/services/userCouponService.js", /\$add:\s*\["\$consumedCount",\s*"\$reservedCount"\]/, "Reservation capacity must count consumed plus reserved coupons.");
includes("backend/services/userCouponService.js", "COUPON_USAGE_LIMIT_REACHED", "Reservation must fail closed when campaign capacity is exhausted.");

function quoteInput() {
    return {
        quoteId: "AZQ-CLAIM-COUPON-VERIFY",
        issuedAt: "2026-09-08T00:00:00.000Z",
        expiresAt: "2026-09-08T00:10:00.000Z",
        owner: { userId: "user-1", sessionId: "" },
        request: {
            region: "TH",
            currency: "THB",
            package: {
                packageId: "pkg-1",
                packageCode: "PKG_1",
                packageRef: "pkg-1",
                packageName: "Package 1",
                gameId: "game",
                gameCode: "game",
                gameName: "Game",
                categoryId: "game",
                categoryCode: "game",
                quantity: 1
            },
            paymentMethodId: "promptpay",
            couponCode: "",
            userCouponId: "64f000000000000000000001"
        },
        pricingInput: {
            supplierCost: 100,
            supplierCurrency: "THB",
            targetCurrency: "THB",
            policy: {
                supplierFee: { enabled: false, type: "FIXED", value: 0 },
                businessCost: { enabled: false, type: "FIXED", value: 0 },
                profitRule: { type: "FIXED", value: 20 },
                gatewayFee: { enabled: false, type: "FIXED", value: 0 },
                platformCost: { enabled: false, type: "FIXED", value: 0 },
                tax: { enabled: false, type: "FIXED", value: 0 },
                roundingRule: { enabled: false, mode: "NONE" }
            }
        },
        promotionInput: {
            promotions: [{
                id: "campaign-1",
                code: "AZC-INTERNAL",
                name: "Claimed coupon",
                enabled: true,
                status: "ACTIVE",
                promotionType: "FIXED_DISCOUNT",
                discountValue: 10,
                maximumDiscountAmount: 0,
                minimumOrderAmount: 0,
                priority: 0,
                requiresCoupon: false,
                couponCode: "",
                targeting: { regions: ["TH"], currencies: ["THB"], packages: [], gameIds: [] }
            }],
            context: { region: "TH", currency: "THB", userCouponId: "64f000000000000000000001", couponCode: "", packageCode: "PKG_1", gameId: "game" },
            strategy: { mode: "BEST_PRICE" }
        },
        couponSnapshot: {
            userCouponId: "64f000000000000000000001",
            campaignId: "campaign-1",
            name: "Claimed coupon"
        },
        versionContext: { priceVersionId: "pv-1", priceVersionNumber: 1 },
        trace: { issueSource: "claim-coupon-verifier" }
    };
}

const quote = createPricingQuote(quoteInput());
assert.strictEqual(quote.couponSnapshot.userCouponId, "64f000000000000000000001", "PricingQuote must retain UserCoupon identity.");
assert.strictEqual(quote.promotionSnapshot.selectedPromotion.code, "AZC-INTERNAL", "Internal resolver may retain generated code inside immutable server snapshot.");
const publicQuote = toPublicQuote(quote);
assert.strictEqual(publicQuote.coupon.userCouponId, "64f000000000000000000001", "Public quote must expose userCouponId as the customer checkout credential.");
assert.strictEqual(publicQuote.promotion.code, "", "Public claim-based quote must not require or leak internal PromoCode.code.");
assert.strictEqual(publicQuote.pricing.discountAmount, 10, "PricingQuote must apply the authoritative claimed-coupon discount.");

function oid(hex) {
    return new mongoose.Types.ObjectId(hex);
}

function sameId(left, right) {
    return String(left || "") === String(right || "");
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function queryResult(value) {
    return {
        session() { return this; },
        lean() { return queryResult(clone(value)); },
        sort() { return this; },
        exec() { return Promise.resolve(value); },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
    };
}

function match(record, query = {}) {
    if (!record) return false;
    return Object.entries(query).every(([key, expected]) => {
        if (key === "$or") return expected.some(clause => match(record, clause));
        if (key === "$expr") {
            const limit = Number(expected?.$lt?.[1] || 0);
            return Number(record.consumedCount || 0) + Number(record.reservedCount || 0) < limit;
        }
        const actual = record[key];
        if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date) && !expected._bsontype) {
            if (Object.prototype.hasOwnProperty.call(expected, "$ne")) return !sameId(actual, expected.$ne);
            if (Object.prototype.hasOwnProperty.call(expected, "$gt")) return new Date(actual).getTime() > new Date(expected.$gt).getTime();
            if (Object.prototype.hasOwnProperty.call(expected, "$lte")) return new Date(actual).getTime() <= new Date(expected.$lte).getTime();
            if (Object.prototype.hasOwnProperty.call(expected, "$in")) return expected.$in.some(item => sameId(item, actual));
        }
        return sameId(actual, expected);
    });
}

function apply(record, update = {}) {
    if (record.__inserted && update.$setOnInsert) Object.assign(record, clone(update.$setOnInsert));
    if (update.$set) Object.assign(record, clone(update.$set));
    if (update.$inc) {
        for (const [key, amount] of Object.entries(update.$inc)) record[key] = Number(record[key] || 0) + Number(amount || 0);
    }
    delete record.__inserted;
}

async function runExecutableLifecycleVerifier() {
    const original = {
        startSession: mongoose.startSession,
        promoFindOne: PromoCode.findOne,
        usageUpdateOne: PromoUsageState.updateOne,
        usageFindOneAndUpdate: PromoUsageState.findOneAndUpdate,
        couponFindOne: UserCoupon.findOne,
        couponFindOneAndUpdate: UserCoupon.findOneAndUpdate,
        couponUpdateOne: UserCoupon.updateOne,
        couponUpdateMany: UserCoupon.updateMany,
        couponFind: UserCoupon.find
    };
    const state = { promos: new Map(), usage: new Map(), coupons: new Map(), failUsage: false };
    const user = { id: "64f200000000000000000001" };
    const now = new Date("2026-09-08T00:00:00Z");
    function reset(usageLimit = 0) {
        state.promos.clear(); state.usage.clear(); state.coupons.clear(); state.failUsage = false;
        const promo = {
            _id: oid("64f100000000000000000001"), code: "AZC-RUNTIME", name: "Runtime coupon",
            enabled: true, archivedAt: null, discountType: "FIXED", fixedAmounts: { TH: 5, MM: 500 },
            maximumDiscountAmounts: {}, minimumOrderAmounts: {}, regions: ["TH", "MM"], eligibilityMode: "ALL",
            eligibleProductCodes: [], eligiblePackages: [], usageLimit,
            startsAt: new Date("2026-09-01T00:00:00Z"), endsAt: new Date("2026-12-31T00:00:00Z")
        };
        state.promos.set(String(promo._id), promo);
        state.usage.set(promo.code, { code: promo.code, consumedCount: 0, reservedCount: 0 });
        return promo;
    }
    function addCoupon(id, promo = state.promos.values().next().value) {
        const coupon = {
            _id: oid(id), userId: oid(user.id), promoCodeId: promo._id, promoCode: promo.code,
            status: USER_COUPON_STATUS.AVAILABLE, claimedAt: now, expiresAt: promo.endsAt,
            reservedQuoteId: "", reservedOrderId: "", reservationToken: "", reservedAt: null,
            reservationExpiresAt: null, usedOrderId: "", usedAt: null, snapshot: {}
        };
        state.coupons.set(String(coupon._id), coupon);
        return coupon;
    }
    function sampleQuote() {
        return {
            quoteId: "Q-1",
            commercialSnapshot: { region: "TH", currency: "THB", originalPrice: 100 },
            packageSnapshot: { gameCode: "game", packageCode: "PKG_1" },
            lifecycle: { expiresAt: new Date("2026-09-08T00:30:00Z") }
        };
    }
    try {
        mongoose.startSession = async () => ({
            async withTransaction(callback) {
                const before = { usage: clone([...state.usage.entries()]), coupons: clone([...state.coupons.entries()]) };
                try { return await callback(); } catch (error) {
                    state.usage = new Map(before.usage);
                    state.coupons = new Map(before.coupons);
                    throw error;
                }
            },
            async endSession() {}
        });
        PromoCode.findOne = query => queryResult([...state.promos.values()].find(record => match(record, query)) || null);
        UserCoupon.findOne = query => queryResult([...state.coupons.values()].find(record => match(record, query)) || null);
        UserCoupon.find = query => queryResult([...state.coupons.values()].filter(record => match(record, query)));
        UserCoupon.findOneAndUpdate = (query, update, options = {}) => {
            let record = [...state.coupons.values()].find(item => match(item, query));
            if (!record && options.upsert) {
                record = { _id: oid("64f300000000000000000099"), __inserted: true };
                state.coupons.set(String(record._id), record);
            }
            if (!record) return queryResult(null);
            apply(record, update);
            return queryResult(record);
        };
        UserCoupon.updateOne = async (query, update) => {
            const record = [...state.coupons.values()].find(item => match(item, query));
            if (!record) return { matchedCount: 0, modifiedCount: 0 };
            apply(record, update);
            return { matchedCount: 1, modifiedCount: 1 };
        };
        UserCoupon.updateMany = async (query, update) => {
            let modifiedCount = 0;
            for (const record of state.coupons.values()) if (match(record, query)) { apply(record, update); modifiedCount += 1; }
            return { modifiedCount };
        };
        PromoUsageState.updateOne = async (query, update) => {
            if (state.failUsage) { state.failUsage = false; throw new Error("injected usage counter failure"); }
            let record = state.usage.get(query.code);
            if (!record && update.$setOnInsert) {
                record = { code: query.code, consumedCount: 0, reservedCount: 0, __inserted: true };
                state.usage.set(query.code, record);
            }
            if (!match(record, query)) return { matchedCount: 0, modifiedCount: 0 };
            apply(record, update);
            return { matchedCount: 1, modifiedCount: 1 };
        };
        PromoUsageState.findOneAndUpdate = (query, update) => {
            const record = state.usage.get(query.code);
            if (!match(record, query)) return queryResult(null);
            apply(record, update);
            return queryResult(record);
        };

        const promo = reset();
        const claimed = await claimCoupon({ campaignId: promo._id, user, now });
        const duplicate = await claimCoupon({ campaignId: promo._id, user, now });
        assert.strictEqual(claimed.coupon.userCouponId, duplicate.coupon.userCouponId, "Duplicate claim must return existing entitlement.");
        assert.strictEqual(state.coupons.size, 1, "Duplicate claim must not create another UserCoupon.");

        await reserveUserCoupon({ userCouponId: claimed.coupon.userCouponId, user, quote: sampleQuote(), orderId: "O-1", reservationToken: "T-1", now });
        const reserveRetry = await reserveUserCoupon({ userCouponId: claimed.coupon.userCouponId, user, quote: sampleQuote(), orderId: "O-1", reservationToken: "T-1", now });
        assert.strictEqual(reserveRetry.idempotent, true, "Same reservation retry must be idempotent.");
        assert.strictEqual(state.usage.get(promo.code).reservedCount, 1, "Idempotent reserve retry must not increment reservedCount.");
        await assert.rejects(reserveUserCoupon({ userCouponId: claimed.coupon.userCouponId, user, quote: sampleQuote(), orderId: "O-2", reservationToken: "T-2", now }), { code: "COUPON_RESERVATION_UNAVAILABLE" });
        await assert.rejects(consumeUserCoupon({ userCouponId: claimed.coupon.userCouponId, orderId: "O-2", reservationToken: "T-1", now }), { code: "COUPON_CONSUMPTION_UNAVAILABLE" });
        await consumeUserCoupon({ userCouponId: claimed.coupon.userCouponId, orderId: "O-1", reservationToken: "T-1", now });
        const consumeRetry = await consumeUserCoupon({ userCouponId: claimed.coupon.userCouponId, orderId: "O-1", reservationToken: "T-1", now });
        assert.strictEqual(consumeRetry.idempotent, true, "Same-order consume retry must be idempotent.");
        assert.deepStrictEqual({ reserved: state.usage.get(promo.code).reservedCount, consumed: state.usage.get(promo.code).consumedCount }, { reserved: 0, consumed: 1 }, "Consume must move exactly one reserved counter into consumed.");
        const usedRelease = await releaseUserCoupon({ userCouponId: claimed.coupon.userCouponId, user, orderId: "O-1", reservationToken: "T-1", now });
        assert.strictEqual(usedRelease.released, false, "Release must not revert USED coupons.");

        const limitedPromo = reset(1);
        const first = addCoupon("64f300000000000000000010", limitedPromo);
        const second = addCoupon("64f300000000000000000011", limitedPromo);
        await reserveUserCoupon({ userCouponId: first._id, user, quote: sampleQuote(), orderId: "CAP-1", reservationToken: "CAP-1", now });
        await assert.rejects(reserveUserCoupon({ userCouponId: second._id, user, quote: sampleQuote(), orderId: "CAP-2", reservationToken: "CAP-2", now }), { code: "COUPON_USAGE_LIMIT_REACHED" });
        assert.strictEqual(state.usage.get(limitedPromo.code).reservedCount, 1, "Final capacity slot must not be double reserved.");

        const releasePromo = reset();
        const releasable = addCoupon("64f300000000000000000020", releasePromo);
        await reserveUserCoupon({ userCouponId: releasable._id, user, quote: sampleQuote(), orderId: "REL-1", reservationToken: "REL-1", now });
        await releaseUserCoupon({ userCouponId: releasable._id, user, orderId: "REL-1", reservationToken: "REL-1", now });
        const releaseRetry = await releaseUserCoupon({ userCouponId: releasable._id, user, orderId: "REL-1", reservationToken: "REL-1", now });
        assert.strictEqual(releaseRetry.idempotent, true, "Release retry must be idempotent.");
        assert.strictEqual(state.usage.get(releasePromo.code).reservedCount, 0, "Release retry must not decrement counters twice.");

        const cleanupPromo = reset();
        const stale = addCoupon("64f300000000000000000030", cleanupPromo);
        await reserveUserCoupon({ userCouponId: stale._id, user, quote: sampleQuote(), orderId: "OLD-1", reservationToken: "OLD-1", expiresAt: new Date("2026-09-08T00:01:00Z"), now });
        const cleanup = await cleanupExpiredUserCoupons({ now: new Date("2026-09-08T00:31:00Z") });
        assert.strictEqual(cleanup.releasedReservations, 1, "Cleanup must count only a won RESERVED transition.");
        assert.strictEqual(state.usage.get(cleanupPromo.code).reservedCount, 0, "Cleanup must decrement reservedCount only after winning the transition.");

        const rollbackPromo = reset();
        const rollback = addCoupon("64f300000000000000000040", rollbackPromo);
        state.failUsage = true;
        await assert.rejects(reserveUserCoupon({ userCouponId: rollback._id, user, quote: sampleQuote(), orderId: "FAIL-1", reservationToken: "FAIL-1", now }), /injected usage counter failure/);
        assert.strictEqual(state.coupons.get(String(rollback._id)).status, USER_COUPON_STATUS.AVAILABLE, "Failed logical reserve must roll back coupon status.");
        assert.strictEqual(state.usage.get(rollbackPromo.code).reservedCount, 0, "Failed logical reserve must roll back counter state.");
    } finally {
        mongoose.startSession = original.startSession;
        PromoCode.findOne = original.promoFindOne;
        PromoUsageState.updateOne = original.usageUpdateOne;
        PromoUsageState.findOneAndUpdate = original.usageFindOneAndUpdate;
        UserCoupon.findOne = original.couponFindOne;
        UserCoupon.findOneAndUpdate = original.couponFindOneAndUpdate;
        UserCoupon.updateOne = original.couponUpdateOne;
        UserCoupon.updateMany = original.couponUpdateMany;
        UserCoupon.find = original.couponFind;
    }
}

runExecutableLifecycleVerifier().then(() => {
    console.log("✅ Claim-based coupon system verifier passed.");
}).catch(error => {
    console.error(error);
    process.exit(1);
});
