"use strict";

const crypto = require("crypto");
const PackageSupplierSelection = require("../../models/PackageSupplierSelection");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const SupplierCatalogOffer = require("../../models/SupplierCatalogOffer");
const SupplierCatalogCostObservation = require("../../models/SupplierCatalogCostObservation");
const SupplierCatalogIngestionRun = require("../../models/SupplierCatalogIngestionRun");
const SupplierOfferAvailability = require("../../models/SupplierOfferAvailability");
const Supplier = require("../../models/Supplier");
const Approval = require("../../models/WeeklySupplierCostApproval");
const { readSupplierCostEvidencePolicy } = require("../../config/supplierCostEvidencePolicy");
const { createSupplierCostEvidenceRepositories, validateTerminalLegacyFallbackRun } = require("./supplierCostEvidenceService");
const { createSupplierLatestCostService } = require("./supplierLatestCostService");
const { canonicalJson } = require("./supplierCatalogNormalization");
const { compareSupplierCost, observedCostHash } = require("./supplierCostComparisonService");
const { promoteObservedCost, sourceLock } = require("./supplierCostAuthorityService");

const upper = value => String(value || "").trim().toUpperCase();
const id = value => String(value?._id || value || "");
const sha = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const hasAuthority = mapping => Number.isFinite(Number(mapping?.supplierCostAuthority?.rawSupplierCost)) && Number(mapping.supplierCostAuthority.rawSupplierCost) > 0 && Boolean(upper(mapping.supplierCostAuthority.supplierCurrency));
const result = (selection, status, code, details = {}) => ({ productCode: selection.productCode, packageCode: selection.packageCode, mappingId: id(selection.supplierMappingId), status, code, ...details });

function immutableCandidate(decision) {
    return {
        supplierCode: upper(decision.mapping.supplierCode), supplierId: id(decision.mapping.supplierId), productCode: decision.productCode,
        packageCode: decision.packageCode, mappingId: decision.mappingId, offerId: id(decision.offer),
        supplierProductCode: decision.offer.supplierProductCode, supplierOfferCode: decision.offer.supplierOfferCode,
        currency: upper(decision.observation.currency), amount: Number(decision.observation.amount),
        observedAt: new Date(decision.observation.observedAt).toISOString(), observedCostHash: observedCostHash(decision.offer),
        ingestionRunId: id(decision.observation.ingestionRunId)
    };
}
function candidateSnapshot(candidate) {
    return {
        supplierCode: upper(candidate.supplierCode), supplierId: id(candidate.supplierId), productCode: String(candidate.productCode || ""),
        packageCode: upper(candidate.packageCode), mappingId: id(candidate.mappingId), offerId: id(candidate.offerId),
        supplierProductCode: String(candidate.supplierProductCode || ""), supplierOfferCode: String(candidate.supplierOfferCode || ""),
        currency: upper(candidate.currency), amount: Number(candidate.amount), observedAt: new Date(candidate.observedAt).toISOString(),
        observedCostHash: String(candidate.observedCostHash || "").toLowerCase(), ingestionRunId: id(candidate.ingestionRunId)
    };
}
function manifestHash(candidates) {
    const sorted = candidates.map(candidateSnapshot).sort((a, b) => `${a.supplierCode}:${a.productCode}:${a.packageCode}:${a.mappingId}`.localeCompare(`${b.supplierCode}:${b.productCode}:${b.packageCode}:${b.mappingId}`));
    return sha(canonicalJson(sorted));
}
function exactCandidate(left, right) {
    return canonicalJson(candidateSnapshot(left)) === canonicalJson(candidateSnapshot(right));
}

function validateLegacyRunEvidence(run, observations, expectedRunId) {
    validateTerminalLegacyFallbackRun(run);
    if (id(run._id) !== id(expectedRunId)) throw Object.assign(new Error("Legacy evidence ingestion-run identity does not match."), { code: "SUPPLIER_COST_EVIDENCE_RUN_IDENTITY_MISMATCH" });
    const runSupplierId = id(run.supplierId), runNamespace = upper(run.catalogNamespace);
    for (const observation of observations) {
        if (id(observation.ingestionRunId) !== id(expectedRunId)
            || id(observation.supplierId) !== runSupplierId
            || upper(observation.catalogNamespace) !== runNamespace) {
            throw Object.assign(new Error("Legacy observation identity does not match its ingestion run."), { code: "SUPPLIER_COST_EVIDENCE_RUN_IDENTITY_MISMATCH" });
        }
    }
    return true;
}

