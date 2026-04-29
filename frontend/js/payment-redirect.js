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

        const method = orderData.paymentMethod;
        const amount = orderData.amount;
        const orderId = orderData.orderId;

        // Myanmar payment apps
        if (method === "kbzpay") {
            window.location.href = data.paymentUrl || `kbzpay://pay?amount=${amount}&remark=${orderId}`;
            return;
        }

        if (method === "wavepay") {
            window.location.href = data.paymentUrl || `wavepay://pay?amount=${amount}&remark=${orderId}`;
            return;
        }

        if (method === "ayapay") {
            window.location.href = data.paymentUrl || `ayapay://pay?amount=${amount}&remark=${orderId}`;
            return;
        }

        // Thailand payment apps
        if (method === "promptpay") {
            window.location.href = data.paymentUrl || `promptpay://pay?amount=${amount}&ref=${orderId}`;
            return;
        }

        if (method === "scb") {
            window.location.href = data.paymentUrl || `scbeasy://pay?amount=${amount}&ref=${orderId}`;
            return;
        }

        window.location.href = data.paymentUrl;

    } catch (error) {
        console.log(error);
        alert("Payment server error");
    }
}