# AZIEL Commerce Platform Master Blueprint v1.0

Status: Permanent architecture constitution  
Repository basis: AZIEL 1Tap Shop, audited 2026-07-30  
Authority: The current repository is the factual source; this blueprint governs future architectural decisions.

## 1. Executive Summary

AZIEL is a regional digital-commerce platform for game packages, gift cards, social top-ups, and wallet-funded purchases in Myanmar and Thailand. It combines a public storefront, customer identity and wallet, configurable payment rails, manual PromptPay operations, promotions, content management, supplier fulfillment, customer support, and an owner-facing operating system.

AZIEL is beyond prototype stage. The repository contains durable domain models, authenticated and role-gated APIs, quote-backed Commerce checkout, immutable order snapshots, payment attempts, server-authoritative recovery, supplier mappings, pricing policy/version controls, idempotent wallet ledger operations, admin audit records, operational dashboards, and a broad executable verifier suite. The system is best classified as a late growth-stage monolith undergoing authority consolidation.

Its strongest architectural asset is the Commerce pipeline:

```text
CatalogPackage
  -> productionPricingContextService
  -> pricingCalculationEngine
  -> PricingQuote
  -> checkoutApplicationService
  -> CommerceOrder
  -> paymentOrchestrator
  -> PaymentAttempt
  -> provider adapter / wallet
  -> fulfillment
```

This pipeline is materially implemented, not aspirational. Manual PromptPay checkout enters it through `customerManualPromptPayCheckoutService`; wallet purchases enter it through `customerWalletCheckoutService`. The authoritative monetary snapshot is persisted before payment work begins.

The primary weakness is coexistence, not absence: the canonical Commerce models and services operate alongside legacy `Order` and `ManualPaymentAttempt` paths, merged read projections, and compatibility APIs. The public frontend is also a large multi-page, global-script runtime whose correctness depends on script order, global objects, custom events, and repeated page-level initialization conventions. This increases regression risk even where backend domain design is sound.

The correct strategy is consolidation in place. AZIEL should not be rewritten. The current system has too much verified domain behavior and operational knowledge to discard. Future work must progressively route every new write through one authority while retaining legacy data as read-only compatibility until it can be retired safely.

## 2. Business Vision

### Mission

Make digital goods purchasing in Myanmar and Thailand reliable, locally understandable, operationally controllable, and financially auditable from price decision through fulfillment.

### Vision

AZIEL becomes a regional commerce operating system: one platform through which the owner can control catalog, supplier economics, prices, promotions, payment rails, customer relationships, fulfillment, content, and operational health while customers receive a fast, trustworthy storefront experience in their language and currency.

### Business Model

AZIEL earns margin by acquiring digital goods or fulfillment capacity at supplier cost and selling packages at a server-authoritative customer price. The platform may additionally absorb or pass through gateway, wallet, platform, exchange, and campaign costs according to published policy. Profit is therefore a property of an immutable commercial snapshot, not a difference reconstructed later from mutable catalog data.

Revenue and cost must remain currency-specific. MMK and THB are separate ledgers and analytical dimensions; they must never be summed without an explicit exchange-rate context and labeled conversion.

### Long-Term Direction

AZIEL should evolve as a modular monolith with explicit domain contracts, not as a collection of page flows and not prematurely as microservices. Internal boundaries should become strong enough that selected high-load or high-risk capabilities can later be extracted without changing business semantics.

The long-term platform has three surfaces:

- Storefront Runtime: customer discovery, quote, payment, recovery, fulfillment visibility, wallet, and support.
- Owner Workspace: pricing, catalog, orders, payments, wallet operations, campaigns, content, customer support, and business health.
- Commerce Core: server-side authority for commercial calculation, immutable commitments, payment orchestration, and operational state transitions.

## 3. Platform Domain Constitution

