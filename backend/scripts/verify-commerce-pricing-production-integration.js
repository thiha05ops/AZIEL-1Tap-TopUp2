"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const CatalogPackage = require("../models/CatalogPackage");
const PaymentMethod = require("../models/PaymentMethod");
const {
    startCustomerManualPromptPayCheckout
} = require("../services/commerce/customerManualPromptPayCheckoutService");
const {
    startCustomerWalletCheckout
} = require("../services/commerce/customerWalletCheckoutService");
const orderRouteTests = require("../routes/order")._test || {};

function read(file) {
    return fs.readFileSync(path.join(root, file), "utf8");
}

function includes(file, needle, message) {
    assert(read(file).includes(needle), message);
}

function notIncludes(file, needle, message) {
    assert(!read(file).includes(needle), message);
}

function makeLean(value) {
    return { lean: async () => structuredClone(value) };
}

function stubModels({ packageAmount = 1490 } = {}) {
    const originalPackageFindOne = CatalogPackage.findOne;
    const originalPaymentFindOne = PaymentMethod.findOne;
    CatalogPackage.findOne = () => makeLean({
        _id: "64f000000000000000000123",
        productCode: "mlbb",
        packageCode: "WEEKLY",
        name: "Weekly Pass",
        enabled: true,
        deletedAt: null,
        prices: {
            TH: { amount: packageAmount, currency: "THB", enabled: true },
            MM: { amount: 5000, currency: "MMK", enabled: true }
        },
        metadata: { gameName: "Mobile Legends", categoryId: "mobile-games", categoryCode: "mobile-games" }
    });
    PaymentMethod.findOne = query => makeLean({
        key: query?.key || "promptpay",
        region: "TH",
        enabled: true,
        method: query?.key === "wallet" ? "AZIEL Wallet" : "PromptPay QR",
        provider: query?.key === "wallet" ? "wallet" : "promptpay",
        paymentType: query?.key === "wallet" ? "wallet" : "manual",
        qrMode: "aziel_promptpay_dynamic",
        receiptUploadEnabled: true,
        slipRequired: true,
        enableSaveQr: true,
        enableOpenApp: true,
        enableChecklist: true,
        dynamicQrExpiryMinutes: 15
    });
    return () => {
        CatalogPackage.findOne = originalPackageFindOne;
        PaymentMethod.findOne = originalPaymentFindOne;
    };
}

function pricingContext({ finalAmount = 1500 } = {}) {
    return async ({ pkg, price, catalog, region, currency, now }) => ({
        packageContext: {
            packageId: String(pkg._id),
            packageRef: String(pkg._id),
            packageCode: catalog.packageCode,
            packageName: pkg.name,
            gameId: catalog.productCode,
            gameCode: catalog.productCode,
            gameName: "Mobile Legends",
            categoryId: "mobile-games",
            categoryCode: "mobile-games"
        },
        pricing: {
            pricingInput: {
                supplierCost: Number(price.amount),
                supplierCurrency: currency,
                targetCurrency: currency,
                policy: {
                    supplierFee: { enabled: false, type: "FIXED", value: 0 },
                    businessCost: { enabled: false, type: "FIXED", value: 0 },
                    profitRule: { enabled: true, type: "FIXED", value: finalAmount - Number(price.amount) },
                    gatewayFee: { enabled: false, type: "FIXED", value: 0 },
                    platformCost: { enabled: false, type: "FIXED", value: 0 },
                    tax: { enabled: false, type: "FIXED", value: 0 },
                    roundingRule: { enabled: false, mode: "NONE" }
                },
                appliedPricingRules: [],
                context: {
                    evaluationTime: now.toISOString(),
                    region,
                    currency,
                    packageId: String(pkg._id),
                    packageCode: catalog.packageCode,
                    gameId: catalog.productCode,
                    categoryId: "mobile-games"
                }
            },
            versionContext: {
                priceVersionId: "pv-production",
                priceVersionNumber: 7,
                branchKey: "storefront"
            }
        }
    });
}

