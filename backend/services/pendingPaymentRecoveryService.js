const RECOVERABLE_WINDOW_MS = 20 * 60 * 1000;
const DYNAMIC_PROMPTPAY_QR_MODE = "aziel_promptpay_dynamic";
const SAFE_NON_RECOVERABLE_REASONS = Object.freeze({
    NOT_OWNER: "not_found",
    UNSUPPORTED: "unsupported_payment_method",
    INACTIVE: "attempt_inactive",
    EXPIRED: "attempt_expired",
    RECEIPT_SUBMITTED: "receipt_already_submitted",
    ORDER_CREATED: "order_already_created",
    QR_MISSING: "dynamic_qr_missing",
    QR_EXPIRED: "dynamic_qr_expired"
});

function toDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function addMs(value, ms) {
    const date = toDate(value);
    return date ? new Date(date.getTime() + ms) : null;
}

function earliestDate(...values) {
    return values
        .map(toDate)
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime())[0] || null;
}

function computeRecoverableExpiresAt(attempt) {
    if (!attempt) return null;
    return earliestDate(
        addMs(attempt.createdAt, RECOVERABLE_WINDOW_MS),
        attempt.expiresAt,
        attempt.instructions?.dynamicQr?.expiresAt
    );
}

function getAttemptOwnerQuery(user = {}, extra = {}) {
    const clauses = [];
    if (user._id) clauses.push({ customerUserId: user._id });
    if (user.id) clauses.push({ customerUserId: user.id });
    if (user.username) clauses.push({ username: user.username });

    return {
        ...extra,
        $or: clauses.length ? clauses : [{ username: "__aziel_no_authenticated_user__" }]
    };
}

function hasReceiptSubmitted(attempt) {
    return Boolean(
        attempt?.receiptSubmittedAt ||
        attempt?.evidence?.uploadedAt ||
        attempt?.evidence?.url ||
        attempt?.status === "consumed"
    );
}

function hasOrderCreated(attempt, linkedOrderExists = false) {
    return Boolean(attempt?.orderId || linkedOrderExists);
}

function isSupportedManualDynamicPromptPayAttempt(attempt) {
    const instructions = attempt?.instructions || {};
    return (
        String(attempt?.paymentType || "").toLowerCase() === "manual" &&
        String(attempt?.region || "").toUpperCase() === "TH" &&
        String(attempt?.paymentMethod || "").toLowerCase() === "promptpay" &&
        instructions.qrMode === DYNAMIC_PROMPTPAY_QR_MODE &&
        instructions.confirmationMode === "manual_admin" &&
        instructions.dynamicQrSupported === true &&
        instructions.receiptUploadEnabled !== false &&
        instructions.slipRequired !== false
    );
}

function evaluateRecoverability(attempt, options = {}) {
    const now = toDate(options.now) || new Date();
    const recoverableExpiresAt = toDate(attempt?.recoverableExpiresAt) || computeRecoverableExpiresAt(attempt);
    const dynamicQr = attempt?.instructions?.dynamicQr || {};
    const qrExpiresAt = toDate(dynamicQr.expiresAt);
    const attemptExpiresAt = toDate(attempt?.expiresAt);

    if (!isSupportedManualDynamicPromptPayAttempt(attempt)) {
        return {
            resumable: false,
            reason: SAFE_NON_RECOVERABLE_REASONS.UNSUPPORTED,
            recoverableExpiresAt,
            remainingSeconds: 0
        };
    }

    if (attempt.status !== "active" || attempt.consumedAt) {
        return {
            resumable: false,
            reason: SAFE_NON_RECOVERABLE_REASONS.INACTIVE,
            recoverableExpiresAt,
            remainingSeconds: 0
        };
    }

    if (hasReceiptSubmitted(attempt)) {
        return {
            resumable: false,
            reason: SAFE_NON_RECOVERABLE_REASONS.RECEIPT_SUBMITTED,
            recoverableExpiresAt,
            remainingSeconds: 0
        };
    }

    if (hasOrderCreated(attempt, options.linkedOrderExists)) {
        return {
            resumable: false,
            reason: SAFE_NON_RECOVERABLE_REASONS.ORDER_CREATED,
            recoverableExpiresAt,
            remainingSeconds: 0
        };
    }

    if (!dynamicQr.orderReference || !dynamicQr.qrPayload || !dynamicQr.qrImage || !qrExpiresAt) {
        return {
            resumable: false,
            reason: SAFE_NON_RECOVERABLE_REASONS.QR_MISSING,
            recoverableExpiresAt,
            remainingSeconds: 0
        };
    }

    if (!recoverableExpiresAt || !attemptExpiresAt || recoverableExpiresAt <= now || qrExpiresAt <= now || attemptExpiresAt <= now) {
        return {
            resumable: false,
            reason: qrExpiresAt <= now ? SAFE_NON_RECOVERABLE_REASONS.QR_EXPIRED : SAFE_NON_RECOVERABLE_REASONS.EXPIRED,
            recoverableExpiresAt,
            remainingSeconds: 0
        };
    }

    return {
        resumable: true,
        reason: "",
        recoverableExpiresAt,
        remainingSeconds: Math.max(0, Math.floor((recoverableExpiresAt.getTime() - now.getTime()) / 1000))
    };
}

