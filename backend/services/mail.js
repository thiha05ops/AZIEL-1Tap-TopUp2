// backend/services/mail.js

const { sendEmail, verifyTransport } = require("./emailTransportService");

if (process.env.NODE_ENV !== "test") {
    verifyTransport().then(() => {
        console.log("Mail service ready");
    }).catch((error) => {
        if (error) {
            console.log("Mail verify error:", {
                code: error.code || "EMAIL_VERIFY_FAILED"
            });
        }
    });
}

async function sendResetOTP(email, otp) {
    return sendEmail({
        to: email,
        subject: "AZIEL Password Reset OTP",
        messageType: "password_reset_otp",
        operation: "password.reset.otp",
        text: [
            "AZIEL Password Reset",
            "",
            `Your OTP code is: ${otp}`,
            "This code will expire in 10 minutes."
        ].join("\n"),
        html: `
            <div style="font-family:Arial;padding:20px">
                <h2>AZIEL Password Reset</h2>
                <p>Your OTP code is:</p>
                <h1 style="letter-spacing:4px">${otp}</h1>
                <p>This code will expire in 10 minutes.</p>
            </div>
        `
    });
}
async function sendVerifyOTP(email, otp) {
    return sendEmail({
        to: email,
        subject: "Verify your AZIEL Gmail",
        messageType: "registration_otp",
        operation: "registration.verify.otp",
        text: [
            "Welcome to AZIEL 1Tap",
            "",
            `Your email verification OTP is: ${otp}`,
            "This code will expire in 10 minutes."
        ].join("\n"),
        html: `
            <div style="font-family:Arial;padding:20px">
                <h2>Welcome to AZIEL 1Tap</h2>
                <p>Your email verification OTP is:</p>
                <h1 style="letter-spacing:4px">${otp}</h1>
                <p>This code will expire in 10 minutes.</p>
            </div>
        `
    });
}

module.exports = { sendResetOTP, sendVerifyOTP };
