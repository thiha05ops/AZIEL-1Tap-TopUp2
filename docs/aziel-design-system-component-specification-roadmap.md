# AZIEL Design System

## Component Specification Roadmap

**Status:** Planning baseline  
**Inputs:** Frozen Foundation and frozen Component Inventory  
**Scope:** Order and dependency model for future component specifications  
**Excludes:** Component redesign, implementation code, and page construction

---

## 1. Roadmap principles

Component specifications should be written from the most reusable dependencies outward.

The roadmap follows these rules:

1. Specify shared interaction and state contracts before composed components.
2. Specify generic structures before commerce and operational specializations.
3. Specify customer commerce before administrative projections of the same concepts.
4. Reuse shared specifications instead of reproducing behavior inside domain components.
5. Delay specialized tools until their controls, feedback, overlays, and data-display dependencies are stable.
6. Retire legacy patterns only after their approved replacements are specified.

### 1.1 Complexity scale

- **Low:** Small API and state surface; few dependencies.
- **Medium:** Multiple variants, responsive behavior, or accessibility states.
- **High:** Composed behavior, asynchronous state, domain semantics, or several integrations.
- **Very High:** Workflow orchestration, financial consequences, complex responsive behavior, or multiple domain projections.

Complexity estimates describe specification effort, not implementation duration.

---

## 2. Dependency sequence

```text
Phase 1 — Interaction Primitives
  ├── Phase 2 — Form System
  ├── Phase 3 — Status & Feedback
  └── Phase 4 — Navigation & Selection
          └── Phase 5 — Overlays & Transient Surfaces
                  ├── Phase 6 — Content & Discovery
                  └── Phase 7 — Commerce Objects
                          └── Phase 8 — Checkout & Payment
                                  └── Phase 9 — Customer Operations
                                          └── Phase 10 — Admin Composition
                                                  └── Phase 11 — Admin Domains
                                                          └── Phase 12 — Design Studio

All replacement specifications
  └── Phase 13 — Legacy Retirement
```

Phases may overlap only when the consuming phase does not need to redefine an unfinished dependency.

---

## 3. Phase roadmap

## Phase 1 — Interaction Primitives

### Components included

- Primary Button
- Secondary Button
- Destructive Button
- Icon Button
- Link Action
- Button Group
- Copy Control
- Toggle/Switch
- Checkbox
- Radio/Choice Control

### Why this phase comes first

These components establish the shared interaction vocabulary used by forms, dialogs, navigation, commerce selection, account actions, and admin commands. Every later phase depends on consistent action priority, focus, disabled state, loading state, and accessible naming.

### Dependencies

- Frozen Foundation principles for color, typography, spacing, motion, interaction, and accessibility.
- No component dependencies.

### Estimated implementation complexity

**Medium.** Individual controls are small, but the combined state, keyboard, touch, destructive-action, and priority contracts require careful alignment.

### Specification exit condition

Action hierarchy and interactive states can be referenced without later specifications inventing local button or choice behavior.

---

## Phase 2 — Form System

### Components included

- Form Field
- Text Input
- Numeric Input
- Password Input
- Textarea
- Select
- Combobox/Autocomplete
- Search Field
- OTP/PIN Input
- Date/Time Control
- File Upload Control
- Validation Message
- Form Section

### Why this phase comes first

Forms power authentication, checkout, payment evidence, account security, support, catalog administration, pricing, campaigns, and Design Studio properties. A shared field anatomy must exist before complex workflows are specified.

### Dependencies

- Phase 1 buttons, icon buttons, choice controls, toggles, and copy behavior.
- Foundation accessibility and normative language.

### Estimated implementation complexity

**High.** Validation, help text, required state, asynchronous lookup, monetary input, file lifecycle, keyboard operation, and multilingual labels produce a broad specification surface.

### Specification exit condition

All future workflows can compose controls through one label, help, validation, loading, read-only, and disabled-state model.

---

## Phase 3 — Status, Feedback & Terminal States

### Components included

- Status Badge
- Tag
- Counter Badge
- Alert Banner
- Inline Notice
- Toast
- Live Popup
- Spinner
- Loading Overlay
- Skeleton
- Empty State
- Error State
- Success State
- Offline State
- Validation Message alignment with the Form System

### Why this phase comes first

Every asynchronous or stateful component requires consistent feedback. Status semantics and terminal states must be stable before order, payment, wallet, support, or administrative workflows are specified.

### Dependencies