| Domain | Purpose and responsibilities | Owned data | Dependencies | Must never own |
|---|---|---|---|---|
| Commerce | Coordinate quote-backed purchase creation and preserve commercial truth | `PricingQuote`, `CommerceOrder`, checkout idempotency and snapshots | Catalog, Pricing, Promotion, Identity, Payments | UI state, provider SDK details, mutable catalog presentation |
| Catalog | Define sellable products, packages, regional availability, fulfillment schema, and presentation references | `CatalogProduct`, `CatalogPackage`, `StorefrontSection`, package inventory state | Media, Supplier mappings, Pricing publication | Customer payable calculation, payment state, order history |
| Supplier Cost | Record acquisition cost, supplier identity, currency, version, and timestamp | Canonical package supplier-cost snapshots and `Supplier` / `SupplierProductMapping` associations | Catalog, Exchange, Admin authorization | Customer selling price, discounts, payment status |
| Pricing | Resolve policy, exchange, fees, profit, tax, and rounding into a calculated result | `PricingPolicy`, `PricingRule`, `PriceVersion`, `PricingWorkspaceDraft` | Catalog, Supplier Cost, Exchange | Checkout ownership, payment state, promotion redemption |
| Promotions | Determine eligibility and customer benefit; reserve and finalize usage | `PromotionRule`, `CommerceCampaign`, `PromoCode`, `PromoRedemption`, usage state | Pricing quote context, Identity, Catalog | Base-price calculation, payment confirmation, fulfillment |
| Orders | Preserve the immutable purchase commitment and mutable lifecycle | `CommerceOrder`; legacy `Order` only as compatibility history | Quote, Payment, Fulfillment, Customer snapshot | Recalculation from current catalog, provider-specific execution |
| Payments | Initiate and transition payment work against locked order amounts | `PaymentAttempt`, `PaymentMethod`, `PaymentProviderConfig` | CommerceOrder, provider adapters, Admin authorization | Price calculation, order creation, fulfillment execution |
| Wallet | Maintain balances through an append-only, idempotent financial ledger; manage top-ups | User balances, `WalletTransaction`, `WalletTopup`, `WalletTopupIntent` | Identity, Payment methods, CommerceOrder | Arbitrary balance assignment, catalog price calculation |
| Fulfillment | Execute paid order delivery through supplier mappings and attempts | `FulfillmentAttempt`, operational references, fulfillment state | CommerceOrder, Supplier, Catalog fulfillment schema | Payment confirmation, price mutation, customer authentication |
| Identity | Authenticate customers and bind sessions, devices, regions, and security events | `User`, `Session`, `SecurityEvent`, registration and 2FA state | Email, Notification | Commerce price, wallet ledger decisions, admin authorization |
| Administration | Authenticate operators, authorize actions, and record audits | `AdminAccount`, `AdminSession`, `AdminLoginChallenge`, `AdminAuditLog` | Every managed domain through permissioned APIs | Domain data ownership or direct database shortcuts |
| Customer CRM | Project customer value and history; own private operator notes | `CustomerNote`; read models assembled from User, Orders, Wallet, Support | Identity, Orders, Wallet, Support | Duplicate order/wallet editors, reward execution |
| Marketing | Define campaigns, placements, promo communication, and campaign interactions | `Campaign`, `CampaignClaimState`, `CampaignImpression`, `PromotionNotification` | Promotions, Content, Notification | Core price authority, order payment status |
| Content and Media | Manage published visual/content assets and placement configuration | `MediaAsset`, `HomeBanner`, `GameBanner`, `SitePlacement`, presentation fields | Catalog, Storage, Website Runtime | Checkout logic, pricing policy, customer records |
| Support | Manage tickets and live customer conversations | `SupportTicket`, `LiveChat` | Identity, Orders as read context, Notification | Order mutation, wallet mutation, payment approval |
| Notification and Email | Deliver idempotent customer communications from domain events | `Notification`, `EmailDelivery`, promotion notifications | Identity and emitting domains | Domain state transitions, recipient-derived business authority |
| Analytics | Produce bounded read projections for owner decisions | Derived aggregates and dashboard response models | Orders, Wallet, Users, Payment attempts, Catalog | Operational writes or cross-currency summation |
| Storefront | Render published public state and submit customer intent | Browser-local UX state only | Public Catalog, Content, Commerce, Identity APIs | Prices as authority, private/admin data, provider credentials |
| Configuration Runtime | Observe and resolve controlled configuration contexts and transient sessions | Registry definitions; transient configuration sessions/drafts where explicitly defined | Existing owner adapters | Replacing authoritative domain persistence or hidden write paths |

## 4. Current Architecture Audit

### 4.1 System Shape

AZIEL is a CommonJS Node.js modular monolith using Express 5, Mongoose/MongoDB, server-side sessions, JWT customer sessions, Socket.IO realtime events, and static multi-page HTML/CSS/JavaScript. `backend/server.js` composes middleware and mounts 26 route modules under `/api`; the frontend is served directly from `frontend/`.

Repository scale at audit time:

- 315 backend JavaScript files, approximately 74,571 lines.
- 140 frontend JavaScript files, approximately 54,314 lines.
- 55 public/admin HTML pages.
- 61 CSS files, approximately 37,108 lines.
- 52 Mongoose model files.
- 129 focused verifier scripts.

This is enough surface area that conventions must be enforced by ownership contracts and executable boundary tests rather than developer memory.

### 4.2 Backend Strengths

- The Commerce calculation engine is pure and versioned (`backend/services/commerce/pricingCalculationEngine.js`), with explicit validation, warnings, scope precedence, currency controls, and deterministic rounding.
- Quote creation and persistence are separated (`pricingQuoteApplicationService.js`, `pricingQuoteRepository.js`).
- Checkout rejects browser commercial authority and consumes a quote transactionally (`checkoutApplicationService.js`).
- `CommerceOrder` stores immutable owner, product, commercial, pricing, promotion, checkout, quote, and customer snapshots while keeping payment and fulfillment lifecycle fields mutable.
- `paymentOrchestrator.js` centralizes attempt initiation and state transitions; providers implement an adapter contract rather than editing orders directly.
- Manual PromptPay is integrated through a provider adapter and application service; dynamic QR, receipt evidence, expiry, and admin approval are represented by `PaymentAttempt`.
- Commerce recovery is server-authoritative and owner-scoped (`commercePaymentRecoveryService.js`); browser storage is a UX hint.
- Admin authorization uses named permissions and explicit role matrices (`adminAuthorizationService.js`).
- Wallet mutations are centralized and ledger-backed in `walletService.js`.
- Security, CORS, rate limits, production readiness, upload restrictions, idempotent email delivery, and audit logging are first-class concerns.

### 4.3 Frontend Strengths

- Shared payment rendering exists in `payment-checkout-sheet.js`; manual, deeplink, wallet, Save QR, bank launcher, receipt, and recovery behavior converge on it.
- Catalog is data-driven through public APIs rather than a separate search or checkout catalog.
- Public design tokens, theme ownership, responsive behavior, accessibility, reduced motion, i18n, PWA, and SEO have dedicated runtime and verifier coverage.
- Admin modules share a shell, design system, API helpers, layout controller, RBAC projection, and section lifecycle events.
- AZIEL OS kernel, service container, event bus, app registry, and workspace manager provide an emerging frontend runtime boundary.

### 4.4 Split Authorities and Duplication

The following are deliberate compatibility bridges today but must not become permanent dual-write architectures:

1. Orders: `CommerceOrder` is the new write authority, while `Order` remains heavily used by history, admin operations, refunds, fulfillment, wallet top-up relationships, and legacy flows. `backend/routes/order.js` explicitly merges both read models.
2. Payment attempts: `PaymentAttempt` is the Commerce authority; `ManualPaymentAttempt` remains in legacy manual-payment APIs and recovery compatibility.
3. Checkout: Commerce customer checkout exists, but legacy payable creation code remains in `backend/routes/payment.js` and `backend/routes/order.js`, with explicit disabled responses around some entry points and still-reachable compatibility internals.
4. Promotions: Commerce promotion resolution and reservation coexist with legacy promo quote/redemption services and models.
5. Pricing: `PricingPolicy`, `PriceVersion`, supplier-cost snapshots, and calculation runtime coexist with regional `CatalogPackage.prices`, which still serves as the published storefront projection and legacy compatibility price.
6. Frontend API helpers: several global fetch wrappers (`frontend/js/api.js`, `frontend/services/api.js`, `frontend/js/admin-api.js`, module-local wrappers) use related but non-identical auth, timeout, and error conventions.
7. Frontend lifecycle: page scripts rely on `DOMContentLoaded`, custom events, dynamic injection in `pwa-fix.js`, and global initialization guards. The architecture works but is sensitive to duplicate loading and script order.
8. Content ownership: Home banners, site placements, storefront sections, campaigns, and static markup all contribute to public composition. `websiteRuntimeService.js` itself identifies mixed ownership and static fallbacks.
9. Naming: `fulfillment` and `fulfilment`, uppercase Commerce states and lowercase persistence states, `paymentMethod` display/raw values, `productCode`/`gameKey`, and `packageId`/`packageCode`/`packageRef` coexist at boundaries.

### 4.5 Architecture Smells