function createRepositories(models = {}, options = {}) {
    const Selection = models.Selection || PackageSupplierSelection, Mapping = models.Mapping || SupplierProductMapping;
    const Offer = models.Offer || SupplierCatalogOffer, Observation = models.Observation || SupplierCatalogCostObservation;
    const Run = models.Run || SupplierCatalogIngestionRun, Availability = models.Availability || SupplierOfferAvailability, SupplierModel = models.Supplier || Supplier, ApprovalModel = models.Approval || Approval;
    const evidencePolicy = options.evidencePolicy || readSupplierCostEvidencePolicy(), evidence = options.evidenceRepositories || createSupplierCostEvidenceRepositories(models.evidenceModels || {}), latestCosts = options.latestCostService || createSupplierLatestCostService(models.latestCostModels || {});
    return {
        selections: () => Selection.find({ customerMarket: "GLOBAL" }).lean(),
        exactMappings: supplierId => Mapping.find({
            supplierId,
            archivedAt: null,
            supplierCatalogOfferId: { $ne: null },
            supplierProductCode: { $nin: [null, ""] },
            supplierPackageCode: { $nin: [null, ""] }
        }).lean(),
        mappings: ids => Mapping.find({ _id: { $in: ids }, archivedAt: null }).lean(),
        offers: ids => Offer.find({ _id: { $in: ids } }).lean(),
        availability: ids => Availability.find({ supplierCatalogOfferId: { $in: ids } }).lean(),
        observations: async (ids, runId) => {
            if (evidencePolicy.latestOnlyEnabled) {
                if (!runId) return latestCosts.forOffers(ids);
                return latestCosts.forOffers(ids, { ingestionRunId: runId });
            }
            if (evidencePolicy.v2ReadEnabled && runId) {
                const rows = await evidence.observationsForRun(ids, runId);
                if (rows !== null) return rows;
            }
            if (!runId) return Observation.find({ supplierCatalogOfferId: { $in: ids } }).sort({ observedAt: -1 }).lean();
            const run = await Run.findById(runId).lean();
            validateTerminalLegacyFallbackRun(run);
            const rows = await Observation.find({ supplierCatalogOfferId: { $in: ids }, ingestionRunId: runId }).sort({ observedAt: -1 }).lean();
            validateLegacyRunEvidence(run, rows, runId);
            return rows;
        },
        supplier: code => SupplierModel.findOne({ supplierCode: upper(code) }).lean(),
        approval: hash => ApprovalModel.findById(hash).lean(),
        createManifest: async data => {
            try { return (await ApprovalModel.create({ _id: data.manifestHash, ...data })).toObject(); }
            catch (error) { if (error?.code !== 11000) throw error; return ApprovalModel.findById(data.manifestHash).lean(); }
        },
        consumeApproval: (approvalId, summary) => ApprovalModel.findOneAndUpdate({ _id: approvalId, status: { $in: ["APPROVED", "CONSUMED"] } }, { $set: { status: "CONSUMED", consumedAt: new Date(), consumptionSummary: summary } }, { new: true }).lean(),
        updateRun: (runId, sync) => Run.updateOne({ _id: runId }, { $set: { "metadata.costSync": sync } })
    };
}

