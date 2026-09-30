// backend/services/mail.js

const { sendEmail, verifyTransport } = require("./emailTransportService");
const { buildOtpEmail } = require("./emailV3TemplateService");

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

async function sendResetOTP(email, otp, options = {}) {
    const message = buildOtpEmail({
        code: otp,
        expiryMinutes: Number(options.expiresInMs || 10 * 60 * 1000) / 60000,
        purpose: "password_reset"
    });
    return sendEmail({
        to: email,
        ...message,
        messageType: "password_reset_otp",
        operation: "password.reset.otp"
    });
}
async function sendVerifyOTP(email, otp, options = {}) {
    const message = buildOtpEmail({
        code: otp,
        expiryMinutes: Number(options.expiresInMs || 10 * 60 * 1000) / 60000,
        purpose: "registration"
    });
    return sendEmail({
        to: email,
        ...message,
        messageType: "registration_otp",
        operation: "registration.verify.otp"
    });
}

module.exports = { sendResetOTP, sendVerifyOTP };
