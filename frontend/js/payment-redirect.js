// frontend/js/payment-redirect.js

async function createPaymentAndRedirect(orderData) {
    try {
        const res = await fetch("/api/payment/create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(orderData)
        });

        const data = await res.json();

        if (!data.success) {
            alert(data.message || "Payment create failed");
            return;
        }

        const params = new URLSearchParams({
            orderId: orderData.orderId,
            amount: orderData.amount,
            currency: orderData.currency,
            game: orderData.game,
            packageName: orderData.packageName,
            paymentMethod: orderData.paymentMethod,
            userId: orderData.userId,
            zoneId: orderData.zoneId
        });

        window.location.href = `payment-page.html?${params.toString()}`;

    } catch (error) {
        console.log(error);
        alert("Payment server error");
    }
}