function validateCandidate({ selection, mapping, offer, observation, availability, ingestionRunId, expectedSupplier, now, maximumObservationAgeMs, maximumAutomaticChangePercent }) {
    if (!mapping) return result(selection, "REVIEW_REQUIRED", "GLOBAL_MAPPING_MISSING");
    if (id(mapping._id) !== id(selection.supplierMappingId)) return result(selection, "REVIEW_REQUIRED", "GLOBAL_MAPPING_IDENTITY_CONFLICT");
    if (!expectedSupplier || !id(mapping.supplierId) || id(mapping.supplierId) !== id(expectedSupplier._id) || upper(mapping.supplierCode) !== upper(expectedSupplier.supplierCode)) return result(selection, "REVIEW_REQUIRED", "GLOBAL_MAPPING_WRONG_SUPPLIER");
    if (!offer || id(mapping.supplierCatalogOfferId) !== id(offer._id)) return result(selection, "REVIEW_REQUIRED", "SUPPLIER_OFFER_REFERENCE_INVALID");
    if (!id(offer.supplierId) || id(offer.supplierId) !== id(mapping.supplierId)) return result(selection, "REVIEW_REQUIRED", "SUPPLIER_OFFER_IDENTITY_CONFLICT");
    if (mapping.productCode !== selection.productCode || upper(mapping.packageCode) !== upper(selection.packageCode)) return result(selection, "REVIEW_REQUIRED", "CANONICAL_PACKAGE_IDENTITY_CONFLICT");
    if (mapping.supplierProductCode !== offer.supplierProductCode || mapping.supplierPackageCode !== offer.supplierOfferCode) return result(selection, "REVIEW_REQUIRED", "NATIVE_SKU_IDENTITY_CONFLICT");
    if (upper(offer.catalogLifecycleState) !== "ACTIVE") return result(selection, "REVIEW_REQUIRED", "SUPPLIER_OFFER_NOT_ACTIVE");
    if (!observation) return result(selection, "REVIEW_REQUIRED", "FRESH_RUN_OBSERVATION_MISSING");
    if (!ingestionRunId || id(observation.ingestionRunId) !== id(ingestionRunId)) return result(selection, "REVIEW_REQUIRED", "OBSERVATION_RUN_IDENTITY_CONFLICT");
    if (!id(observation.supplierId) || id(observation.supplierId) !== id(offer.supplierId)) return result(selection, "REVIEW_REQUIRED", "OBSERVATION_SUPPLIER_IDENTITY_CONFLICT");
    if (!upper(observation.catalogNamespace) || upper(observation.catalogNamespace) !== upper(offer.catalogNamespace)) return result(selection, "REVIEW_REQUIRED", "OBSERVATION_NAMESPACE_CONFLICT");
    const amount = Number(observation.amount), observedAt = new Date(observation.observedAt);
    if (!Number.isFinite(amount) || amount <= 0 || !upper(observation.currency) || !Number.isFinite(observedAt.getTime())) return result(selection, "REJECTED", "INVALID_SUPPLIER_COST");
    if (id(observation.supplierCatalogOfferId) !== id(offer._id) || observation.supplierProductCode !== offer.supplierProductCode || observation.supplierOfferCode !== offer.supplierOfferCode) return result(selection, "REVIEW_REQUIRED", "OBSERVATION_IDENTITY_CONFLICT");
    if (Number(now) - observedAt.getTime() > maximumObservationAgeMs) return result(selection, "REVIEW_REQUIRED", "STALE_OBSERVATION", { observedAt });
    const availabilityObservedAt = new Date(availability?.observedAt);
    if (!availability || id(availability.supplierCatalogOfferId) !== id(offer._id) || id(availability.observationRunId) !== id(ingestionRunId) || upper(availability.state) !== "AVAILABLE" || !Number.isFinite(availabilityObservedAt.getTime()) || Number(now) - availabilityObservedAt.getTime() > maximumObservationAgeMs || (availability.staleAt && new Date(availability.staleAt).getTime() <= Number(now))) return result(selection, "REVIEW_REQUIRED", "SUPPLIER_AVAILABILITY_NOT_CONFIRMED");
    if (upper(offer.supplierCost?.currency) !== upper(observation.currency) || Number(offer.supplierCost?.amount) !== amount) return result(selection, "REVIEW_REQUIRED", "OBSERVATION_OFFER_COST_CONFLICT");
    const comparison = compareSupplierCost(offer.supplierCost, mapping.supplierCostAuthority);
    if (comparison.state === "CURRENCY_MISMATCH") return result(selection, "REVIEW_REQUIRED", "CURRENCY_MISMATCH", { comparison });
    if (comparison.state === "INVALID_OBSERVATION" || comparison.state === "UNCOMPARABLE") return result(selection, "REJECTED", comparison.state, { comparison });
    if (comparison.state === "MATCH" && automaticAuthorityMatchesRun(mapping, offer, observation, ingestionRunId)) return result(selection, "UNCHANGED", "COST_AUTHORITY_CURRENT", { comparison, observation, mapping, offer, initialAuthority: false });
    if (comparison.state === "MATCH") return result(selection, "ACCEPTABLE", "COST_AUTHORITY_REATTESTATION_REQUIRED", { comparison, observation, mapping, offer, availability, warnings: ["AUTHORITY_EVIDENCE_REATTESTED"], initialAuthority: false });
    const warnings = comparison.comparable && Math.abs(Number(comparison.percentageDelta)) > maximumAutomaticChangePercent ? ["LARGE_COST_MOVEMENT"] : [];
    return result(selection, "ACCEPTABLE", hasAuthority(mapping) ? "FRESH_EXACT_SELECTED_COST" : "FRESH_EXACT_INITIAL_COST", { comparison, observation, mapping, offer, availability, warnings, initialAuthority: !hasAuthority(mapping) });
}

