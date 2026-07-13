// backend/services/mail.js

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

if (process.env.NODE_ENV !== "test") {
    transporter.verify((error) => {
        if (error) {
            console.log("MAIL VERIFY ERROR:", error);
        } else {
            console.log("✅ Mail service ready");
        }
    });
}

async function sendResetOTP(email, otp) {
    return transporter.sendMail({
        from: `"AZIEL 1Tap" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "AZIEL Password Reset OTP",
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
    return transporter.sendMail({
        from: `"AZIEL 1Tap" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Verify your AZIEL Gmail",
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
