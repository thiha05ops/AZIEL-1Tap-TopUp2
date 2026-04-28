// backend/services/wavepayService.js

async function createPayment(orderData) {
    const {
        orderId,
        amount,
        currency,
        game,
        packageName,
        username
    } = orderData;

    // ⚠️ Mock payment URL for testing
    // WavePay real merchant API ရပြီဆိုရင် ဒီနေရာကို API request နဲ့ပြောင်းမယ်
    const transactionId = "WAVE-" + Date.now();

    const paymentUrl =
        `/payment-mock.html?` +
        `orderId=${encodeURIComponent(orderId)}` +
        `&transactionId=${encodeURIComponent(transactionId)}` +
        `&amount=${encodeURIComponent(amount)}` +
        `&currency=${encodeURIComponent(currency || "MMK")}` +
        `&game=${encodeURIComponent(game || "")}` +
        `&packageName=${encodeURIComponent(packageName || "")}` +
        `&username=${encodeURIComponent(username || "")}`;

    return {
        transactionId,
        paymentUrl,
        qrUrl: ""
    };
}

module.exports = {
    createPayment
};