function commerceDeps({ records, createdOrders, orderIds = ["AZL-000001"], quoteIds = ["AZQ-000001"] } = {}) {
    return {
        quoteDependencies: {
            getIssuedAt: () => new Date("2026-07-26T12:00:00.000Z"),
            generateQuoteId: () => quoteIds.shift() || `AZQ-${Date.now()}`,
            generateTraceId: () => "TRC-1",
            async createQuoteRecord({ quote, idempotencyKey }) {
                const stored = structuredClone(quote);
                stored.__idempotencyKey = idempotencyKey;
                records.set(stored.quoteId, stored);
                return stored;
            },
            async findOwnedQuote({ quoteId }) {
                return records.get(quoteId) || null;
            }
        },
        checkoutDependencies: {
            findOwnedQuote: async ({ quoteId }) => records.get(quoteId) || null,
            findOrderByQuoteId: async () => null,
            findOrderByCheckoutIdempotency: async () => null,
            createOrderRecord: async ({ orderSnapshot }) => {
                const order = structuredClone(orderSnapshot);
                createdOrders.push(order);
                return order;
            },
            findOrderById: async orderId => createdOrders.find(order => order.orderId === orderId) || null,
            markQuoteUsed: async ({ quoteId }) => {
                const quote = records.get(quoteId);
                return quote ? { ...structuredClone(quote), status: "USED" } : null;
            },
            transactionRunner: async callback => callback({}),
            getCheckoutTime: () => new Date("2026-07-26T12:01:00.000Z"),
            generateCheckoutId: () => "CHK-1",
            generateOrderId: () => orderIds.shift() || `AZL-${Date.now()}`
        },
        orderRepository: {
            findOrderById: async orderId => createdOrders.find(order => order.orderId === orderId) || null,
            updateOrderPaymentStatus: async ({ orderId, paymentStatus, paymentCompletedAt }) => {
                const order = createdOrders.find(item => item.orderId === orderId);
                if (!order) return null;
                order.payment = {
                    ...(order.payment || {}),
                    status: paymentStatus,
                    paidAt: paymentCompletedAt?.toISOString?.() || paymentCompletedAt || null
                };
                return order;
            }
        }
    };
}

async function verifyManualPromptPayAuthoritativeAmount() {
    const restore = stubModels({ packageAmount: 1490 });
    try {
        const records = new Map();
        const createdOrders = [];
        const deps = commerceDeps({ records, createdOrders });
        const result = await startCustomerManualPromptPayCheckout({
            orderId: "browser-order-1",
            productCode: "mlbb",
            packageCode: "WEEKLY",
            amount: 1,
            currency: "THB",
            region: "TH",
            paymentMethod: "promptpay",
            userId: "12345",
            zoneId: "6789"
        }, {
            user: { _id: "user-1", username: "alice" },
            sessionId: "session-1"
        }, {
            ...deps,
            buildPricingContext: pricingContext({ finalAmount: 1500 }),
            manualPaymentService: {
                async initiateManualPayment({ orderId }) {
                    const order = createdOrders.find(item => item.orderId === orderId);
                    return {
                        attemptId: "PAY-1",
                        amount: order.commercial.totalAmount,
                        currency: order.commercial.currency,
                        expiresAt: "2026-07-26T12:16:00.000Z",
                        qr: { image: "data:image/png;base64,qr", payload: "payload", encodedReference: "AZL-1" },
                        receiptEvidence: { attached: false }
                    };
                }
            }
        });

        assert.strictEqual(createdOrders[0].commercial.totalAmount, 1500, "CommerceOrder total must come from pricing engine result.");
        assert.strictEqual(result.payment.amount, 1500, "PaymentAttempt amount must equal CommerceOrder total.");
        assert.strictEqual(result.session.amount, 1500, "Checkout sheet session amount must equal PaymentAttempt amount.");
        assert.strictEqual(createdOrders[0].quoteSnapshot.pricingSnapshot.inputSummary.supplierCost, 1490, "Catalog base price must be snapshotted as pricing input.");
        assert.strictEqual(createdOrders[0].quoteMetadata.pricingVersion, "pv-production", "Pricing version reference must be snapshotted.");
    } finally {
        restore();
    }
}

