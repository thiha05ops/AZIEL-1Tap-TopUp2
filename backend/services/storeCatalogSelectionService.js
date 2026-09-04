"use strict";

const mongoose = require("mongoose");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierCatalogProduct = require("../models/SupplierCatalogProduct");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const Supplier = require("../models/Supplier");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const { assessExistingPreparedRoute } = require("./supplierCatalog/supplierRoutePreparationService");

class StoreCatalogSelectionError extends Error {
    constructor(code, message, statusCode = 400, details = {}) { super(message); this.name = "StoreCatalogSelectionError"; this.code = code; this.statusCode = statusCode; this.details = details; }
}
const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();
const id = value => clean(value?._id || value);

function createStoreCatalogSelectionService(models = {}, dependencies = {}) {
    const M = { Selection: models.Selection || StoreCatalogSelection, Mapping: models.Mapping || SupplierProductMapping, Offer: models.Offer || SupplierCatalogOffer, SupplierProduct: models.SupplierProduct || SupplierCatalogProduct, Availability: models.Availability || SupplierOfferAvailability, Package: models.Package || CatalogPackage, Product: models.Product || CatalogProduct, Supplier: models.Supplier || Supplier, Publication:models.Publication||PackageMarketPublication };
    const lean = (query, session) => (session && query.session ? query.session(session) : query).lean();
    async function list(query = {}, session = null) {
        const filter = { status: "ACTIVE" };
        if (query.productCode) filter.productCode = lower(query.productCode);
        if (query.supplierMarket) filter.supplierMarket = upper(query.supplierMarket);
        if (query.sellingRegion) filter.sellingRegions = upper(query.sellingRegion);
        const selections=await lean(M.Selection.find(filter).sort({ productCode: 1, supplierMarket: 1 }), session),productCodes=[...new Set(selections.map(item=>item.productCode))],packageCodes=[...new Set(selections.flatMap(item=>item.packages||[]).map(item=>item.packageCode))];
        const[products,packages]=await Promise.all([productCodes.length?lean(M.Product.find({productCode:{$in:productCodes}}).select("productCode name"),session):[],packageCodes.length?lean(M.Package.find({productCode:{$in:productCodes},packageCode:{$in:packageCodes},deletedAt:null}).select("productCode packageCode name"),session):[]]);
        const productNames=new Map(products.map(item=>[item.productCode,item.name])),packageNames=new Map(packages.map(item=>[`${item.productCode}/${item.packageCode}`,item.name]));
        return selections.map(item=>({...item,productName:productNames.get(item.productCode)||item.productCode,packages:(item.packages||[]).map(pkg=>({...pkg,packageName:packageNames.get(`${item.productCode}/${pkg.packageCode}`)||pkg.packageCode}))}));
    }
    async function save(input = {}, context = {}) {
        const productCode = lower(input.productCode), supplierMarket = upper(input.supplierMarket), supplierId = clean(input.supplierId);
        const sellingRegions = [...new Set((input.sellingRegions || []).map(upper))].filter(region => ["TH", "MM"].includes(region)).sort();
        const mappingIds = [...new Set((input.mappingIds || []).map(clean).filter(Boolean))];
        if (!productCode || !supplierMarket || !supplierId || !sellingRegions.length || !mappingIds.length) throw new StoreCatalogSelectionError("STORE_SELECTION_INCOMPLETE", "Choose selling regions, product, supplier, and at least one package.");
        const transaction = context.transaction || (async fn => { const session = await mongoose.startSession(); try { let result; await session.withTransaction(async () => { result = await fn(session); }); return result; } finally { await session.endSession(); } });
        return transaction(async session => {
            const supplier = await lean(M.Supplier.findOne({ _id: supplierId }), session);
            const mappings = await lean(M.Mapping.find({ _id: { $in: mappingIds }, productCode, supplierId, region: supplierMarket, archivedAt: null }), session);
            const current = await lean(M.Selection.findOne({ productCode, supplierMarket }), session);
            if (!supplier) throw new StoreCatalogSelectionError("STORE_SELECTION_SUPPLIER_MISSING", "The selected supplier is unavailable.", 404);
            if (current && Number(input.expectedDecisionVersion || 0) !== Number(current.decisionVersion || 0)) throw new StoreCatalogSelectionError("STORE_SELECTION_STALE", "This Store Catalog product changed. Refresh and review it again.", 409);
            if (mappings.length !== mappingIds.length) throw new StoreCatalogSelectionError("STORE_SELECTION_SCOPE_MISMATCH", "One or more packages do not belong to this exact product and supplier market.", 409);
            const offerIds = mappings.map(item => item.supplierCatalogOfferId).filter(Boolean), packageCodes = mappings.map(item => upper(item.packageCode));
            const offers = offerIds.length ? await lean(M.Offer.find({ _id: { $in: offerIds } }), session) : [];
            const product = await lean(M.Product.findOne({ productCode }), session);
            const packages = await lean(M.Package.find({ productCode, packageCode: { $in: packageCodes } }), session);
            const supplierProductIds = [...new Set(offers.map(item => id(item.supplierCatalogProductId)).filter(Boolean))];
            const supplierProducts = supplierProductIds.length ? await lean(M.SupplierProduct.find({ _id: { $in: supplierProductIds } }), session) : [];
            const availabilityRows = offerIds.length ? await lean(M.Availability.find({ supplierCatalogOfferId: { $in: offerIds } }), session) : [];
            const offerById = new Map(offers.map(item => [id(item), item]));
            const supplierProductById = new Map(supplierProducts.map(item => [id(item), item]));
            const availabilityByOfferId = new Map(availabilityRows.map(item => [id(item.supplierCatalogOfferId), item]));
            const packagesByCode = new Map();
            for (const pkg of packages) { const code = upper(pkg.packageCode); packagesByCode.set(code, [...(packagesByCode.get(code) || []), pkg]); }
            const assessments = mappings.map(mapping => {
                const offer = offerById.get(id(mapping.supplierCatalogOfferId));
                return { mapping, assessment: assessExistingPreparedRoute({ mapping, supplier, offer, supplierProduct: supplierProductById.get(id(offer?.supplierCatalogProductId)), availability: availabilityByOfferId.get(id(offer)), canonicalProduct: product, canonicalPackages: packagesByCode.get(upper(mapping.packageCode)) || [] }, sellingRegions, dependencies) };
            });
            const invalid = assessments.filter(item => !item.assessment.ready);
            if (!product || invalid.length) throw new StoreCatalogSelectionError("STORE_SELECTION_MAPPING_NOT_PREPARED", "One or more selected packages are not fulfillment-ready inventory.", 409, { mappingIds: invalid.map(item => id(item.mapping)), outcomes: invalid.map(item => item.assessment.outcome) });
            await M.Product.updateOne({ _id: product._id }, { $set: { deletedAt: null, enabled: true, lifecycleStatus: "ACTIVE" } }, { session });
            await M.Package.updateMany({ _id: { $in: packages.map(item => item._id) } }, { $set: { deletedAt: null, enabled: true } }, { session });
            const now = new Date(), update = { productCode, supplierId, supplierCode: upper(supplier.supplierCode), supplierMarket, sellingRegions, visibleRegions:(current?.visibleRegions||[]).filter(region=>sellingRegions.includes(region)), packages: mappings.map(mapping => ({ packageCode: upper(mapping.packageCode), supplierProductMappingId: mapping._id })).sort((a, b) => a.packageCode.localeCompare(b.packageCode)), status: "ACTIVE", decisionVersion: Number(current?.decisionVersion || 0) + 1, selectedBy: clean(context.actor?.username || context.actor || "admin"), selectedAt: now, removedBy: "", removedAt: null };
            const selection = await M.Selection.findOneAndUpdate({ productCode, supplierMarket }, { $set: update }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, session }).lean();
            return { selection, created: !current, canonicalCommercialRecordsPrepared: 1 + packages.length, publicPackagesChanged: 0, pricesChanged: 0, mappingsChanged: 0, supplierCalls: 0 };
        });
    }
    async function removePackage(input = {}, context = {}) {
        const selection = await M.Selection.findOne({ _id: input.selectionId, status: "ACTIVE" });
        if (!selection) throw new StoreCatalogSelectionError("STORE_SELECTION_NOT_FOUND", "Store Catalog product not found.", 404);
        if (Number(input.expectedDecisionVersion || 0) !== Number(selection.decisionVersion || 0)) throw new StoreCatalogSelectionError("STORE_SELECTION_STALE", "This Store Catalog product changed. Refresh it and try again.", 409);
        const packageCode = upper(input.packageCode), before = selection.packages.length;
        const live=await M.Publication.exists({productCode:selection.productCode,packageCode,customerMarket:{$in:selection.sellingRegions},published:true});
        if(live&&input.confirmed!==true)throw new StoreCatalogSelectionError("STORE_SELECTION_LIVE_CONFIRMATION_REQUIRED","This package is currently live. Confirm removal to keep it private and remove it from normal Store Catalog workflows.",409);
        selection.packages = selection.packages.filter(item => upper(item.packageCode) !== packageCode);
        if (selection.packages.length === before) throw new StoreCatalogSelectionError("STORE_SELECTION_PACKAGE_NOT_FOUND", "Package is not in this Store Catalog product.", 404);
        selection.decisionVersion += 1; selection.selectedBy = clean(context.actor?.username || context.actor || "admin"); selection.selectedAt = new Date();
        await selection.save();
        return { selection: selection.toObject(), wasLive:Boolean(live), mappingDeleted: false, historyDeleted: false };
    }
    async function setRegionVisibility(input={},context={}){const region=upper(input.region);if(!["TH","MM"].includes(region)||typeof input.visible!=="boolean")throw new StoreCatalogSelectionError("STORE_SELECTION_VISIBILITY_INVALID","Choose a valid selling region and visibility state.");const selection=await M.Selection.findOne({_id:input.selectionId,status:"ACTIVE"});if(!selection)throw new StoreCatalogSelectionError("STORE_SELECTION_NOT_FOUND","Store Catalog product not found.",404);if(!selection.sellingRegions.includes(region))throw new StoreCatalogSelectionError("STORE_SELECTION_REGION_NOT_SELECTED","This region is not part of the Store Catalog product.",409);if(Number(input.expectedDecisionVersion||0)!==Number(selection.decisionVersion||0))throw new StoreCatalogSelectionError("STORE_SELECTION_STALE","This Store Catalog product changed. Refresh it and try again.",409);selection.visibleRegions=[...new Set(input.visible?[...selection.visibleRegions,region]:selection.visibleRegions.filter(item=>item!==region))].sort();selection.decisionVersion+=1;selection.selectedBy=clean(context.actor?.username||context.actor||"admin");selection.selectedAt=new Date();await selection.save();return{selection:selection.toObject(),pricesChanged:0,publicationDecisionsChanged:0,mappingsChanged:0}}
    return { list, save, removePackage, setRegionVisibility };
}

const service = createStoreCatalogSelectionService();
module.exports = { StoreCatalogSelectionError, createStoreCatalogSelectionService, listStoreCatalogSelections: service.list, saveStoreCatalogSelection: service.save, removeStoreCatalogPackage: service.removePackage, setStoreCatalogRegionVisibility:service.setRegionVisibility };