- Route modules such as `payment.js`, `wallet.js`, `order.js`, `catalog.js`, and `paymentMethods.js` are large and include orchestration, normalization, persistence, response mapping, and compatibility logic in one file.
- Read models are often assembled directly in routes instead of dedicated projection services.
- Mixed `mongoose.Schema.Types.Mixed` snapshots protect compatibility but weaken schema-level discoverability and validation.
- Admin is a single large HTML application with many section-specific scripts, so DOM selectors and section events form implicit contracts.
- Public pages include legacy and current assets side by side (`old-shop.html`, `old-admin-orders.html`, old game CSS, old notification script), increasing accidental-load risk.
- The verifier suite is broad but predominantly custom static/runtime harnesses rather than a conventional test runner with coverage reporting and contract fixtures.
- Operational observability is distributed across console logging, audit models, readiness scripts, and route-specific diagnostics rather than one trace/correlation standard.
- The current JWT service includes a development fallback secret in source. Production readiness may prevent unsafe deployment, but the architectural rule must be fail-closed configuration for all cryptographic secrets.

### 4.6 Dead-Code Candidates

These are candidates for evidence-based retirement, not deletion directives:

- `frontend/old-shop.html`, `frontend/old-admin-orders.html`, `frontend/old-terms.html`.
- `frontend/js/notifications-old.js` and `frontend/css/core/old-responsive.css`.
- `frontend/css/game/old-*.css`.
- Legacy payable branches in `backend/routes/payment.js` and `backend/routes/order.js` after all production entry points and historical tools are proven Commerce-backed.
- Legacy recovery endpoints after all nonterminal `ManualPaymentAttempt` records have expired or been migrated.
- Duplicate API/helper modules after per-page consumers are inventoried.

No candidate should be removed based on naming alone. Removal requires runtime include search, route traffic evidence, data population evidence, and verifier replacement.

## 5. Source-of-Truth Matrix

| Concern | Single authority | Write model | Read/projection models | Runtime owner |
|---|---|---|---|---|
| Product identity and availability | Catalog | `CatalogProduct`, `CatalogPackage` | Public catalog and admin catalog projections | `catalogService`, `catalogAdminService` |
| Supplier acquisition cost | Supplier Cost | Canonical package supplier-cost snapshot/history | Pricing workspace draft and published cost projection | `supplierCostService`, pricing control-center publish |
| Customer payable amount | Pricing Quote | `PricingQuote.commercialSnapshot` | Public quote/session projection | `pricingCalculationEngine` through `pricingQuoteApplicationService` |
| Purchase commitment | Commerce Order | `CommerceOrder` | Customer history/admin merged read model | `checkoutApplicationService`, `orderRepository` |
| Payment work | Payment Attempt | `PaymentAttempt` | Checkout session, recovery, admin payment queue | `paymentOrchestrator`, payment application services |
| Payment method configuration | Payment Methods | `PaymentMethod`, `PaymentProviderConfig` | Customer-safe capabilities | payment method serializers and provider registry |
| Wallet balance | Wallet ledger | `WalletTransaction` plus synchronized User balances | Wallet history and admin wallet projection | `walletService` |
| Promotion eligibility | Promotion Resolver | `PromotionRule`/campaign/promo state | Quote promotion snapshot | `promotionResolver`, `commercePromotionBridgeService` |
| Promotion consumption | Promotion redemption | `PromoRedemption`, usage state | Order/quote promotion snapshot | promotion bridge/reservation service |
| Fulfillment execution | Fulfillment | `FulfillmentAttempt` and CommerceOrder fulfillment state | Admin operations and customer order status | `fulfillmentService` |
| Customer identity | Identity | `User`, `Session` | Safe customer/admin CRM projection | `authSessionService` and auth routes |
| Admin identity and authority | Administration | `AdminAccount`, `AdminSession`, challenge/audit models | Admin shell identity/permissions | `adminAuthService`, `adminAuthorizationService` |
| Public content | Owning content model | Home/Game banners, placements, campaigns, catalog presentation | Website runtime/public endpoints | corresponding content service and owner adapter |
| Notification delivery | Notification/Email | `Notification`, `EmailDelivery` | Notification store and delivery status | notification and email services |

Constitutional rule: projections may merge sources; write paths may not. A compatibility read model may combine `Order` and `CommerceOrder`, but a new customer purchase must create only the canonical Commerce records.

## 6. Data Flows

### 6.1 Customer Purchase Journey

