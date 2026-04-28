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

        // payment page / app redirect
        window.location.href = data.paymentUrl;

    } catch (error) {
        console.log(error);
        alert("Payment server error");
    }
}