function projectRecoverableAttempt(attempt, evaluation, options = {}) {
    const dynamicQr = attempt.instructions?.dynamicQr || {};
    const instructions = attempt.instructions || {};
    const payload = {
        attemptId: attempt.attemptId,
        attemptReference: attempt.reference,
        reference: attempt.reference,
        orderReference: dynamicQr.orderReference || attempt.reference,
        productCode: attempt.productCode,
        productName: attempt.productName,
        packageCode: attempt.packageCode,
        packageName: attempt.packageName,
        gameUserData: {
            userId: attempt.gameUserData?.userId || "",
            zoneId: attempt.gameUserData?.zoneId || ""
        },
        amount: attempt.finalAmount || attempt.canonicalAmount,
        originalAmount: attempt.originalAmount || attempt.canonicalAmount,
        discountAmount: attempt.discountAmount || 0,
        finalAmount: attempt.finalAmount || attempt.canonicalAmount,
        promoCode: attempt.promoCode || "",
        promoSnapshot: attempt.promoSnapshot || null,
        currency: attempt.canonicalCurrency,
        region: attempt.region,
        paymentMethod: attempt.paymentMethod,
        paymentType: attempt.paymentType,
        provider: attempt.provider,
        paymentName: instructions.method || attempt.paymentMethod,
        qrMode: instructions.qrMode || "",
        confirmationMode: instructions.confirmationMode || "",
        receiptUploadEnabled: instructions.receiptUploadEnabled !== false,
        slipRequired: instructions.slipRequired !== false,
        checklistSteps: Array.isArray(instructions.checklistSteps) ? instructions.checklistSteps : [],
        instructions: {
            method: instructions.method || attempt.paymentMethod,
            key: instructions.key || attempt.paymentMethod,
            qrMode: instructions.qrMode || "",
            confirmationMode: instructions.confirmationMode || "",
            enableSaveQr: instructions.enableSaveQr === true,
            enableOpenApp: instructions.enableOpenApp === true,
            enableChecklist: instructions.enableChecklist === true,
            dynamicQrSupported: instructions.dynamicQrSupported === true,
            amountPrefillSupported: instructions.amountPrefillSupported === true,
            referenceSupported: instructions.referenceSupported === true,
            galleryScanSupported: instructions.galleryScanSupported === true,
            receiptUploadEnabled: instructions.receiptUploadEnabled !== false,
            slipRequired: instructions.slipRequired !== false,
            openAppMode: instructions.openAppMode || "disabled",
            appLaunchMode: instructions.appLaunchMode || "",
            iosAppLaunchUrl: instructions.iosAppLaunchUrl || "",
            androidAppLaunchUrl: instructions.androidAppLaunchUrl || "",
            androidPackageName: instructions.androidPackageName || "",
            appStoreFallbackUrl: instructions.appStoreFallbackUrl || "",
            playStoreFallbackUrl: instructions.playStoreFallbackUrl || "",
            bankLaunchers: Array.isArray(instructions.bankLaunchers) ? instructions.bankLaunchers : []
        },
        createdAt: attempt.createdAt,
        expiresAt: attempt.expiresAt,
        recoverableExpiresAt: evaluation.recoverableExpiresAt,
        remainingSeconds: evaluation.remainingSeconds,
        receiptSubmitted: hasReceiptSubmitted(attempt),
        resumable: evaluation.resumable
    };

    if (!evaluation.resumable) payload.reason = evaluation.reason;
    if (options.includeQr === true && evaluation.resumable) {
        payload.dynamicQr = {
            orderReference: dynamicQr.orderReference,
            encodedReference: dynamicQr.encodedReference || "",
            qrImage: dynamicQr.qrImage,
            expiresAt: dynamicQr.expiresAt
        };
    }

    return payload;
}

module.exports = {
    DYNAMIC_PROMPTPAY_QR_MODE,
    RECOVERABLE_WINDOW_MS,
    SAFE_NON_RECOVERABLE_REASONS,
    computeRecoverableExpiresAt,
    evaluateRecoverability,
    getAttemptOwnerQuery,
    hasOrderCreated,
    hasReceiptSubmitted,
    isSupportedManualDynamicPromptPayAttempt,
    projectRecoverableAttempt
};