```text
Public page
  -> GET public Catalog + published presentation
  -> customer selects package and region
  -> PaymentEngine.startCommerceManualPromptPay()
  -> POST /api/commerce/checkout/manual-promptpay
  -> customerManualPromptPayCheckoutService
       -> load CatalogPackage and PaymentMethod
       -> buildProductionPricingContext
       -> createAndPersistPricingQuote
       -> checkoutFromQuote
            -> lock/consume PricingQuote
            -> persist CommerceOrder snapshot
       -> manualPaymentApplicationService
            -> paymentOrchestrator
            -> manualPromptPayAdapter
            -> persist PaymentAttempt and dynamic QR
  -> PaymentCheckoutSheet renders QR/countdown/actions
  -> POST Commerce receipt endpoint
  -> PaymentAttempt receipt attached; order remains pending
  -> Admin approve/reject application service
  -> CommerceOrder payment transition
  -> fulfillment becomes eligible only after paid
  -> customer history reads CommerceOrder plus legacy history
```

The browser may carry IDs, customer fulfillment input, locale, payment selection, and idempotency keys. It must never carry authoritative amount, discount, fee, exchange rate, supplier cost, profit, status, or ownership.

### 6.2 Recovery Journey

```text
Page boot / checkout close / notification action
  -> GET /api/commerce/payments/recoverable
  -> authenticated owner-scoped PaymentAttempt query
  -> CommerceOrder ownership validation
  -> public-safe recovery projection
  -> merge with legacy recoverables for compatibility
  -> Commerce record wins on duplicate identity
  -> PaymentCheckoutSheet.openRecoveredPayment
  -> existing attempt, QR expiry, receipt state, and launcher capabilities restored
```

Local storage is a hint to accelerate UX and must not confer authority. Closing a browser, clearing storage, or changing device must not make a valid server-side recoverable attempt undiscoverable after authenticated login.

### 6.3 Wallet Purchase Journey

```text
Catalog selection
  -> production pricing context
  -> PricingQuote
  -> CommerceOrder
  -> PaymentAttempt using locked order amount
  -> walletService idempotent debit in transaction
  -> Commerce payment paid
  -> fulfillment eligibility
```

Wallet top-up is a separate funding workflow. It may use eligible payment methods and manual evidence, but it must not impersonate a customer purchase or bypass the wallet ledger.

### 6.4 Owner Journey

```text
Admin authentication + RBAC
  -> Dashboard health and attention queues
  -> Catalog defines sellable inventory and presentation
  -> Supplier mappings define fulfillment/cost relationships
  -> Pricing workspace stages policy and supplier-cost drafts
  -> server preview calculates outcomes and margin
  -> OWNER publish creates active version and catalog projection
  -> Campaign/promo configuration defines eligibility and messaging
  -> public runtime reads only published state
  -> Orders/Payments/Wallet/Fulfillment workspaces execute operations
  -> CRM/Support provide customer context
  -> Audit records operator mutations
```

The owner workspace must orchestrate domain APIs; it must never become a second source of business rules in JavaScript.

## 7. Storefront Runtime Constitution

The storefront is a published-state renderer and customer-intent collector.

- Catalog pages consume enabled, non-deleted, region-compatible catalog projections.
- Home and game presentation consume published banners, placements, sections, campaigns, and media references.
- Current locale and region are cross-page runtime context, not pricing authority.
- Search indexes only public, enabled, customer-visible content.
- Checkout displays the server-returned Commerce session and PaymentAttempt capabilities.
- Dynamic QR rendering and saving use the current attempt response, never a configured static fallback in dynamic mode.
- Recovery discovers state from the server and restores the same attempt.
- Service worker caches only public shells/assets and must never cache authenticated API data, wallet, orders, notifications, account, or Admin responses.
- Empty, loading, offline, expired, and failed states are explicit; the UI must not fabricate availability or commercial facts.
- Disabled, draft, scheduled-not-yet-active, archived, or unpublished content is never exposed by public serializers.

Admin control does not mean arbitrary DOM injection. Every managed content type needs a typed public projection with bounded fields, explicit publication status, stable fallback policy, and cache behavior.

## 8. Owner Workspace Constitution

AZIEL OS is the operator surface for running the business. Its information architecture should remain domain-based and action-oriented:

