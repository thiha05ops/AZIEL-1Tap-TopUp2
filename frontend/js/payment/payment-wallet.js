// frontend/js/payment/payment-wallet.js
// AZIEL Wallet Payment V2.5

(function () {

    async function pay(orderData) {

        try {

            const res = await fetch(
                PaymentUtils.apiUrl("/api/wallet/pay"),
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify(orderData)
                }
            );

            const data = await res.json();

            PaymentUtils.hideLoading();

            if (!data.success) {

                alert(
                    data.message ||
                    "Wallet payment failed."
                );

                return;

            }

            showSuccess(orderData);

        } catch (error) {

            console.log(
                "Wallet payment error:",
                error
            );

            PaymentUtils.hideLoading();

            alert("Server error");

        }

    }

    function showSuccess(orderData) {

        const modal =
            document.getElementById("successModal");

        if (modal) {

            modal.classList.add("show");

        }

        const trackBtn =
            document.getElementById("trackOrderBtn");

        if (trackBtn) {

            trackBtn.onclick = () => {

                window.location.href =
                    `tracking.html?orderId=${orderData.orderId}`;

            };

        }

    }

    window.PaymentWallet = {

        pay

    };

})();