- Phase 1 actions for retry, dismiss, and recovery.
- Phase 2 validation contract for field and form errors.
- Foundation commerce status domains and accessibility rules.

### Estimated implementation complexity

**High.** The visual structures are moderate, but semantic severity, live-region behavior, persistence, blocking rules, and domain-neutral status presentation are consequential.

### Specification exit condition

Later phases can describe loading, empty, error, success, warning, and status outcomes without creating custom state components.

---

## Phase 4 — Navigation, Selection & Collection Controls

### Components included

- Tabs
- Filter Bar
- Filter Chip
- Segmented Action
- Dropdown Menu
- Accordion
- Pagination
- Breadcrumb
- Stepper/Progress Steps
- Search Result behavior

### Why this phase comes first

These components organize content and collections across customer and admin experiences. They must be established before product discovery, account sections, queue workspaces, and complex editors.

### Dependencies

- Phase 1 buttons, icon buttons, choice controls, and links.
- Phase 2 search, select, and combobox controls.
- Phase 3 count, loading, empty, and error states.

### Estimated implementation complexity

**High.** Keyboard navigation, selection semantics, URL state, filtering, pagination, responsive overflow, and asynchronous results must remain consistent.

### Specification exit condition

Collections and peer views can share one navigation and filtering model across public, customer, and admin contexts.

---

## Phase 5 — Overlays & Transient Surfaces

### Components included

- Modal Dialog
- Confirmation Dialog
- Bottom Sheet
- Detail Drawer/Panel
- Media Preview
- Locale Modal consolidation
- Recovery Overlay shell behavior
- Live Chat panel shell behavior

### Why this phase comes first

Payment, receipt upload, refunds, security, admin editors, media inspection, and mobile workflows all depend on focused transient surfaces. Shell behavior must be specified before domain content is placed inside it.

### Dependencies

- Phase 1 action hierarchy and close controls.
- Phase 2 forms.
- Phase 3 feedback and loading states.
- Phase 4 focusable navigation where tabs or collections appear inside overlays.

### Estimated implementation complexity

**Very High.** Focus management, dismissal, blocking versus non-blocking behavior, stacking, responsive transformation, scroll containment, and destructive confirmation affect the entire application.

### Specification exit condition

Future workflows can select an approved modal, sheet, drawer, or preview pattern without defining a new overlay shell.

---

## Phase 6 — Content, Navigation Chrome & Discovery

### Components included

- Public Header
- Primary Navigation
- Mobile Navigation Drawer
- Brand Lockup
- Account/Profile Menu
- Wallet Header Indicator
- Notification Header Control
- Locale Selector
- Footer
- Hero
- Section Header
- Content Header
- Content Navigation
- CTA Section
- Trust Indicator
- FAQ Item
- Policy Section
- Contact Method Item
- Feature/Benefit Item
- Statistic Highlight marketing variant
- Product Grid
- Category Item

### Why this phase comes first

This phase establishes shared public composition after controls and overlays are stable. It removes generic card usage from informational content and prepares consistent discovery structures for commerce objects.

### Dependencies

- Phases 1–5.
- Foundation card definition, imagery rules, typography, and layout principles.

### Estimated implementation complexity

**High.** Global chrome, responsive navigation, search entry, account state, managed content, and varied informational surfaces require broad coordination.

### Specification exit condition

Public pages can share one chrome and content-composition vocabulary without page-specific navigation, hero, footer, or informational-card systems.

---

## Phase 7 — Commerce Discovery & Value Objects

### Components included

- Product/Game Item
- Search Result Item consolidation
- Category Item commerce variant
- Game Identity Hero
- Package Selector
- Package Item
- Price Breakdown
- Promotion Code Field
- Payment Method Selector
- Payment Method Item
- Bank Launcher Chip
- Commerce Trust Note
- Promotional Banner/Carousel
- Promotion Metadata

### Why this phase comes first

These components represent what customers evaluate and select before payment. Their identity, imagery, price, discount, currency, selection, availability, and promotion contracts must be stable before checkout orchestration is specified.

### Dependencies

- Phase 1 selection and action controls.
- Phase 2 inputs and validation.
- Phase 3 status and feedback.
- Phase 4 collection controls.
- Phase 6 discovery layouts, imagery, and content hierarchy.
- Foundation Commerce Rules.

### Estimated implementation complexity

**Very High.** Commerce semantics, product artwork, responsive comparison, pricing authority, promotions, availability, and selection states must remain accurate across many games and regions.

### Specification exit condition

All storefront surfaces can present products, packages, promotions, and payment methods through consistent commerce objects.