| Workspace | Primary owner question | Required operational view |
|---|---|---|
| Command Center | Is the business healthy now? | Revenue by currency, order/payment health, provider health, attention queues, recent activity |
| Pricing | What will we earn and what can safely be published? | Supplier cost, exchange version, fees, selling price, discount, gross/net profit, margin, guard status |
| Catalog | What can customers buy and how is it presented? | Products, packages, regional availability, fulfillment schema, media, ordering, publication state |
| Orders | What has the customer bought and what state is it in? | Immutable commercial snapshot, payment attempt, fulfillment, refund, customer/audit timeline |
| Payments | Which attempts require action and are providers healthy? | Attempt state, evidence, method/provider, locked amount, expiry, failures, admin decision |
| Wallet | Are customer balances and top-ups financially sound? | Independent queue/review panes, evidence, ledger entries, balances by currency, operator notes |
| Fulfillment | What paid work is waiting or failing? | Supplier mapping, attempts, retries, references, failure resolution |
| Customer CRM | What is the full customer relationship? | Identity, orders, wallet, activity, support, private notes; read-only cross-domain context |
| Campaigns | What offer or message is active? | Lifecycle, target, schedule, placement, claims, promotion relationship |
| Support | What customer issue needs resolution? | Ticket/chat, customer and order context, response history; no financial mutation |
| Website Runtime | What public configuration is effective? | Owner, source, configured/fallback/effective value, validation, readiness, diagnostics |

Revenue reporting must display original currency buckets. Provider health must distinguish method configuration, initiation success, pending age, approval latency, and provider/webhook status. Negative-margin and missing-cost conditions are operational blockers, not decorative warnings.

Every destructive or financial action requires explicit permission, confirmation proportional to impact, idempotency, audit metadata, and a server-returned result before optimistic UI success.

## 9. Design System Audit and Constitution

### Current Foundation

The public design system is rooted in `frontend/css/theme/aziel-design-system.css`; the Admin system is rooted in `frontend/css/admin/admin-design-system.css`. Both use Inter, semantic theme variables, safe-area variables, shared purple accent, light/dark ownership, motion durations, spacing tokens, focus rings, status colors, and responsive constraints.

Public typography currently defines display, page, section, subsection, card, body, label, helper, metadata, and value scales. Admin defines a 4/8/12/16/20/24/32/40 spacing sequence, control/card/panel radii, 40px controls, 44px touch targets, and 120/180/260ms motion durations.

### Permanent Rules

- Typography is hierarchical, not decorative. Hero-scale type belongs only to true hero contexts.
- Spacing uses existing token scales; arbitrary one-off spacing is an exception requiring evidence.
- Cards represent bounded objects or tools, not every section. No card-inside-card composition.
- Desktop operational modules use bounded workspaces and independent pane scrolling where the task requires persistent comparison.
- Mobile uses list-to-detail navigation and normal document scrolling rather than compressed desktop splits.
- Controls use one visible focus owner, at least 44px touch targets on mobile, semantic buttons, and explicit disabled/loading states.
- Motion communicates entry, state change, or hierarchy using opacity/transform, remains under the existing duration scale, and respects reduced motion.
- Light and dark themes explicitly own foreground, background, border, and focus colors at component boundaries.
- Currency, payment provider, status, and region labels use centralized formatters; internal IDs never reach customers.
- English, Myanmar, and Thai share one locale authority. Dynamic strings, ARIA labels, errors, empty states, and actions use translation keys with English per-key fallback.
- Horizontal overflow is a defect except inside an explicitly labeled data-table scroller.

### Current Consistency Risks

- Public and Admin tokens overlap conceptually but are not one namespaced token package.
- Legacy page/game CSS can override newer foundations by load order.
- Large page-specific stylesheets encode component variants that are not always reusable.
- Global selectors and multiple theme scripts can create ownership ambiguity.
- Admin section DOM and script contracts are selector-based and lack typed component boundaries.

The design system should be consolidated by adoption and removal of duplicate ownership, not by a visual rewrite.

## 10. Development Constitution

