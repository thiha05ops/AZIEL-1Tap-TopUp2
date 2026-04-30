async function createPayment(orderData) {
    const transactionId = "PAY-" + Date.now();

    const paymentUrl =
        `/payment-mock.html?` +
        `orderId=${encodeURIComponent(orderData.orderId || "")}` +
        `&transactionId=${encodeURIComponent(transactionId)}` +
        `&amount=${encodeURIComponent(orderData.amount || "")}` +
        `&currency=${encodeURIComponent(orderData.currency || "MMK")}` +
        `&game=${encodeURIComponent(orderData.game || "")}` +
        `&packageName=${encodeURIComponent(orderData.packageName || "")}` +
        `&username=${encodeURIComponent(orderData.username || "")}` +
        `&paymentMethod=${encodeURIComponent(orderData.paymentMethod || "")}` +
        `&userId=${encodeURIComponent(orderData.userId || "")}` +
        `&zoneId=${encodeURIComponent(orderData.zoneId || "")}`;

    return { transactionId, paymentUrl, qrUrl: "" };
}

module.exports = { createPayment };