// frontend/js/payment-redirect.js

async function createPaymentAndRedirect(orderData) {
    try {
        const activeCard =
            document.querySelector(".pay-card.active");

        if (!activeCard) {
            alert("Please select payment method");
            return;
        }

        const qr =
            activeCard.dataset.qr || "";

        const accountName =
            activeCard.dataset.accountName || "";

        const accountNumber =
            activeCard.dataset.accountNumber || "";

        const qrImg =
            document.getElementById("paymentQrImage");

        const nameBox =
            document.getElementById("paymentAccountName");

        const numberBox =
            document.getElementById("paymentAccountNumber");

        if (qrImg && qr) {
            qrImg.src = qr;
            qrImg.style.display = "block";
        }

        if (nameBox) {
            nameBox.innerText =
                accountName
                    ? `Account Name: ${accountName}`
                    : "";
        }

        if (numberBox) {
            numberBox.innerText =
                accountNumber
                    ? `Account Number: ${accountNumber}`
                    : "";
        }

        const preview =
            document.getElementById("paymentPreview");

        if (preview) {
            preview.style.display = "block";
        }

        alert(
            "Payment QR loaded. Please pay and upload screenshot."
        );

    } catch (error) {
        console.log(error);
        alert("Payment preview error");
    }
}