1. One authority per business fact. Reads may aggregate; writes may not compete.
2. Every payable amount originates from the server-side Pricing Engine and is frozen in a PricingQuote and CommerceOrder.
3. Payment services consume locked order amounts and never calculate price.
4. Historical records are self-contained snapshots and never depend on current catalog, pricing, payment, or customer settings.
5. Currency is part of every monetary value. MMK and THB are never implicitly combined.
6. Domain state changes occur through application services, not routes, UI scripts, provider adapters, or database shortcuts.
7. Routes authenticate, authorize, validate transport input, call one application boundary, and serialize safe output.
8. Provider adapters translate protocols; they do not own Commerce state.
9. The wallet is a ledger. Balance changes require an idempotent ledger entry and transactional consistency.
10. Public serializers are allowlists. Raw Mongoose documents and internal metadata do not cross trust boundaries.
11. Compatibility is explicit, measurable, and read-oriented. No new feature may add writes to a legacy authority.
12. Idempotency keys are owner-scoped and request-fingerprinted for checkout, payment, wallet, promotion, fulfillment, email, and webhook operations.
13. Every financial or privileged mutation emits an audit event with safe metadata and correlation identity.
14. Admin permissions are domain capabilities; UI visibility is not authorization.
15. Business rules are specified before implementation and verified at the service boundary.
16. Data-driven UI renders server capabilities; it does not infer provider or commercial behavior from names.
17. Browser storage is UX state, never ownership or payment authority.
18. Published public state is separate from draft/admin state.
19. Failure is bounded and explicit: timeouts, terminal states, retries, and recovery semantics are part of the contract.
20. Existing behavior is migrated through adapters and projections; rewrites require proof that incremental consolidation is impossible.
21. Verifiers must exercise behavior or real contracts, not merely search for source text.
22. Architecture decisions that alter authority, lifecycle, money, identity, or compatibility require a versioned ADR and migration evidence.

## 11. Phased Migration Plan

### Phase 0: Architecture Consolidation

Establish and enforce the authority matrix in this document. Inventory every live write to `Order`, `ManualPaymentAttempt`, catalog selling-price fields, promo redemption, and wallet balances. Classify each as canonical, compatibility, migration, or prohibited. Add correlation IDs and contract-level observability at Commerce boundaries. New development is permitted only through canonical services.

Exit state: all new customer-payable writes are provably Commerce-backed; legacy writes are blocked or explicitly migration-only; runtime traffic can distinguish Commerce and legacy reads.

### Phase 1: Business Domains

Complete application-service boundaries for Orders, Payments, Wallet, Fulfillment, Pricing, Promotions, Supplier Cost, and Catalog. Normalize vocabulary at boundary serializers while preserving stored historical values. Move route-level orchestration behind services and make immutable snapshot schemas increasingly typed and versioned.

Exit state: domain services own transitions, routes are transport adapters, and each monetary or lifecycle fact has one write authority.

### Phase 2: Owner Workspace

Align AZIEL OS modules with the domain APIs and shared operational read models. Command Center becomes the health projection; Pricing becomes the publication authority; Orders, Payments, Wallet, Fulfillment, CRM, Support, Campaigns, and Website Runtime remain distinct workspaces with contextual links rather than duplicated editors.

Exit state: the owner can run daily operations from one coherent shell, with currency-safe metrics, provider and margin health, attention queues, and auditable actions.

### Phase 3: Storefront Runtime

Retire static and legacy content fallbacks only after typed public projections cover them. Consolidate public API helpers, initialization, locale/region context, payment-sheet loading, and recovery boot into one observable runtime lifecycle. Preserve multi-page delivery unless product evidence justifies another rendering architecture.

Exit state: every public page renders published data, every checkout enters Commerce, and no script-order or duplicate-initialization path can create competing state.

### Phase 4: Experience

Apply the established design system consistently across the full customer and owner journeys. Close accessibility, i18n, loading/empty/error, motion, mobile, and offline gaps using shared primitives. Experience work must not alter domain semantics.

Exit state: English, Myanmar, and Thai experiences are complete, responsive, accessible, and behaviorally consistent across public and Admin surfaces.

### Phase 5: Scale

Introduce measured performance controls: bounded queries, indexes derived from production access patterns, pagination, cache policy, background jobs for non-transactional work, durable event/outbox delivery where required, structured tracing, SLOs, backup/restore drills, and load testing. Extract services only where independent scaling, isolation, or ownership provides demonstrated value.

Exit state: AZIEL can grow transaction volume and operator count without weakening financial integrity, recoverability, or deployment safety.

## 12. Final Verdict

### Is AZIEL on the correct path?

Yes. The move from page-owned checkout calculations toward PricingQuote, CommerceOrder, PaymentAttempt, provider adapters, and server-authoritative recovery is the correct foundation. The repository shows repeated attention to idempotency, snapshots, RBAC, regional currencies, recovery, and operational tooling.

### Should AZIEL be rewritten?