async function verifyWalletAuthoritativeAmount() {
    const restore = stubModels({ packageAmount: 1000 });
    try {
        const records = new Map();
        const createdOrders = [];
        const deps = commerceDeps({ records, createdOrders, orderIds: ["AZL-WALLET"], quoteIds: ["AZQ-WALLET"] });
        let debited = null;
        const paidOrders = new Map();
        const result = await startCustomerWalletCheckout({
            orderId: "wallet-browser-order",
            productCode: "mlbb",
            packageCode: "WEEKLY",
            amount: 1,
            currency: "THB",
            region: "TH",
            paymentMethod: "wallet",
            userId: "12345"
        }, {
            user: { _id: "user-1", username: "alice" },
            sessionId: "session-1"
        }, {
            ...deps,
            buildPricingContext: pricingContext({ finalAmount: 1250 }),
            debitWallet: async input => {
                debited = structuredClone(input);
                return {
                    balance: 8750,
                    transaction: { transactionId: "WLD-1", amount: input.amount, currency: input.currency },
                    duplicate: false
                };
            },
            orderRepository: {
                async findOrderById(orderId) {
                    return paidOrders.get(orderId) || createdOrders.find(item => item.orderId === orderId) || null;
                },
                async findOwnedOrderById({ orderId }) {
                    return paidOrders.get(orderId) || createdOrders.find(item => item.orderId === orderId) || null;
                },
                async updatePaymentStatus({ orderId, toStatus }) {
                    const order = structuredClone(paidOrders.get(orderId) || createdOrders.find(item => item.orderId === orderId));
                    order.paymentStatus = toStatus;
                    order.payment.status = toStatus;
                    paidOrders.set(orderId, order);
                    return order;
                },
                async updateOrderStatus({ orderId, toStatus }) {
                    const order = structuredClone(paidOrders.get(orderId));
                    order.status = toStatus;
                    paidOrders.set(orderId, order);
                    return order;
                }
            }
        });

        assert.strictEqual(createdOrders[0].commercial.totalAmount, 1250, "Wallet CommerceOrder total must come from quote.");
        assert.strictEqual(debited.amount, 1250, "Wallet debit must equal CommerceOrder total, not browser amount.");
        assert.strictEqual(result.order.amount, 1250, "Wallet response order amount must come from persisted snapshot.");
        assert.strictEqual(result.order.paymentStatus, "paid", "Wallet CommerceOrder must be marked paid.");
    } finally {
        restore();
    }
}

async function verifyPriceChangeDoesNotMutateExistingOrder() {
    const restore = stubModels({ packageAmount: 1000 });
    try {
        const records = new Map();
        const createdOrders = [];
        await startCustomerManualPromptPayCheckout({
            orderId: "first",
            productCode: "mlbb",
            packageCode: "WEEKLY",
            amount: 1000,
            currency: "THB",
            region: "TH",
            paymentMethod: "promptpay",
            userId: "12345"
        }, {
            user: { _id: "user-1", username: "alice" },
            sessionId: "session-1"
        }, {
            ...commerceDeps({ records, createdOrders, orderIds: ["AZL-OLD1"], quoteIds: ["AZQ-OLD1"] }),
            buildPricingContext: pricingContext({ finalAmount: 1100 }),
            manualPaymentService: { initiateManualPayment: async () => ({ attemptId: "PAY-OLD", amount: 1100, currency: "THB", qr: {} }) }
        });
        const oldOrder = structuredClone(createdOrders[0]);
        await startCustomerManualPromptPayCheckout({
            orderId: "second",
            productCode: "mlbb",
            packageCode: "WEEKLY",
            amount: 1000,
            currency: "THB",
            region: "TH",
            paymentMethod: "promptpay",
            userId: "12345"
        }, {
            user: { _id: "user-1", username: "alice" },
            sessionId: "session-1"
        }, {
            ...commerceDeps({ records, createdOrders, orderIds: ["AZL-NEW1"], quoteIds: ["AZQ-NEW1"] }),
            buildPricingContext: pricingContext({ finalAmount: 1400 }),
            manualPaymentService: { initiateManualPayment: async () => ({ attemptId: "PAY-NEW", amount: 1400, currency: "THB", qr: {} }) }
        });
        assert.strictEqual(oldOrder.commercial.totalAmount, 1100, "Existing order snapshot must keep old quote amount.");
        assert.strictEqual(createdOrders[1].commercial.totalAmount, 1400, "New quote should use new server pricing result.");
    } finally {
        restore();
    }
}

