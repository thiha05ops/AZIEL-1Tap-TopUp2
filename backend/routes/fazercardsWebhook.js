const express = require("express");
const ProviderWebhookEvent = require("../models/ProviderWebhookEvent");
const adapter = require("../services/suppliers/fazercardsAdapter");
const { processor } = require("../services/suppliers/fazercardsFulfillmentProcessor");
const { sanitizeProviderMetadata } = require("../services/supplierAdapterRegistry");

const router = express.Router();

router.post("/webhooks/fazercards", express.raw({ type: "application/json", limit: "256kb" }), async (req, res) => {
    if (String(process.env.FAZERCARDS_WEBHOOK_ENABLED || "").toLowerCase() !== "true") return res.status(404).json({ success: false });
    if (!adapter.verifyWebhookSignature(req.body, req.get("X-Webhook-Signature"))) return res.status(401).json({ success: false });
    let event;
    try { event = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).json({ success: false }); }
    const eventId = String(event.event_id || event.id || "").trim();
    const eventType = String(event.type || event.event || "").trim();
    const orderPayload = event.data?.order || event.data || event.order || {};
    const providerOrderId = String(orderPayload.id || orderPayload.order_id || event.order_id || "").trim();
    if (!eventId || !["order.created", "order.status_changed"].includes(eventType)) return res.status(202).json({ success: true, ignored: true });
    let receipt;
    try { receipt = await ProviderWebhookEvent.create({ provider: "FAZERCARDS", eventId, eventType, providerOrderId, safeMetadata: sanitizeProviderMetadata({ status: orderPayload.status }) }); }
    catch (error) { if (error?.code === 11000) return res.status(200).json({ success: true, duplicate: true }); throw error; }
    try {
        if (providerOrderId) await processor.reconcileProviderStatus(providerOrderId, require("../services/suppliers/fazercardsAdapter").normalizeStatus(orderPayload, providerOrderId));
        receipt.processingStatus = providerOrderId ? "PROCESSED" : "IGNORED"; receipt.processedAt = new Date(); await receipt.save();
        return res.status(200).json({ success: true });
    } catch {
        receipt.processingStatus = "FAILED"; receipt.processedAt = new Date(); await receipt.save().catch(() => null);
        return res.status(500).json({ success: false });
    }
});

module.exports = router;
