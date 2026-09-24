"use strict";

class DingerCustomerPhoneError extends Error {
    constructor(message) {
        super(message);
        this.name = "DingerCustomerPhoneError";
        this.code = "DINGER_CUSTOMER_PHONE_INVALID";
    }
}

function normalizeDingerMyanmarPhone(value) {
    let phone = String(value || "").trim().replace(/[\s().-]/g, "");
    if (phone.startsWith("+95")) phone = `0${phone.slice(3)}`;
    else if (phone.startsWith("95")) phone = `0${phone.slice(2)}`;
    if (!/^09\d{7,9}$/.test(phone)) {
        throw new DingerCustomerPhoneError("Enter a valid Myanmar mobile number beginning with 09.");
    }
    return phone;
}

module.exports = Object.freeze({
    DingerCustomerPhoneError,
    normalizeDingerMyanmarPhone
});
