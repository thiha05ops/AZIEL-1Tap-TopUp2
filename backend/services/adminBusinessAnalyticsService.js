const SALES_STATUSES = Object.freeze(["paid", "processing", "completed"]);

const upper = value => String(value || "").trim().toUpperCase();
const lower = value => String(value || "").trim().toLowerCase();
const finite = value => Number.isFinite(Number(value));
const currencyTotals = () => ({ MMK: 0, THB: 0 });
const currencyCounts = () => ({ MMK: 0, THB: 0 });
const normalizeCurrency = value => upper(value) === "THB" ? "THB" : "MMK";

function immutableProfitEvidence(order = {}) {
    const pricing = order.quoteSnapshot?.pricingSnapshot;
    const result = pricing?.result;
    const configured = pricing?.businessRuntime?.supplierCostConfigured === true;
    const totalCost = Number(result?.totalCost);
    const resultCurrency = normalizeCurrency(result?.currency);
    const orderCurrency = normalizeCurrency(order.commercial?.currency);
    const quantity = Number(order.commercial?.quantity || order.product?.quantity || 1);
    const revenue = Number(order.commercial?.totalAmount);
    if (!configured || !finite(totalCost) || totalCost < 0 || resultCurrency !== orderCurrency || !Number.isInteger(quantity) || quantity < 1 || !finite(revenue)) {
        return { available: false, amount: null, reason: "IMMUTABLE_COST_SNAPSHOT_INCOMPLETE" };
    }
    return {
        available: true,
        amount: Number((revenue - totalCost * quantity).toFixed(4)),
        reason: "FINAL_PAID_REVENUE_MINUS_PERSISTED_TOTAL_COST",
        components: {
            persistedTotalCostPerUnit: totalCost,
            quantity,
            supplierCost: finite(result.supplierCost) ? Number(result.supplierCost) : null,
            fxConvertedCost: finite(result.fxConvertedCost) ? Number(result.fxConvertedCost) : null,
            supplierFeeAmount: finite(result.supplierFeeAmount) ? Number(result.supplierFeeAmount) : null,
            businessCostAmount: finite(result.businessCostAmount) ? Number(result.businessCostAmount) : null,
            gatewayFeeAmount: finite(result.gatewayFeeAmount) ? Number(result.gatewayFeeAmount) : null,
            platformFeeAmount: finite(result.platformFeeAmount) ? Number(result.platformFeeAmount) : null,
            fundingCost: finite(result.fundingCost) ? Number(result.fundingCost) : null,
            otherAcquisitionCost: finite(result.otherAcquisitionCost) ? Number(result.otherAcquisitionCost) : null,
            taxAmount: finite(result.taxAmount) ? Number(result.taxAmount) : null
        }
    };
}

function canonicalPackageIdentity(order = {}) {
    const productCode = lower(order.product?.gameCode || order.quoteSnapshot?.packageSnapshot?.gameCode);
    const packageCode = upper(order.product?.packageCode || order.quoteSnapshot?.packageSnapshot?.packageCode);
    if (!productCode || !packageCode) return null;
    return { productCode, packageCode, key: `${productCode}:${packageCode}` };
}

function eligibleSale(order = {}) {
    return SALES_STATUSES.includes(String(order.status || "")) && String(order.paymentStatus || order.payment?.status || "") === "paid";
}

function eligibleCompletedSale(order = {}) {
    return eligibleSale(order) && order.status === "completed" && order.fulfilment?.status === "completed";
}

function buildBusinessPerformance(orders = []) {
    const sales = orders.filter(eligibleSale);
    const grossSales = currencyTotals();
    const grossProfit = currencyTotals();
    const profitCompleteOrders = currencyCounts();
    const profitIncompleteOrders = currencyCounts();
    sales.forEach(order => {
        const currency = normalizeCurrency(order.commercial?.currency);
        grossSales[currency] += Number(order.commercial?.totalAmount || 0);
        const profit = immutableProfitEvidence(order);
        if (profit.available) {
            grossProfit[currency] += profit.amount;
            profitCompleteOrders[currency] += 1;
        } else {
            profitIncompleteOrders[currency] += 1;
        }
    });

    const profitMargin = { MMK: null, THB: null };
    ["MMK", "THB"].forEach(currency => {
        if (profitIncompleteOrders[currency] === 0 && grossSales[currency] > 0) {
            profitMargin[currency] = Number(((grossProfit[currency] / grossSales[currency]) * 100).toFixed(2));
        } else if (profitIncompleteOrders[currency] === 0 && grossSales[currency] === 0) {
            profitMargin[currency] = 0;
        }
    });

    const packageMap = new Map();
    let missingIdentityOrders = 0;
    orders.filter(eligibleCompletedSale).forEach(order => {
        const identity = canonicalPackageIdentity(order);
        if (!identity) { missingIdentityOrders += 1; return; }
        const currency = normalizeCurrency(order.commercial?.currency);
        const quantity = Number(order.commercial?.quantity || order.product?.quantity || 1);
        const current = packageMap.get(identity.key) || {
            ...identity,
            productName: String(order.product?.gameName || identity.productCode),
            packageName: String(order.product?.packageName || order.quoteSnapshot?.packageSnapshot?.packageName || identity.packageCode),
            unitsSold: 0,
            orders: 0,
            revenue: currencyTotals(),
            profit: currencyTotals(),
            profitIncompleteOrders: currencyCounts()
        };
        current.unitsSold += quantity;
        current.orders += 1;
        current.revenue[currency] += Number(order.commercial?.totalAmount || 0);
        const profit = immutableProfitEvidence(order);
        if (profit.available) current.profit[currency] += profit.amount;
        else current.profitIncompleteOrders[currency] += 1;
        packageMap.set(identity.key, current);
    });
    const topPackages = [...packageMap.values()]
        .sort((a, b) => b.unitsSold - a.unitsSold || b.orders - a.orders || a.key.localeCompare(b.key))
        .slice(0, 5)
        .map((item, index) => ({ ...item, rank: `LV${index + 1}` }));

    return {
        grossSales,
        grossProfit,
        profitMargin,
        profitCompleteOrders,
        profitIncompleteOrders,
        profitDataComplete: profitIncompleteOrders.MMK === 0 && profitIncompleteOrders.THB === 0,
        salesOrders: sales.length,
        completedOrders: orders.filter(eligibleCompletedSale).length,
        topPackages,
        missingIdentityOrders
    };
}

module.exports = {
    SALES_STATUSES,
    immutableProfitEvidence,
    canonicalPackageIdentity,
    eligibleSale,
    eligibleCompletedSale,
    buildBusinessPerformance
};