---

## Phase 8 — Checkout, Payment & Recovery Workflows

### Components included

- Customer Account Form
- Checkout Step
- Order Summary
- Payment Confirmation Modal
- Payment Checkout Sheet
- Dynamic QR Panel
- Payment Countdown
- Receipt Uploader
- Payment Instructions
- Payment Success Dialog
- Order Processing Overlay
- Recovery Overlay domain behavior

### Why this phase comes first

Checkout composes nearly every earlier phase and carries the greatest financial and recovery risk. It should be specified only after controls, forms, status semantics, overlays, and commerce objects are authoritative.

### Dependencies

- Phases 1–7.
- Foundation final-payable, currency, payment-evidence, status-domain, trust, and accessibility rules.

### Estimated implementation complexity

**Very High.** The specification must cover multiple payment methods, QR expiry, evidence submission, duplicate prevention, asynchronous orchestration, recovery, mobile behavior, and accurate state transitions.

### Specification exit condition

Payment workflows can compose one consistent checkout architecture while retaining provider-specific instructions and capabilities.

---

## Phase 9 — Customer Operations & Service History

### Components included

- Account Sidebar
- Profile Summary
- Account Statistic
- Wallet Balance Summary
- Quick Amount Selector
- Wallet Transaction Item
- Wallet History List
- Order Item
- Order List
- Order Detail
- Order Status Summary
- Order Timeline
- Refund Request Form
- Refund Status Panel
- Notification Item
- Notification Filter consolidation
- Support Category Item
- Support Form
- Support Ticket Item
- Support Ticket Detail
- Chat Message
- Typing Indicator
- Live Chat Launcher/Panel domain behavior
- Security Session Item
- Security Event Item
- Two-Factor Setup Flow
- Recovery Code List

### Why this phase comes first

Customer operations project the outcomes created by checkout, payment, fulfilment, support, and security. They depend on stable commerce state and shared collection patterns but should be specified before admin views so customer truth remains the primary reference.

### Dependencies

- Phases 1–8.
- Commerce status domains and audience-safe projection principles.

### Estimated implementation complexity

**Very High.** This phase spans financial history, realtime state, support conversations, refunds, security, responsive detail, privacy, and customer-safe messaging.

### Specification exit condition

Customer-facing account, wallet, order, notification, support, and security information follows one coherent object and state model.

---

## Phase 10 — Admin Shell & Operational Composition

### Components included

- Admin Application Shell
- Admin Entry Shell
- Admin Sidebar Navigation
- Top Bar admin variant
- Admin Section Header
- Admin Workspace Tabs
- Admin Filter Toolbar
- Admin Queue Row
- Admin Split Workspace
- Admin Detail Section
- Admin Key/Value Row
- Admin Data Table
- Admin Row Actions
- Admin Action Modal
- Admin Status Indicator
- Admin KPI
- Admin Attention Item
- Admin Activity Item
- Admin Empty/Loading/Error State
- Admin Date/Range Selector
- Draft/Save State

### Why this phase comes first

Admin domain tools repeatedly implement the same queue, detail, table, filter, action, and state structures. These shared operational compositions must be specified before catalog, pricing, payments, fulfilment, or security modules are addressed.

### Dependencies

- Phases 1–5 for controls, forms, feedback, navigation, and overlays.
- Phase 9 customer and commerce object semantics where admin views project the same entities.

### Estimated implementation complexity

**Very High.** Dense responsive workspaces, keyboard operation, pagination, selection, deep links, live updates, and consequential commands require a strong shared contract.

### Specification exit condition

Every admin module can be composed from one shell, collection, detail, table, action, and state vocabulary.

---

## Phase 11 — Admin Commerce & Operational Domains

### Components included

#### Orders, wallet, and customers

- Manual Review Workspace
- Payment Evidence Viewer
- Business Snapshot
- Wallet Top-up Review
- Customer Workspace
- Customer Tag Editor
- Admin Order Detail variants

#### Dashboard

- Dashboard Chart
- Dashboard operational KPI and attention variants

#### Catalog, media, placement, campaign, and promotion

- Catalog Product Row
- Catalog Product Editor
- Package Table
- Package Editor
- Media Selector
- Media Library Item
- Media Upload Modal
- Banner Item
- Banner Editor
- Site Placement Editor
- Campaign Item
- Campaign Editor
- Promotion Item
- Promotion Editor

#### Pricing and payment infrastructure