No. A rewrite would discard verified payment, wallet, admin, localization, content, and operational behavior while recreating the same domain complexity. The system needs authority consolidation, boundary hardening, and retirement of compatibility paths—not replacement.

### Should AZIEL be consolidated?

Yes, decisively. Consolidation means one write authority per domain, thin transport routes, explicit projections, one frontend lifecycle convention, and measured legacy retirement. It does not mean merging every model or workspace into one module.

### Estimated Completion

Overall platform maturity is approximately **68%** toward a disciplined, production-scalable regional commerce platform.

This estimate reflects:

- Commerce and payment foundations: 78%.
- Catalog, content, and owner operations: 75%.
- Identity, security, wallet, and operational integrity: 76%.
- Authority consolidation and legacy retirement: 55%.
- Frontend runtime cohesion and design-system consolidation: 60%.
- Observability, conventional automated testing, performance engineering, and scale readiness: 45%.

The percentage is an architecture maturity estimate, not a feature count or delivery forecast.

### Critical Risks

1. Split legacy and Commerce write paths can diverge in lifecycle, recovery, reporting, and fulfillment.
2. Pricing publication and catalog price compatibility can obscure which value is cost, published price, or fallback.
3. Large route modules and global frontend scripts make ownership implicit and regression-prone.
4. Merged read models can hide incomplete migration unless architecture/source metadata remains visible.
5. Financial analytics can become incorrect if legacy/Commerce records or MMK/THB are combined without explicit rules.
6. Provider, webhook, wallet, email, and realtime side effects need a common durable delivery and correlation strategy as volume grows.
7. Legacy assets and duplicate lifecycle helpers increase the chance that a production page loads the wrong implementation.

### Highest Priorities

The governing priority is to finish Commerce authority consolidation before expanding platform breadth. Immediately behind it are typed financial snapshots, explicit legacy telemetry, route-to-application-service boundaries, unified operational projections, and frontend lifecycle consolidation. Experience and scale work should build on those authorities rather than masking ambiguity.

## Appendix A: Repository Evidence

Key audited implementation points:

- Application composition and route mounting: `backend/server.js`.
- Commerce calculation authority: `backend/services/commerce/pricingCalculationEngine.js`.
- Production pricing context: `backend/services/commerce/productionPricingContextService.js`.
- Quote application and persistence: `backend/services/commerce/pricingQuoteApplicationService.js`, `pricingQuoteRepository.js`, `backend/models/PricingQuote.js`.
- Quote-backed checkout and order persistence: `backend/services/commerce/checkoutApplicationService.js`, `orderRepository.js`, `orderSnapshotRuntime.js`, `backend/models/CommerceOrder.js`.
- Payment orchestration and attempts: `backend/services/commerce/paymentOrchestrator.js`, `paymentAttemptRepository.js`, `backend/models/PaymentAttempt.js`.
- Manual PromptPay integration: `customerManualPromptPayCheckoutService.js`, `manualPaymentApplicationService.js`, `providers/manualPromptPayAdapter.js`, `backend/routes/commerceManualPaymentRoutes.js`.
- Wallet Commerce integration: `backend/services/commerce/customerWalletCheckoutService.js`, `backend/services/walletService.js`.
- Recovery: `backend/services/commerce/commercePaymentRecoveryService.js`, `frontend/js/payment/pending-payment-recovery.js`.
- Legacy/Commerce merged order projection: `backend/routes/order.js`.
- Catalog and publication: `backend/services/catalogService.js`, `catalogAdminService.js`, `backend/routes/catalog.js`.
- Pricing owner workspace: `backend/services/commerce/adminPricingEngineService.js`, `adminPricingControlCenterService.js`, `frontend/js/admin-pricing-engine.js`.
- RBAC: `backend/services/adminAuthorizationService.js`.
- Public/Admin design foundations: `frontend/css/theme/aziel-design-system.css`, `frontend/css/admin/admin-design-system.css`.
- Website/configuration observation: `backend/services/websiteRuntimeService.js`, `backend/configuration/`, `backend/routes/configurationRegistry.js`.

## Appendix B: Decision Rule for Future Work

Before any future feature is approved, answer five questions:

1. Which domain owns the fact being changed?
2. Which existing application service is the only permitted writer?
3. Which immutable snapshot preserves the historical result?
4. Which customer-safe and owner-safe projections expose it?
5. Which executable verifier proves that no competing authority was introduced?

If any answer is unclear, architecture clarification precedes implementation.