function verifyCommerceOrderProjectionUsesSnapshot() {
    assert.strictEqual(typeof orderRouteTests.projectCommerceOrder, "function", "Order route must expose Commerce order projection for verification.");
    const projected = orderRouteTests.projectCommerceOrder({
        orderId: "AZL-SNAPSHOT",
        owner: { userId: "user-1" },
        product: {
            gameName: "Mobile Legends",
            packageName: "Weekly Pass",
            packageCode: "WEEKLY",
            region: "TH"
        },
        commercial: {
            totalAmount: 1500,
            originalUnitPrice: 1490,
            discountAmount: 0,
            currency: "THB",
            region: "TH"
        },
        payment: {
            paymentMethodId: "promptpay",
            provider: "MANUAL_PROMPTPAY",
            status: "pending"
        },
        status: "pending_payment",
        paymentStatus: "pending",
        fulfilment: { status: "not_started", input: { userId: "12345", zoneId: "6789" } },
        createdAt: new Date("2026-07-26T12:00:00.000Z"),
        updatedAt: new Date("2026-07-26T12:01:00.000Z")
    }, { admin: true, summary: true });

    assert.strictEqual(projected.amount, 1500, "Order display amount must come from CommerceOrder commercial snapshot.");
    assert.strictEqual(projected.finalAmount, 1500, "Projected final amount must come from persisted CommerceOrder snapshot.");
    assert.strictEqual(projected.originalAmount, 1490, "Projected original amount must come from persisted CommerceOrder snapshot.");
    assert.strictEqual(projected.currency, "THB", "Projected currency must preserve CommerceOrder currency.");
    assert.strictEqual(projected.paymentMethod, "promptpay", "Projected payment method must preserve CommerceOrder payment snapshot.");
}

function verifySourceOwnership() {
    includes("backend/services/commerce/customerManualPromptPayCheckoutService.js", "buildProductionPricingContext", "Manual checkout must use production pricing context.");
    notIncludes("backend/services/commerce/customerManualPromptPayCheckoutService.js", "function pricingInputFromCatalog", "Manual checkout must not use the old catalog-amount-only pricing shim.");
    includes("backend/routes/wallet.js", "startCustomerWalletCheckout", "Wallet pay route must enter Commerce wallet checkout.");
    includes("backend/services/commerce/customerWalletCheckoutService.js", "debitWallet", "Wallet checkout must debit through wallet ledger service.");
    includes("backend/services/commerce/customerWalletCheckoutService.js", "checkoutFromQuote", "Wallet checkout must create CommerceOrder from quote.");
    includes("backend/services/commerce/productionPricingContextService.js", "PricingPolicy", "Production pricing context must read PricingPolicy.");
    includes("backend/services/commerce/productionPricingContextService.js", "PricingRule", "Production pricing context must read PricingRule.");
    includes("backend/services/commerce/productionPricingContextService.js", "PriceVersion", "Production pricing context must snapshot PriceVersion.");
}

async function main() {
    verifySourceOwnership();
    verifyCommerceOrderProjectionUsesSnapshot();
    await verifyManualPromptPayAuthoritativeAmount();
    await verifyWalletAuthoritativeAmount();
    await verifyPriceChangeDoesNotMutateExistingOrder();
    console.log("Commerce pricing production integration verifier passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