- Pricing Workspace
- Pricing Status Chip semantic variant
- Regional Pricing Editor
- Payment Infrastructure Rail
- Payment Method Editor
- Provider Credential State
- Payment Diagnostic Item
- Deep-Link Tester

#### Fulfilment, security, and configuration

- Supplier Item
- Supplier Editor
- Fulfilment Mapping Item
- Fulfilment Attempt Item
- Admin Account Item
- Admin Session Item
- Audit Event Item
- Configuration Registry Item

### Why this phase comes first

These are domain specializations of the shared admin composition layer. Defining them earlier would force each module to invent its own tables, editors, detail sections, statuses, and feedback.

### Dependencies

- Phase 7 commerce objects and monetary semantics.
- Phase 8 payment and evidence semantics.
- Phase 9 customer operations.
- Phase 10 admin composition.

### Estimated implementation complexity

**Very High.** The phase contains many specialized specifications with financial, operational, security, and configuration consequences. It should be delivered as domain workstreams after shared contracts are frozen.

### Specification exit condition

Every current Admin OS domain has a specification that extends shared operational components without redefining them.

---

## Phase 12 — Design Studio Tooling

### Components included

- Studio Shell
- Studio Toolbar
- Tool Button
- Canvas
- Layer Item
- Layer Tree
- Properties Panel
- Inspector Section
- Canvas Status Bar
- Inline Text Editor
- Preset Item
- Design Studio Draft/Save State

### Why this phase comes first

Design Studio is a specialized application with unique direct-manipulation behavior, but it still consumes shared controls, forms, feedback, overlays, admin chrome, and save-state semantics. It should be specified after those dependencies.

### Dependencies

- Phases 1–5.
- Phase 10 admin composition and draft/save state.
- Phase 11 Media Selector where Studio consumes managed assets.

### Estimated implementation complexity

**Very High.** Canvas interaction, selection, hierarchy, editing tools, keyboard commands, direct manipulation, and responsive constraints require a dedicated specification workstream.

### Specification exit condition

Studio-specific behaviors are documented without creating alternate versions of shared controls and operational feedback.

---

## Phase 13 — Legacy Retirement & Convergence

### Components included

- Legacy Public Topbar
- Legacy Shop Hero and Game Cards
- Legacy Admin Shell
- Legacy Admin Order Card/Modal
- Legacy Legal Info Card
- Legacy Auth Layout
- Payment Mock Shell classification
- Bottom Navigation retirement
- Duplicate standalone admin shells
- Duplicate footer, auth, policy, and payment-modal implementations

### Why this phase comes last

Legacy components should not be removed until their target component specifications exist. Retirement is a convergence activity, not a source of new design rules.

### Dependencies

- Approved replacement specifications from Phases 1–12.
- Confirmed route and product ownership outside the design-system specification process.

### Estimated implementation complexity

**High.** Specification effort is moderate, but identifying compatibility, migration boundaries, and non-UI utility pages requires careful product and engineering coordination.

### Specification exit condition

Every legacy component is mapped to an approved replacement, explicitly retained as a non-component utility, or formally removed from design-system scope.

---

## 4. Recommended specification workstreams

Once Phases 1–5 are stable, later work may proceed through coordinated workstreams:

- **Public Commerce:** Phases 6–8.
- **Customer Operations:** Phase 9.
- **Admin Platform:** Phase 10.
- **Admin Domains:** Phase 11, separated into Orders/Wallet, Catalog/Content, Pricing/Payments, and Fulfilment/Security.
- **Design Studio:** Phase 12.

Workstreams must consume shared specifications and must not create local substitutes for unfinished dependencies.

---

## 5. Specification completion standard

A component specification is ready for downstream implementation planning when it defines:

- Purpose and permitted use.
- Anatomy and content responsibilities.
- Variants with clear semantic reasons.
- Interaction and keyboard behavior.
- Complete state model.
- Responsive behavior.
- Accessibility requirements.
- Content and localization considerations appropriate to v1.0.
- Dependencies and composition rules.
- Prohibited uses.
- Migration mapping from inventory patterns where applicable.

This completion standard defines documentation readiness only. It does not authorize implementation or page redesign.

---

## 6. Roadmap outcome

The optimal sequence begins with universal interaction, form, state, navigation, and overlay contracts. It then moves through public composition and commerce objects into checkout, customer operations, admin composition, specialized admin domains, and Design Studio.

This order minimizes duplicated specification work and prevents specialized workflows from defining the shared system backward. Legacy retirement closes the roadmap only after every replacement has an approved specification.