function automaticAuthorityMatchesRun(mapping, offer, observation, ingestionRunId) {
    const authority = mapping?.supplierCostAuthority || {};
    const authoritySnapshotHash = String(authority.rawSnapshotHash || "").toLowerCase();
    const observationSnapshotHash = String(observation?.rawSnapshotHash || "").toLowerCase();
    const offerSnapshotHash = String(offer?.rawSnapshotHash || "").toLowerCase();
    return upper(authority.verificationMode) === "AUTOMATIC_VERIFIED_API" &&
        id(authority.ingestionRunId) === id(ingestionRunId) &&
        authority.providerProductCode === mapping.supplierProductCode &&
        authority.providerOfferCode === mapping.supplierPackageCode &&
        Boolean(authoritySnapshotHash) &&
        authoritySnapshotHash === (observationSnapshotHash || offerSnapshotHash) &&
        (!observationSnapshotHash || !offerSnapshotHash || observationSnapshotHash === offerSnapshotHash) &&
        String(authority.observedCostHash || "").toLowerCase() === observedCostHash(offer) &&
        new Date(authority.observedAt).getTime() === new Date(observation?.observedAt).getTime();
}

function createWeeklySupplierCostSyncService(options = {}) {
    const repos = options.repositories || createRepositories(options.models), promoter = options.promoter || promoteObservedCost, clock = options.clock || (() => new Date());
    async function reconcile({ supplierCode, ingestionRunId = "", dryRun = false, prepare = false, initialOnly = false, approvalHash = "", scope = "SELECTED", policy, actor, assertLease = async () => true }) {
        const expectedSupplier = await repos.supplier(upper(supplierCode));
        const selected = await repos.selections();
        const exactMappings = scope === "ALL_EXACT_MAPPINGS" && expectedSupplier && repos.exactMappings
            ? await repos.exactMappings(expectedSupplier._id)
            : null;
        const selections = exactMappings
            ? exactMappings.map(mapping => ({ productCode: mapping.productCode, packageCode: mapping.packageCode, supplierMappingId: mapping._id, customerMarket: "GLOBAL" }))
            : selected;
        const mappings = exactMappings || await repos.mappings(selections.map(row => row.supplierMappingId));
        const allMappingMap = new Map(mappings.map(row => [id(row._id), row]));
        const scopedSelections = selections.filter(selection => { const mapping = allMappingMap.get(id(selection.supplierMappingId)); return !mapping || upper(mapping.supplierCode) === upper(supplierCode); });
        const offers = await repos.offers(scopedSelections.map(row => allMappingMap.get(id(row.supplierMappingId))?.supplierCatalogOfferId).filter(Boolean));
        const offerMap = new Map(offers.map(row => [id(row._id), row]));
        const offerIds = offers.map(row => row._id);
        const [observations, availabilityRows] = await Promise.all([repos.observations(offerIds, ingestionRunId || null), repos.availability(offerIds)]), observationMap = new Map(), availabilityMap = new Map(availabilityRows.map(row => [id(row.supplierCatalogOfferId), row]));
        observations.forEach(row => { if (!observationMap.has(id(row.supplierCatalogOfferId))) observationMap.set(id(row.supplierCatalogOfferId), row); });
        const decisions = scopedSelections.map(selection => { const mapping = allMappingMap.get(id(selection.supplierMappingId)), catalogOffer = mapping ? offerMap.get(id(mapping.supplierCatalogOfferId)) : null, observation = catalogOffer ? observationMap.get(id(catalogOffer._id)) : null, offer = observation?.evidenceMode === "LATEST_ONLY" ? { ...catalogOffer, supplierCost: { amount: observation.amount, currency: observation.currency, observedAt: observation.observedAt }, sourceRevision: observation.sourceRevision, rawSnapshotHash: observation.rawSnapshotHash } : catalogOffer; return validateCandidate({ selection, mapping, offer, observation, availability: catalogOffer ? availabilityMap.get(id(catalogOffer._id)) : null, ingestionRunId, expectedSupplier, now: clock().getTime(), maximumObservationAgeMs: policy.maximumObservationAgeMs, maximumAutomaticChangePercent: policy.maximumAutomaticChangePercent }); });
        const initialCandidates = [], initialManifestHash = "", approval = null;
        for (const decision of decisions.filter(row => row.status === "ACCEPTABLE")) {
            if (dryRun || prepare) { decision.status = "DRY_RUN_ACCEPTABLE"; continue; }
            try {
                await assertLease();
                const token = `weekly-cost:${ingestionRunId}:verified-api:${decision.mappingId}:${observedCostHash(decision.offer)}`;
                const promoted = await promoter({ mappingId: decision.mappingId, supplierCatalogOfferId: id(decision.offer), ingestionRunId, verificationMode: "AUTOMATIC_VERIFIED_API", maximumObservationAgeMs: policy.maximumObservationAgeMs, warnings: decision.warnings, sourceLock: sourceLock(decision.mapping, decision.offer, ingestionRunId), confirmed: true, reason: `Verified supplier API cost sync ${ingestionRunId}`, idempotencyToken: token.slice(0, 200) }, { actor, requestId: `weekly-cost-${ingestionRunId}` });
                decision.status = promoted.replayed ? "IDEMPOTENT_REPLAY" : "UPDATED"; decision.code = promoted.replayed ? "ALREADY_APPLIED" : "COST_AUTHORITY_UPDATED";
            } catch (error) { decision.status = "REVIEW_REQUIRED"; decision.code = error.code || "COST_AUTHORITY_UPDATE_FAILED"; }
        }
        const sanitized = decisions.map(({ mapping, offer, observation, availability, ...row }) => row);
        const summary = { schemaVersion: 3, supplierCode: upper(supplierCode), ingestionRunId: String(ingestionRunId || ""), dryRun: dryRun || prepare, mode: prepare ? "PREPARE" : dryRun ? "DRY_RUN" : "APPLY", completedAt: clock(), total: sanitized.length, updated: sanitized.filter(row => row.status === "UPDATED").length, replayed: sanitized.filter(row => row.status === "IDEMPOTENT_REPLAY").length, unchanged: sanitized.filter(row => row.status === "UNCHANGED").length, reviewRequired: sanitized.filter(row => row.status === "REVIEW_REQUIRED").length, blocked: sanitized.filter(row => ["REVIEW_REQUIRED", "REJECTED"].includes(row.status)).length, warningCount: sanitized.filter(row => row.warnings?.length).length, rejected: sanitized.filter(row => row.status === "REJECTED").length, initialCandidateCount: initialCandidates.length, initialManifestHash, approvalId: id(approval), planHash: sha(canonicalJson(sanitized.map(row => [row.productCode, row.packageCode, row.mappingId, row.status, row.code]))), decisions: sanitized };
        if (!dryRun && !prepare && ingestionRunId) await repos.updateRun(ingestionRunId, summary);
        return summary;
    }
    return Object.freeze({ reconcile });
}

module.exports = Object.freeze({ createRepositories, validateLegacyRunEvidence, validateCandidate, automaticAuthorityMatchesRun, immutableCandidate, candidateSnapshot, manifestHash, exactCandidate, createWeeklySupplierCostSyncService });
