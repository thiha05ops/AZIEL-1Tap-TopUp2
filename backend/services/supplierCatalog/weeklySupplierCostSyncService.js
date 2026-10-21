"use strict";

const crypto = require("crypto");
const PackageSupplierSelection = require("../../models/PackageSupplierSelection");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const SupplierCatalogOffer = require("../../models/SupplierCatalogOffer");
const SupplierCatalogCostObservation = require("../../models/SupplierCatalogCostObservation");
const SupplierCatalogIngestionRun = require("../../models/SupplierCatalogIngestionRun");
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
    const Run = models.Run || SupplierCatalogIngestionRun, SupplierModel = models.Supplier || Supplier, ApprovalModel = models.Approval || Approval;
    const evidencePolicy = options.evidencePolicy || readSupplierCostEvidencePolicy(), evidence = options.evidenceRepositories || createSupplierCostEvidenceRepositories(models.evidenceModels || {}), latestCosts = options.latestCostService || createSupplierLatestCostService(models.latestCostModels || {});
    return {
        selections: () => Selection.find({ customerMarket: "GLOBAL" }).lean(),
        mappings: ids => Mapping.find({ _id: { $in: ids }, archivedAt: null }).lean(),
        offers: ids => Offer.find({ _id: { $in: ids } }).lean(),
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

function validateCandidate({ selection, mapping, offer, observation, expectedSupplier, now, maximumObservationAgeMs, maximumAutomaticChangePercent }) {
    if (!mapping) return result(selection, "REVIEW_REQUIRED", "GLOBAL_MAPPING_MISSING");
    if (id(mapping._id) !== id(selection.supplierMappingId)) return result(selection, "REVIEW_REQUIRED", "GLOBAL_MAPPING_IDENTITY_CONFLICT");
    if (!expectedSupplier || !id(mapping.supplierId) || id(mapping.supplierId) !== id(expectedSupplier._id) || upper(mapping.supplierCode) !== upper(expectedSupplier.supplierCode)) return result(selection, "REVIEW_REQUIRED", "GLOBAL_MAPPING_WRONG_SUPPLIER");
    if (!offer || id(mapping.supplierCatalogOfferId) !== id(offer._id)) return result(selection, "REVIEW_REQUIRED", "SUPPLIER_OFFER_REFERENCE_INVALID");
    if (!id(offer.supplierId) || id(offer.supplierId) !== id(mapping.supplierId)) return result(selection, "REVIEW_REQUIRED", "SUPPLIER_OFFER_IDENTITY_CONFLICT");
    if (mapping.productCode !== selection.productCode || upper(mapping.packageCode) !== upper(selection.packageCode)) return result(selection, "REVIEW_REQUIRED", "CANONICAL_PACKAGE_IDENTITY_CONFLICT");
    if (mapping.supplierProductCode !== offer.supplierProductCode || mapping.supplierPackageCode !== offer.supplierOfferCode) return result(selection, "REVIEW_REQUIRED", "NATIVE_SKU_IDENTITY_CONFLICT");
    if (upper(offer.catalogLifecycleState) !== "ACTIVE") return result(selection, "REVIEW_REQUIRED", "SUPPLIER_OFFER_NOT_ACTIVE");
    if (!observation) return result(selection, "REVIEW_REQUIRED", "FRESH_RUN_OBSERVATION_MISSING");
    if (!id(observation.supplierId) || id(observation.supplierId) !== id(offer.supplierId)) return result(selection, "REVIEW_REQUIRED", "OBSERVATION_SUPPLIER_IDENTITY_CONFLICT");
    const amount = Number(observation.amount), observedAt = new Date(observation.observedAt);
    if (!Number.isFinite(amount) || amount <= 0 || !upper(observation.currency) || !Number.isFinite(observedAt.getTime())) return result(selection, "REJECTED", "INVALID_SUPPLIER_COST");
    if (id(observation.supplierCatalogOfferId) !== id(offer._id) || observation.supplierProductCode !== offer.supplierProductCode || observation.supplierOfferCode !== offer.supplierOfferCode) return result(selection, "REVIEW_REQUIRED", "OBSERVATION_IDENTITY_CONFLICT");
    if (Number(now) - observedAt.getTime() > maximumObservationAgeMs) return result(selection, "REVIEW_REQUIRED", "STALE_OBSERVATION", { observedAt });
    if (upper(offer.supplierCost?.currency) !== upper(observation.currency) || Number(offer.supplierCost?.amount) !== amount) return result(selection, "REVIEW_REQUIRED", "OBSERVATION_OFFER_COST_CONFLICT");
    const comparison = compareSupplierCost(offer.supplierCost, mapping.supplierCostAuthority);
    if (comparison.state === "CURRENCY_MISMATCH") return result(selection, "REVIEW_REQUIRED", "CURRENCY_MISMATCH", { comparison });
    if (comparison.state === "INVALID_OBSERVATION" || comparison.state === "UNCOMPARABLE") return result(selection, "REJECTED", comparison.state, { comparison });
    if (comparison.state === "MATCH") return result(selection, "UNCHANGED", "COST_AUTHORITY_CURRENT", { comparison, observation, mapping, offer, initialAuthority: false });
    if (comparison.comparable && Math.abs(Number(comparison.percentageDelta)) > maximumAutomaticChangePercent) return result(selection, "REVIEW_REQUIRED", "LARGE_COST_MOVEMENT", { comparison });
    return result(selection, "ACCEPTABLE", hasAuthority(mapping) ? "FRESH_EXACT_SELECTED_COST" : "INITIAL_AUTHORITY_APPROVAL_REQUIRED", { comparison, observation, mapping, offer, initialAuthority: !hasAuthority(mapping) });
}

function createWeeklySupplierCostSyncService(options = {}) {
    const repos = options.repositories || createRepositories(options.models), promoter = options.promoter || promoteObservedCost, clock = options.clock || (() => new Date());
    async function reconcile({ supplierCode, ingestionRunId = "", dryRun = false, prepare = false, initialOnly = false, approvalHash = "", policy, actor, assertLease = async () => true }) {
        const expectedSupplier = await repos.supplier(upper(supplierCode));
        const selections = await repos.selections(), mappings = await repos.mappings(selections.map(row => row.supplierMappingId));
        const allMappingMap = new Map(mappings.map(row => [id(row._id), row]));
        const scopedSelections = selections.filter(selection => { const mapping = allMappingMap.get(id(selection.supplierMappingId)); return !mapping || upper(mapping.supplierCode) === upper(supplierCode); });
        const offers = await repos.offers(scopedSelections.map(row => allMappingMap.get(id(row.supplierMappingId))?.supplierCatalogOfferId).filter(Boolean));
        const offerMap = new Map(offers.map(row => [id(row._id), row]));
        const observations = await repos.observations(offers.map(row => row._id), ingestionRunId || null), observationMap = new Map();
        observations.forEach(row => { if (!observationMap.has(id(row.supplierCatalogOfferId))) observationMap.set(id(row.supplierCatalogOfferId), row); });
        const decisions = scopedSelections.map(selection => { const mapping = allMappingMap.get(id(selection.supplierMappingId)), catalogOffer = mapping ? offerMap.get(id(mapping.supplierCatalogOfferId)) : null, observation = catalogOffer ? observationMap.get(id(catalogOffer._id)) : null, offer = observation?.evidenceMode === "LATEST_ONLY" ? { ...catalogOffer, supplierCost: { amount: observation.amount, currency: observation.currency, observedAt: observation.observedAt }, sourceRevision: observation.sourceRevision, rawSnapshotHash: observation.rawSnapshotHash } : catalogOffer; return validateCandidate({ selection, mapping, offer, observation, expectedSupplier, now: clock().getTime(), maximumObservationAgeMs: policy.maximumObservationAgeMs, maximumAutomaticChangePercent: policy.maximumAutomaticChangePercent }); });
        const initialCandidates = decisions.filter(row => row.status === "ACCEPTABLE" && row.initialAuthority).map(immutableCandidate), initialManifestHash = initialCandidates.length ? manifestHash(initialCandidates) : "";
        let approval = approvalHash ? await repos.approval(approvalHash) : null;
        if (initialCandidates.length && prepare) approval = await repos.createManifest({ manifestHash: initialManifestHash, candidates: initialCandidates, status: "PENDING" });
        const approvalMappingIds = new Set((approval?.candidates || []).map(row => id(row.mappingId)));
        const currentApprovedCandidates = decisions.filter(row => approvalMappingIds.has(row.mappingId) && row.mapping && row.offer && row.observation).map(immutableCandidate);
        const approvalExact = Boolean(approval && currentApprovedCandidates.length === approval.candidates.length && manifestHash(currentApprovedCandidates) === approval.manifestHash && currentApprovedCandidates.every(candidate => approval.candidates.some(approved => id(approved.mappingId) === candidate.mappingId && exactCandidate(candidate, approved))));
        for (const decision of decisions.filter(row => row.status === "ACCEPTABLE")) {
            if (initialOnly && !decision.initialAuthority) { decision.status = "REVIEW_REQUIRED"; decision.code = "APPROVAL_SCOPE_EXCLUDES_EXISTING_AUTHORITY"; continue; }
            if (decision.initialAuthority) {
                const approved = approvalExact && ["APPROVED", "CONSUMED"].includes(approval.status) && Number(approval.maximumInitialPromotions) >= approval.candidates.length && (approval.status === "CONSUMED" || new Date(approval.expiresAt).getTime() > clock().getTime());
                const approvedCandidate = approved && approval.candidates?.find(row => id(row.mappingId) === decision.mappingId);
                if (!approved || !approvedCandidate || !exactCandidate(immutableCandidate(decision), approvedCandidate)) { decision.status = "REVIEW_REQUIRED"; decision.code = approval ? "INITIAL_AUTHORITY_APPROVAL_MISMATCH" : "INITIAL_AUTHORITY_APPROVAL_REQUIRED"; continue; }
            }
            if (dryRun || prepare) { decision.status = "DRY_RUN_ACCEPTABLE"; continue; }
            try {
                await assertLease();
                const token = `weekly-cost:${ingestionRunId}:${approval?.manifestHash || "existing"}:${decision.mappingId}:${observedCostHash(decision.offer)}`;
                const promotionActor = decision.initialAuthority ? {
                    id: approval.approvedBy.adminId,
                    username: approval.approvedBy.username,
                    role: approval.approvedBy.role
                } : actor;
                const promoted = await promoter({ mappingId: decision.mappingId, supplierCatalogOfferId: id(decision.offer), sourceLock: sourceLock(decision.mapping, decision.offer), confirmed: true, reason: `Validated weekly supplier cost sync ${ingestionRunId}`, idempotencyToken: token.slice(0, 200) }, { actor: promotionActor, requestId: `weekly-cost-${ingestionRunId}` });
                decision.status = promoted.replayed ? "IDEMPOTENT_REPLAY" : "UPDATED"; decision.code = promoted.replayed ? "ALREADY_APPLIED" : "COST_AUTHORITY_UPDATED";
            } catch (error) { decision.status = "REVIEW_REQUIRED"; decision.code = error.code || "COST_AUTHORITY_UPDATE_FAILED"; }
        }
        const sanitized = decisions.map(({ mapping, offer, observation, ...row }) => row);
        const summary = { schemaVersion: 2, supplierCode: upper(supplierCode), ingestionRunId: String(ingestionRunId || ""), dryRun: dryRun || prepare, mode: prepare ? "PREPARE" : dryRun ? "DRY_RUN" : "APPLY", completedAt: clock(), total: sanitized.length, updated: sanitized.filter(row => row.status === "UPDATED").length, replayed: sanitized.filter(row => row.status === "IDEMPOTENT_REPLAY").length, unchanged: sanitized.filter(row => row.status === "UNCHANGED").length, reviewRequired: sanitized.filter(row => row.status === "REVIEW_REQUIRED").length, rejected: sanitized.filter(row => row.status === "REJECTED").length, initialCandidateCount: initialCandidates.length, initialManifestHash, approvalId: id(approval), planHash: sha(canonicalJson(sanitized.map(row => [row.productCode, row.packageCode, row.mappingId, row.status, row.code]))), decisions: sanitized };
        const approvedOutcomes = sanitized.filter(row => approvalMappingIds.has(row.mappingId) && ["UPDATED", "IDEMPOTENT_REPLAY", "UNCHANGED"].includes(row.status));
        if (!dryRun && !prepare && approvalExact && approvedOutcomes.length === approval.candidates.length) await repos.consumeApproval(approval._id, { ingestionRunId, planHash: summary.planHash, updated: summary.updated, replayed: summary.replayed });
        if (!dryRun && ingestionRunId) await repos.updateRun(ingestionRunId, summary);
        return summary;
    }
    return Object.freeze({ reconcile });
}

module.exports = Object.freeze({ createRepositories, validateLegacyRunEvidence, validateCandidate, immutableCandidate, candidateSnapshot, manifestHash, exactCandidate, createWeeklySupplierCostSyncService });
