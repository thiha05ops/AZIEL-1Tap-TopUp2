# AZIEL Design System

## Official Component Inventory

**Status:** Audit baseline  
**Scope:** Existing public, customer, commerce, support, account, administrative, and Design Studio frontend  
**Foundation:** Frozen; not modified by this inventory  
**Purpose:** Identify, consolidate, and disposition the reusable UI patterns that must guide future component redesign

---

## 1. Inventory rules

This is an inventory of existing behavior and presentation patterns. It is not a redesign specification.

Components are grouped by shared purpose even when the repository currently uses different names, markup, styles, or runtime renderers. A component family may therefore represent several duplicate implementations.

Disposition meanings:

- **Keep:** The component has a clear durable role and is broadly coherent.
- **Improve:** Keep the role, but redesign or standardize its variants and behavior.
- **Merge:** Consolidate duplicate implementations into one future component family.
- **Remove:** Retire the pattern because it is obsolete, redundant, misleading, or conflicts with the Foundation.

### 1.1 Surface groups

- **Global Public:** Shared header, footer, locale, search, theme, notifications, chat, and system feedback.
- **Home:** `home.html`.
- **Catalog:** `mobile-games.html`, `pc-games.html`, `gift-cards.html`, `social-topup.html`, `coming-soon.html`.
- **Game Commerce:** `mlbb.html`, `freefire.html`, `genshin.html`, `hok.html`, `pubg.html`, `pubg-rp.html`, `roblox.html`, `telegram.html`, `aov-id.html`.
- **Customer:** `account.html`, `wallet.html`, `tracking.html`, `notifications.html`.
- **Auth:** `login.html`, `register.html`, `forgot-password.html`, `reset-password.html`, `reset.html`, `verify-email.html`, `verify-otp.html`.
- **Support & Content:** `support.html`, `live-chat.html`, `faq.html`, `help.html`, `about.html`, `contact.html`, `policies/payment.html`, `policies/privacy.html`, `policies/refund.html`, `policies/support.html`, `policies/terms.html`, `explore.html`, `offline.html`.
- **Admin OS:** `admin.html` and its dynamically rendered workspaces.
- **Admin Standalone:** `admin-login.html`, `admin-support.html`, `admin-live-chat.html`, `admin-wallet.html`, `admin-settings.html`.
- **Design Studio:** `admin-design-studio.html`.
- **Legacy:** `old-shop.html`, `old-admin-orders.html`, `old-terms.html`, `privacy.html`, `refund.html`, `payment-mock.html` and `google-success.html` where superseded.

---

## 2. Global navigation and application chrome

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Public Header | Global brand, navigation, account, wallet, search, locale, and notifications entry | Global Public; loaded from `components/header.html` by most current public pages | Desktop header; mobile header; authenticated; guest; compact game-page context | Duplicate style loading; legacy pages use independent topbars; nav contents are partly static and partly runtime-generated; different height and spacing systems | **Improve** |
| Brand Lockup | Identify AZIEL and provide home navigation | Public Header, Auth, Admin OS, Admin Login, Design Studio, Explore | Image logo; text logo; logo mark with wordmark; admin fallback mark | Multiple logo compositions, proportions, fallback marks, and type treatments | **Merge** |
| Primary Navigation | Move among storefront destinations | Public Header, Explore header, legacy shop topbar | Desktop link row; mobile menu; storefront-section-driven game navigation | Current and legacy navigation coexist; active-state and information architecture vary | **Merge** |
| Mobile Navigation Drawer | Expose primary navigation on small screens | Public Header; Admin OS has a separate drawer | Public drawer; admin sidebar drawer | Different overlay, close, focus, and body-lock behavior; no shared drawer contract | **Merge** |
| Admin Sidebar Navigation | Navigate Admin OS workspaces | Admin OS; older version in Admin Settings and Legacy Admin Orders | Expanded; collapsed; mobile drawer; grouped items; searchable | Current OS, standalone admin, and legacy sidebars use different structures and labels | **Improve** |
| Top Bar | Show page context and global actions | Admin OS, Admin Settings, Help, Legacy Shop, Legacy Admin Orders | Public utility topbar; admin topbar; standalone admin header | Several unrelated patterns share the same conceptual role; action alignment and responsive behavior differ | **Merge** |
| Breadcrumb | Show hierarchy and return path | Catalog, policy/legacy content, Admin Catalog and editors | Public catalog breadcrumb; back button; admin editor breadcrumb | Back buttons substitute for breadcrumbs; labels and icon treatment vary | **Merge** |
| Account/Profile Menu | Access customer account actions | Public Header, Account | Avatar button; dropdown; full account sidebar | Dropdown and sidebar duplicate navigation; identity formatting and logout placement vary | **Improve** |
| Wallet Header Indicator | Show balance and open Wallet | Public Header, Account, Wallet | Balance pill; wallet card summary; admin balance displays | Currency and loading treatment differ; pill competes with primary navigation on small screens | **Improve** |
| Notification Header Control | Show unread count and recent notifications | Public Header, Notifications, realtime runtime | Icon button; unread badge; dropdown; live popup | Badge implementations and update paths are duplicated; dropdown and page item status differ | **Merge** |
| Locale Selector | Change language and regional presentation | Public Header, Home locale modal, Admin OS locale select | Header trigger; modal; admin select | Language and region are partially conflated; modal and select use different controls and labels | **Merge** |
| Footer | Provide trust, policy, payment, and company navigation | Home, Catalog, FAQ, About, Contact, current policy pages | Full site footer; trust footer; game mini-footer; Explore footer | Four footer families with different navigation, payment logos, spacing, and mobile behavior | **Merge** |
| Bottom Navigation | Persistent mobile shortcuts | Payment Mock; traces in shared component styles | Mobile commerce nav | Not consistently present on current pages and appears legacy | **Remove** |

---

## 3. Actions and controls

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Primary Button | Trigger the principal action | All public workflows, Auth, Game Commerce, Wallet, Support, Admin OS | Filled brand; commerce CTA; submit; confirm; save | Many class names and dimensions; gradients versus flat fills; loading behavior varies | **Merge** |
| Secondary Button | Trigger a lower-priority action | Global Public, Account, Support, Admin OS, modals | Outline; neutral filled; ghost; text button | Secondary, outline, ghost, and light buttons lack consistent priority | **Merge** |
| Destructive Button | Confirm destructive or rejecting action | Account security, refunds, Admin Orders, Admin Wallet, Admin Security | Delete; reject; disable; logout; cancel | Danger treatment sometimes represents ordinary cancellation; confirmation requirements vary | **Improve** |
| Icon Button | Provide a compact labeled action | Header, dialogs, admin toolbars, Design Studio, payment controls | Standard; circular; close; refresh; menu; visibility toggle | Target sizes, accessible labels, borders, and hover behavior vary | **Merge** |
| Link Action | Provide low-emphasis navigation or inline action | Auth, policies, order states, support, empty states | Inline link; back link; “view all”; action link | Some links are styled as buttons and some buttons navigate; focus/visited treatment varies | **Improve** |
| Button Group | Present related actions | Modals, Admin editors, payment confirmation, success states | Horizontal; stacked mobile; primary/destructive pair; toolbar | Ordering and responsive stacking vary; destructive action placement is inconsistent | **Improve** |
| Segmented Action | Select one option from a small exclusive set | Wallet quick amounts, Admin filters, Design Studio tools | Text segments; icon segments; amount buttons | Often implemented as tabs, chips, or buttons without consistent selection semantics | **Merge** |
| Toggle/Switch | Change a binary setting | Admin Settings, payment methods, catalog controls, account/security | Standard switch; checkbox-like row; enabled badge plus action | State labeling and disabled/read-only behavior vary | **Merge** |
| Checkbox | Select independent options or acknowledgements | Auth, payment checklist, Admin editors, Security | Native checkbox; styled check row; checklist item | Inconsistent hit area and label arrangement; checklist completion can resemble settings | **Improve** |
| Radio/Choice Control | Select one exclusive option | Payment methods, region, package and settings forms | Native radio; selectable card; row choice | Selection is frequently encoded only by card styling | **Merge** |
| File Upload Control | Upload receipts, product media, banners, and support attachments | Checkout sheet, Wallet, Support, Admin Media, Catalog, Campaigns, Design Studio | Drop zone; file input; image selector; receipt uploader | Validation, preview, progress, replacement, and error states are independently implemented | **Merge** |
| Copy Control | Copy order references, payment details, recovery codes, and deep links | Payment sheet, Account 2FA, Admin Payments, Tracking | Icon button; text button; field suffix | Confirmation feedback and truncation differ | **Merge** |

---

## 4. Form components

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Text Input | Collect short text | Auth, Game Commerce, Account, Support, Admin OS, Design Studio | Standard; compact admin; prefixed; suffixed; read-only | Multiple visual systems; labels, required indicators, and errors are not standardized | **Merge** |
| Numeric Input | Collect quantity, price, exchange rate, priority, and configuration values | Game Commerce, Wallet, Admin Pricing, Catalog, Payments, Design Studio | Currency; integer; decimal; stepper-like; inline table input | Precision, alignment, validation, and unit presentation vary | **Improve** |
| Password Input | Collect credentials securely | Auth, Account Security, Admin Login | Password field with eye toggle; current/new/confirm group | Visibility controls and strength/help feedback differ between auth generations | **Merge** |
| Textarea | Collect notes, support messages, policy/configuration content | Support, refund, Admin Orders, Admin Catalog, Campaigns, Design Studio | Standard; compact; code/content field | Character limits and resizing behavior are inconsistent | **Improve** |
| Select | Choose from a defined list | Game region/server, Wallet, Support, Admin OS, Design Studio | Native select; compact admin; dependent select | Styling, placeholder behavior, and empty/loading options vary | **Merge** |
| Combobox/Autocomplete | Search and select from large data sets | Header search, Admin navigation search, Catalog/product selectors, Fulfilment mapping | Search overlay; filtered list; searchable select | Keyboard behavior and result semantics differ; some are plain filtered inputs | **Merge** |
| Search Field | Find products, orders, users, tickets, media, and settings | Header, Catalog, Tracking, Admin Orders, Users, Support, Media, Security | Global overlay; inline field; search with submit; debounced admin filter | Clear action, submit behavior, loading state, and result count vary | **Merge** |
| Form Field | Bind label, control, help, required state, and validation | All forms | Vertical; inline; compact; composite | No shared field anatomy; messages and required markers differ | **Merge** |
| Form Section | Group related fields under a heading | Account, Support, Admin editors, Settings, Design Studio | Full-width section; bordered group; collapsible panel | Frequently implemented as generic cards, conflicting with the Foundation | **Merge** |
| Validation Message | Explain invalid or accepted input | Auth, Support, payment, Wallet, admin forms | Inline error; form banner; success text; toast-only error | Some errors are remote from the field; color and wording vary | **Merge** |
| OTP/PIN Input | Enter verification codes | Verify OTP, email verification, 2FA | Single text input; recovery code presentation | OTP entry does not have a consistent multi-character, paste, and resend pattern | **Improve** |
| Date/Time Control | Configure campaign, promotion, banner, and audit ranges | Admin Promos, Campaigns, Home Banners, Dashboard, Audit | Date/time inputs; range filter; expiry display | Time zone, locale, and validation presentation vary | **Improve** |

---

## 5. Selection, navigation, and filtering

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Tabs | Switch peer views without leaving context | Account, Support tickets, Notifications, Admin Orders, Wallet, Catalog, Security, Payments, Design Studio | Underline; pill; queue tab; command tab; vertical tab | Many distinct tab styles; URL/hash ownership and keyboard behavior vary | **Merge** |
| Filter Bar | Narrow a data set | Notifications, Admin Orders, Users, Wallet, Support, Audit, Media | Chips; selects; search plus filters; date range | Applied state and reset behavior are inconsistent | **Merge** |
| Filter Chip | Toggle a compact filter | Notifications, payment bank choices, Admin status filters | Standard chip; bank launcher chip; status chip | Chips are also used as status badges and action buttons | **Merge** |
| Dropdown Menu | Reveal actions or choices | Header profile, game navigation, Design Studio, admin rows | Navigation dropdown; action menu; select-like menu | Positioning, dismissal, keyboard navigation, and layering vary | **Merge** |
| Pagination | Traverse large collections | Admin Orders, Users, Wallet transactions, Support, Audit, Fulfilment | Load more; cursor pagination; numbered legacy controls; previous/next | Several paging models; loading and end-of-list feedback differ | **Merge** |
| Stepper/Progress Steps | Communicate sequence or progress | Game Commerce, Payment, Tracking, refund flow, Auth verification | Numbered checkout steps; order timeline; progress timeline | Transaction progress and instructional steps share similar visuals despite different semantics | **Merge** |
| Accordion | Reveal optional content | FAQ, Support FAQ, admin configuration groups | FAQ item; collapsible editor section | Different indicator and expanded-state behavior; some sections lack button semantics | **Merge** |

---

## 6. Feedback, state, and messaging

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Status Badge | Communicate concise state | Orders, payments, wallet, support, users, security, pricing, fulfilment | Success; warning; danger; info; neutral; live | Domain meaning is often collapsed into generic colors; badge and chip styles overlap | **Merge** |
| Tag | Describe non-status metadata | Games, users, wallet, media, supplier/configuration records | Game tag; region tag; customer tag; capability tag | Tags and statuses use the same appearance; removable and static tags are not distinguished | **Merge** |
| Counter Badge | Show unread or numeric count | Header notifications, chat, admin nav | Dot; numeric badge; bump animation | Sizing and zero/overflow behavior differ | **Merge** |
| Alert Banner | Present contextual information or risk | Auth, payment, Wallet, Support, Admin diagnostics, offline | Info; success; warning; error; maintenance | Alerts, form messages, and notices use unrelated structures | **Merge** |
| Inline Notice | Explain local constraints or next steps | Checkout, recovery, tracking, policies, Admin editors | Safe note; helper; warning row; configuration note | Importance and icon usage are inconsistent | **Merge** |
| Toast | Confirm transient outcomes | Public shared UI, Account, Wallet, Support, Admin OS | Success; info; warning; error | Multiple runtimes (`ui-feedback`, account, wallet, admin, support); durations and stacking vary | **Merge** |
| Live Popup | Announce realtime activity | Tracking, Notifications, Support, Admin live updates | Order status popup; notification popup; support popup; admin popup | Duplicates toast behavior and uses inconsistent urgency | **Merge** |
| Loading Overlay | Block a workflow while processing | Game Commerce, Payment Mock, Wallet, Admin editors | Page overlay; order overlay; modal loading; button loading | Blocking criteria and cancellation differ; some overlays duplicate spinners | **Merge** |
| Spinner | Indicate indeterminate progress | Shared UI, buttons, Design Studio, admin workspaces | Inline; button; page; overlay | Several visual implementations and no unified size vocabulary | **Merge** |
| Skeleton | Preserve layout during loading | Notifications, Support, Admin Dashboard, Users, Fulfilment | Card skeleton; row skeleton; dashboard skeleton | Some surfaces use blank “Loading…” text or spinners instead | **Merge** |
| Empty State | Explain no content and possible next action | Catalog, Notifications, Support, Tracking, Account, all admin workspaces | Simple text; icon/title/body/action; filtered-empty | Many local renderers; actionable and non-actionable empty states are inconsistent | **Merge** |
| Error State | Explain failed loading or unavailable content | Catalog, Tracking, Notifications, Support, Wallet, admin workspaces | Inline text; full panel; retry action; toast-only | Retry is inconsistent and some errors replace useful content unnecessarily | **Merge** |
| Success State | Confirm completed workflows | Auth verification, checkout, Wallet, Support, Admin actions | Modal; page state; inline message; toast | Success can be overrepresented by both modal and toast; next steps vary | **Merge** |
| Offline State | Explain loss of network availability | `offline.html`, PWA runtime | Dedicated page; inline network error | Dedicated offline presentation is disconnected from recoverable request errors | **Improve** |

---

## 7. Overlays and transient surfaces

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Modal Dialog | Require focused review or action | Account, Wallet, Tracking refund, Admin OS, Admin Security, Catalog editors, media, promotions | Confirmation; form; detail; destructive; success | Many independent shells, close controls, widths, focus behavior, and mobile layouts | **Merge** |
| Bottom Sheet | Present mobile-first checkout or recovery workflows | Payment checkout sheet, pending-payment recovery | Checkout sheet; recovered payment sheet; bank chooser | Sheet behavior is specialized but overlaps modal markup and styles | **Improve** |
| Confirmation Dialog | Confirm consequential action | Payment, refunds, Admin Orders, Wallet, Security | Payment confirmation; destructive confirmation; generic admin action | Native confirm, custom modal, and specialized confirmation coexist | **Merge** |
| Detail Drawer/Panel | Inspect an item while retaining collection context | Admin Orders, Users, Wallet, Catalog, Design Studio | Split-pane detail; side panel; mobile drawer | Selection, close, responsive transition, and deep-link behavior differ | **Merge** |
| Media Preview | Inspect uploaded imagery or receipts | Wallet, Admin Orders, Admin Media, Catalog, Campaigns | Slip modal; image preview; media selector; QR preview | Image controls, captions, fallback, and zoom behavior vary | **Merge** |
| Locale Modal | Choose language/region | Home and header locale runtime | Centered modal | A specialized modal with its own action and close treatment | **Merge** into Modal Dialog |
| Recovery Overlay | Resume an incomplete payment | Home, Notifications, Game Commerce through PWA runtime | Payment-not-completed prompt; continuation state | Semantically important and reusable, but implemented outside the general dialog system | **Improve** |
| Live Chat Launcher/Panel | Open and conduct realtime support chat | Home, Game Commerce, Wallet, Support, standalone Live Chat | Floating launcher; embedded panel; full page | Three shells and duplicated unread/typing/message behavior | **Merge** |

---

## 8. Storefront discovery and marketing

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Hero | Establish page identity and primary proposition | Home, Catalog, Explore, FAQ, About, Contact, Support, Tracking | Artwork hero; compact text hero; trust hero; game hero; admin entry hero | Excessive family variation; some heroes are decorative containers rather than hierarchy | **Merge** |
| Promotional Banner/Carousel | Present managed campaigns and promotions | Home, Explore, campaign runtime | Banner carousel; static promo; campaign popup | Carousel controls, aspect ratios, overlays, and campaign popup are separate systems | **Improve** |
| Trust Indicator | Communicate safety, speed, payment, or support assurance | Home, Game Commerce, Auth, About, Admin Login | Trust row; trust card; trust box; assurance list; pill | Repeated claims use cards, boxes, pills, and inline rows inconsistently | **Merge** |
| Section Header | Introduce and optionally act on a content section | Home, Catalog, Explore, Account, Admin OS | Title/body/action; eyebrow/title; compact admin head | Typography and action alignment vary | **Merge** |
| Category Item | Navigate to a product category | Home, Catalog, Support | Category card; category link; support category card | Decorative cards and functional cards are mixed; artwork/icon ratios differ | **Merge** |
| Product/Game Item | Identify and open a game or product | Home, Mobile Games, PC Games, Gift Cards, Social Top-up, search results | Popular game card; featured card; poster card; list result | Separate aspect ratios, metadata order, hover behavior, and unavailable state | **Merge** |
| Product Grid | Arrange comparable product items | Home and Catalog | Featured grid; poster grid; game grid; dashboard grid | Different breakpoints and gaps; grid names encode page implementation | **Merge** |
| Search Result Item | Show a product found by global search | Header search and Home search runtime | Game result; no-result row | Not aligned with catalog product item anatomy | **Merge** into Product/Game Item |
| Feature/Benefit Item | Explain platform capabilities | Explore, About, Help, Support | Feature card; trust card; stat item; guide item | Many non-interactive cards conflict with the Foundation card definition | **Remove** card treatment; **Merge** content pattern |
| Statistic Highlight | Present promotional or trust metrics | Explore, legacy admin, account summary | Marketing stat; account stat; admin KPI | Marketing, personal, and operational metrics require distinct semantics despite similar visuals | **Improve** |
| CTA Section | Close a content journey with a clear action | Explore, About, Contact, policy/help surfaces | Full-width CTA; trust actions; inline action | Often wrapped as a decorative card or gradient panel | **Improve** |

---

## 9. Game commerce and checkout

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Game Identity Hero | Present game artwork, logo, region, and product context | All Game Commerce pages | Banner artwork; overlay; game tag; game info | Repeated static markup across nine pages; game-specific overrides and crops vary | **Merge** |
| Customer Account Form | Collect game account and server details | All Game Commerce pages | User ID only; user and zone; server select; custom fields | Field labels, validation, order, and game-specific instructions vary | **Merge** |
| Package Selector | Select a purchasable package | All Game Commerce pages | Desktop package grid; mobile package rows; selected-package preview | Desktop and mobile use separate renderings; pricing and promotion anatomy vary | **Merge** |
| Package Item | Present package quantity, bonus, price, promotion, and selection | All Game Commerce pages | Standard; active; unavailable; promoted; mobile row | Multiple markup paths and inconsistent hierarchy; card selection is not uniformly semantic | **Merge** |
| Promotion Code Field | Apply or remove a promotion | Game Commerce and checkout | Input plus apply; applied summary; remove action | Success/error placement and pricing refresh behavior vary | **Improve** |
| Payment Method Selector | Choose how to pay | Game Commerce and Wallet | Payment grid card; wallet payment card; disabled/unavailable; recommended | Duplicated builders in `payment.js`, `region-payment.js`, and `wallet.js` | **Merge** |
| Payment Method Item | Present method identity, capabilities, fees, and availability | Game Commerce, Wallet, Admin preview | Standard; PromptPay; deeplink; wallet; unavailable | Customer and admin previews differ; provider capability labels are inconsistent | **Merge** |
| Bank Launcher Chip | Choose a banking app | PromptPay/deeplink checkout and Admin Payments preview | Installed/available; generic bank; disabled | Implemented in multiple payment runtimes; chips mix selection and immediate action | **Merge** |
| Order Summary | Review product, package, account, discount, and final amount | Game Commerce, payment confirmation, Wallet | Sticky desktop; mobile summary; modal summary | Summary anatomy and price terminology vary; repeated static markup | **Merge** |
| Price Breakdown | Explain original price, discount, fees, and final payable | Game Commerce, Wallet, Admin detail | Summary lines; total row; business snapshot | Customer and admin data differ appropriately, but labels and amount alignment vary | **Improve** |
| Checkout Step | Establish numbered workflow order | Game Commerce | Account; package; payment; review | Visual steps are embedded inside form cards and not a shared component | **Merge** |
| Payment Confirmation Modal | Confirm order and payment before initiation | All Game Commerce pages | Standard confirmation; dynamic payment summary | Duplicated across nine HTML pages and separate redirect runtime | **Merge** |
| Payment Checkout Sheet | Complete wallet, PromptPay, deeplink, or manual payment | Game Commerce, Wallet, recovery | Wallet; dynamic PromptPay QR; bank chooser; manual receipt; recovered attempt | One sophisticated family but method-specific panels diverge in anatomy and action placement | **Improve** |
| Dynamic QR Panel | Present QR, amount, reference, expiry, and save/open actions | PromptPay checkout, Wallet, recovery | Active; expired; recovered; app-launch capable | QR display exists in customer and admin preview forms; countdown and expiry messages vary | **Merge** |
| Payment Countdown | Communicate QR or attempt expiry | Game Commerce payment modal, checkout sheet, recovery | Inline timer; warning timer; expired state | Multiple timer renderers and inconsistent urgency thresholds | **Merge** |
| Receipt Uploader | Collect payment evidence | Checkout sheet, Wallet manual top-up | Select; preview; replace; submitted | Duplicated validation and status language; upload versus submission distinction varies | **Merge** |
| Payment Instructions | Explain payment steps and trust requirements | Checkout sheet, game payment modal, Wallet | Numbered checklist; safe note; method instructions | Static and provider-driven instructions coexist; hierarchy differs by payment type | **Merge** |
| Payment Success Dialog | Confirm submission or completed checkout | Game Commerce, Wallet, Payment Mock | Order success; receipt submitted; wallet top-up submitted | “Submitted” and “paid” success semantics are not consistently distinguished | **Merge** |
| Order Processing Overlay | Prevent duplicate action during order creation | Game Commerce, Wallet, Payment Mock | Order loading; payment loading; submit loading | Same markup duplicated across page templates | **Merge** |
| Commerce Trust Note | Reinforce payment safety and next steps | Game Commerce, checkout sheet, Wallet | Safe note; trust box; payment assurance | Repeated decorative containers and inconsistent claims | **Merge** |

---

## 10. Customer account, wallet, and order components

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Account Sidebar | Navigate customer profile, wallet, orders, and security | Account | Desktop sidebar; mobile drawer | Duplicates header profile navigation; mobile behavior is bespoke | **Improve** |
| Profile Summary | Present avatar and customer identity | Account, Header | Compact menu identity; full profile; editable profile | Avatar fallback, verified state, and identity hierarchy vary | **Merge** |
| Account Statistic | Summarize orders, spending, wallet, or activity | Account | Stat tile; wallet card value | Some non-interactive metrics are implemented as cards | **Merge** content pattern |
| Security Session Item | Show and revoke authenticated sessions | Account Security, Admin Security | Customer session; admin session; current-session state | Two independent renderers with similar data and different actions | **Merge** |
| Security Event Item | Show account or admin audit activity | Account Security, Admin Security | Customer event; admin audit event | Timestamp, severity, actor, and metadata presentation differ | **Merge** |
| Two-Factor Setup Flow | Enrol, verify, recover, and disable 2FA | Account, Admin Security | QR setup; code entry; recovery codes; manage; disable confirmation | Customer and admin flows use separate dialogs and terminology | **Merge** |
| Recovery Code List | Present sensitive one-time recovery codes | Account and Admin Security | Initial display; regenerate; copied state | Copy/download/acknowledgement behavior is inconsistent | **Improve** |
| Wallet Balance Summary | Present balance and primary wallet action | Wallet, Account, Header, Admin customer detail | Hero balance; compact card; header pill; admin value | Several levels of prominence and inconsistent currency/loading behavior | **Merge** |
| Quick Amount Selector | Choose a wallet top-up amount | Wallet | Preset amount buttons; custom amount | Behaves like both segmented control and value shortcuts | **Improve** |
| Wallet Transaction Item | Present a balance-changing transaction | Wallet, Admin Wallet, Admin User detail | Customer history row; admin ledger row; recent transaction row | Sign, status, reference, and balance impact are formatted differently | **Merge** |
| Wallet History List | Display paged wallet activity | Wallet, Admin Wallet | Customer timeline/list; admin ledger/table | Different empty/loading/pagination patterns | **Merge** |
| Wallet Top-up Review | Inspect and act on submitted wallet funding evidence | Admin Wallet | Queue row; detail panel; evidence; review notes; actions | Similar to manual order review but implemented independently | **Merge** with Manual Review Workspace |
| Order Item | Present order identity, product, amount, and status | Account recent/history, Tracking recent orders, Notifications links, Admin Orders | Customer compact row; history card; queue row; admin summary | Status projections and information order vary across every surface | **Merge** |
| Order List | Display recent or historical orders | Account, Tracking, Admin Orders | Recent list; full history; admin queue | Loading and empty behavior differ; customer lists have independent renderers | **Merge** |
| Order Detail | Present complete order, payment, fulfilment, evidence, and actions | Tracking, Admin Orders, Account history expansion | Customer tracking card; admin split detail; legacy modal | No shared information architecture; customer and admin must retain distinct disclosure depth | **Improve** |
| Order Status Summary | Explain current customer-facing order state | Tracking, Account, Notifications | Header status; note; badge; live popup | Persisted and projected statuses are normalized differently across renderers | **Merge** |
| Order Timeline | Present chronological commerce progress | Tracking, Admin Orders, Admin Wallet | Customer progress steps; server event timeline; admin audit timeline | Instructional progress and event history are mixed; labels differ by domain | **Merge** |
| Refund Request Form | Collect and submit a customer refund request | Tracking | Modal form; blocked reason; submitted state | Standalone implementation; status and eligibility presentation are tightly coupled | **Improve** |
| Refund Status Panel | Explain refund lifecycle and next steps | Tracking, Admin Orders | Customer status box/timeline; admin financial actions | Status vocabulary differs and partial detail is unavailable | **Merge** semantic model, retain audience variants |

---

## 11. Notifications, support, and content

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Notification Item | Present notification content, state, metadata, and destination | Notifications page, Header dropdown, Account bell history | Standard; unread; promotion; order/payment; compact dropdown | Three renderers with different metadata and read-state behavior | **Merge** |
| Notification Filter | Filter notification category or read state | Notifications | Chip row; count labels | Separate from general filter pattern | **Merge** into Filter Bar |
| Promotion Metadata | Present campaign code, expiry, or action inside notification | Notifications and Home promotions | Code/action metadata; preview | Does not share promotion presentation rules with storefront promos | **Improve** |
| Support Category Item | Route customers to a support subject | Support | Icon card; contact item | Some are navigation cards and some are explanatory content | **Merge** |
| FAQ Item | Reveal question and answer | FAQ, Support | Full-page accordion; embedded FAQ | Duplicate accordion implementations and content sources | **Merge** |
| Support Form | Submit a support request | Support | Category-dependent fields; attachment; success/error | Uses local form and validation components | **Improve** |
| Support Ticket Item | Summarize a customer ticket | Support, Admin Support | Customer ticket card; admin queue card | Status, unread, priority, and message preview differ | **Merge** |
| Support Ticket Detail | Show conversation and allow reply | Support, Admin Support | Customer thread; admin workspace | Separate message anatomy and attachment handling | **Merge** |
| Chat Message | Present realtime conversation content | Live Chat, Support, Admin Live Chat | Customer; bot/system; admin; typing; timestamp | Standalone, embedded, and admin renderers differ | **Merge** |
| Typing Indicator | Indicate active response | Live Chat and Admin Live Chat | Customer-visible; admin-visible | Different animation and visibility behavior | **Merge** |
| Contact Method Item | Present support channel and action | Contact, Support, Explore | Telegram/social/contact row | Often uses non-interactive card styling even when informational | **Merge** |
| Policy Section | Organize legal and policy content | Current policy pages, legacy terms/privacy/refund | Current policy card; legacy info card; plain sections | Generic non-interactive “cards” conflict with Foundation; duplicate legacy pages | **Remove** card treatment; **Merge** content structure |
| Content Header | Present title, eyebrow, updated date, and summary | Policies, About, Contact, FAQ, Help | Policy header; trust hero; help hero | Multiple content-page header systems | **Merge** |
| Content Navigation | Navigate within or between informational pages | Policies, Help, FAQ, About/Contact | Back button; footer links; topic links | No consistent local navigation model | **Improve** |

---

## 12. Admin shell and shared operational components

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Admin Application Shell | Provide persistent operational navigation and workspace | Admin OS | Expanded/collapsed sidebar; mobile drawer; topbar; kernel status | Standalone admin pages retain older shells and should converge | **Improve** |
| Admin Entry Shell | Authenticate administrators and communicate security posture | Admin Login | Brand copy; login panel; assurance list; state message | Visually independent from customer auth by design, but field/message patterns are bespoke | **Improve** |
| Admin Section Header | Identify workspace and expose primary actions | Every Admin OS section | Eyebrow/title; pill; action row; range selector | Inconsistent hierarchy and action placement across modules | **Merge** |
| Admin Workspace Tabs | Switch operational queues or views | Orders, Wallet, Catalog, Pricing, Payments, Security, Fulfilment | Queue; command; section; vertical rail | Numerous module-specific tab systems | **Merge** |
| Admin Filter Toolbar | Search, filter, refresh, and scope operational data | Orders, Users, Wallet, Support, Media, Audit, Pricing | Inline filters; range controls; search and actions | Reset, active-filter visibility, and responsive wrapping vary | **Merge** |
| Admin Queue Row | Summarize an operational record for selection | Orders, Wallet, Support, Users, Media, Fulfilment | Dense row; card-like row; table row | Selection, status placement, metadata, and action affordance vary | **Merge** |
| Admin Split Workspace | Combine queue and selected detail | Orders, Wallet, Users, Catalog, Payments | Two-column; three-column; responsive drawer | Similar layout repeatedly implemented with module-specific classes | **Merge** |
| Admin Detail Section | Group labeled operational information | Orders, Wallet, Users, Payments | Label/value rows; business snapshot; evidence section | Several local helper functions render equivalent structures | **Merge** |
| Admin Key/Value Row | Present compact metadata | Nearly all admin detail views | Standard; monetary; code/reference; raw markup | Alignment and copy treatment vary | **Merge** |
| Admin Data Table | Compare structured operational data | Catalog packages, Pricing, Wallet ledger, Payments, Audit, Fulfilment mappings | Standard; editable; responsive; sticky columns | Multiple independent table systems; mobile behavior is inconsistent | **Merge** |
| Admin Row Actions | Act on a selected record | Orders, Wallet, Catalog, Users, Payments, Fulfilment | Inline buttons; overflow actions; footer action bar | Primary/destructive priority and confirmation vary | **Merge** |
| Admin Action Modal | Confirm or collect details for an operational command | Admin OS modules | Generic action modal; editor modal; destructive modal | Generic runtime coexists with module-specific dialogs | **Merge** |
| Admin Status Indicator | Communicate operational health or record state | Topbar, Dashboard, all workspaces | Pill; badge; dot; health card; live status | Same status may use different labels and colors by module | **Merge** |
| Admin KPI | Present high-priority operational metric | Dashboard, legacy admin, Wallet, Pricing | KPI card; stat tile; command metric | Current and legacy patterns differ; some cards are not interactive | **Improve** |
| Admin Attention Item | Surface work requiring action | Dashboard, Orders, Wallet, Support, Payments | Attention queue row; severity item; quick action | Severity, urgency, and navigation treatment vary | **Merge** |
| Admin Activity Item | Present recent system or customer activity | Dashboard, Users, Audit, Wallet | Recent operation; audit event; activity row | Metadata depth and timestamp formatting vary | **Merge** |
| Admin Empty/Loading/Error State | Provide terminal workspace states | All Admin OS modules | Skeleton; list empty; detail empty; retry error | Many module-local renderers despite common purpose | **Merge** |

---

## 13. Admin domain components

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Dashboard Range Selector | Scope operational metrics by time | Admin Dashboard | Preset range; custom metadata | Not shared with audit/date filters | **Merge** with Date/Time Control |
| KPI Card | Present revenue, orders, customers, and operational metrics | Admin Dashboard | Standard; positive/negative trend; warning | Non-interactive cards conflict with strict card definition unless made actionable | **Improve** |
| Dashboard Chart | Visualize sales and status distribution | Admin Dashboard | Sales line/bar; status distribution | Data visualization is outside Foundation v1.0; retain as product-specific pattern pending later system | **Keep** |
| Manual Review Workspace | Review payment evidence and approve or reject | Admin Orders and Admin Wallet | Commerce order receipt; wallet top-up slip | Two separate detail/evidence/action systems for equivalent manual-review work | **Merge** |
| Payment Evidence Viewer | Inspect receipt/slip evidence | Admin Orders, Admin Wallet | Inline preview; modal image; unavailable state | URL normalization, fallback, metadata, and zoom differ | **Merge** |
| Business Snapshot | Show price, supplier cost, margin, discount, and exchange context | Admin Orders, Catalog pricing preview, Pricing Engine | Order snapshot; package preview; daily pricing row | Similar financial values use different label order and precision | **Merge** |
| Customer Workspace | Inspect customer overview, orders, wallet, activity, notes, and tags | Admin Users | Tabbed split detail | Uses local versions of Order Item, Wallet Item, Activity Item, and notes | **Improve** |
| Customer Tag Editor | Apply operational metadata to customers | Admin Users | Static badge list; editable tags | Tag vocabulary and create/remove flow are local | **Improve** |
| Catalog Product Row | Select a product for administration | Admin Catalog | List row; search result; selected | Does not align with storefront product identity or shared admin queue row | **Merge** |
| Catalog Product Editor | Create or edit product identity and storefront presentation | Admin Catalog | General; imagery; regional; status | Very large bespoke modal/panel with inconsistent field sections | **Improve** |
| Package Table | Compare and manage product packages | Admin Catalog | Read-only row; editable row; regional pricing columns | Table and mobile behavior are bespoke | **Merge** into Admin Data Table |
| Package Editor | Create/edit package identity, pricing, supplier cost, and artwork | Admin Catalog | Create panel; edit panel; regional sections; bulk supplier cost | Multiple editor shells and repeated pricing controls | **Merge** |
| Media Selector | Choose an existing managed asset | Catalog, Campaigns, Home Banners, Site Placements, Design Studio | Modal selector; inline preview; upload option | Several integrations wrap the selector differently | **Improve** |
| Media Library Item | Preview and manage an uploaded asset | Admin Media | Grid tile; selected tile; metadata | Selection and management actions are tightly coupled | **Improve** |
| Media Upload Modal | Upload and classify managed assets | Admin Media | Image upload; placement/type metadata | File upload behavior differs from catalog direct uploads | **Merge** with File Upload Control |
| Banner Item | Summarize a managed banner | Admin Home Banners, Admin Catalog game banners | Home banner; game banner | Two banner management systems with overlapping fields | **Merge** |
| Banner Editor | Configure artwork, link, schedule, and status | Admin Home Banners, Catalog | Home; game-specific | Preview, scheduling, and validation differ | **Merge** |
| Site Placement Editor | Configure ordered content within a managed placement | Admin Site Content | Item list; reorder; mode-specific item editor | Bespoke list controls overlap with sortable Design Studio layers | **Improve** |
| Campaign Item | Summarize campaign targeting and lifecycle | Admin Campaigns | Active; draft; scheduled; expired | Status and preview differ from home banners and promotions | **Improve** |
| Campaign Editor | Configure campaign content, targeting, schedule, and presentation | Admin Campaigns | Create; edit; preview | Uses bespoke form/modal patterns | **Improve** |
| Promotion Item | Summarize discount rules and eligibility | Admin Promos | Active; scheduled; exhausted; disabled | Status and monetary presentation differ from pricing and campaign items | **Improve** |
| Promotion Editor | Configure discount, limits, eligibility, and schedule | Admin Promos | Create; edit; product/package eligibility | Large bespoke dialog and dependent selectors | **Improve** |
| Pricing Workspace | Review and adjust daily prices and commercial controls | Admin Pricing Engine | Daily workspace; settings; product rows; validation | Multiple intertwined tables, inline forms, and status chips | **Improve** |
| Pricing Status Chip | Communicate supplier-cost and profitability readiness | Admin Catalog, Pricing Engine | Missing cost; stale; ready; warning | Local status vocabulary and appearance | **Merge** into Status Badge with pricing semantics |
| Regional Pricing Editor | Configure region/currency-specific commercial values | Admin Catalog, Pricing Engine | TH/MM; selling price; supplier cost; exchange | Duplicated monetary controls and calculation previews | **Merge** |
| Payment Infrastructure Rail | Present customer payment rails and routing health | Admin Payments | Rail group; rail row; card preview; provider/account section | Numerous bespoke cards and rows; configuration versus health state is mixed | **Improve** |
| Payment Method Editor | Configure customer-visible payment capabilities | Admin Payments, Admin Settings | Inline card; full editor; bank launcher; checklist preview | Legacy settings editor overlaps comprehensive payments workspace | **Merge** |
| Provider Credential State | Show secret/configuration readiness without exposing secrets | Admin Payments | Configured; missing; invalid; environment-specific | Similar to diagnostics but visually separate | **Merge** into Operational Health Indicator |
| Payment Diagnostic Item | Present routing, webhook, account, and configuration checks | Admin Payments | Diagnostic row; warning card; health summary | Status hierarchy and remediation actions vary | **Merge** |
| Deep-Link Tester | Test Android banking-app launch behavior | Admin Payments | Owner tester; intent preview; launcher buttons; status | Specialized tool; retain independently but align shell and feedback | **Keep** |
| Supplier Item | Summarize fulfilment supplier configuration | Admin Fulfilment | List row; enabled/disabled; edit action | Uses local list and editor patterns | **Merge** into Admin Queue Row |
| Supplier Editor | Create/edit fulfilment supplier configuration | Admin Fulfilment | Create form; edit modal | Duplicate field and modal anatomy | **Merge** |
| Fulfilment Mapping Item | Show product/package-to-supplier mapping | Admin Fulfilment | Mapping row; status; action | Table/list semantics and status presentation are bespoke | **Merge** |
| Fulfilment Attempt Item | Show execution state, supplier, and failure context | Admin Fulfilment, Admin Order Detail | Attempt card; summary in order | Same domain is projected through two unrelated components | **Merge** |
| Admin Account Item | Present admin identity, role, 2FA, and status | Admin Security | Account row; modal editor | Local account list differs from customer/user management | **Improve** |
| Admin Session Item | Present and revoke privileged sessions | Admin Security | Current; other; expired/revoked | Should share core session anatomy with customer security | **Merge** |
| Audit Event Item | Present security/administrative activity | Admin Security | Standard event; expanded metadata | Uses nested renderers and bespoke severity mapping | **Improve** |
| Configuration Registry Item | Present configuration scope, value source, and state | Admin Website/Settings runtime | Registry row; runtime session; draft state | Complex domain-specific display with local status patterns | **Improve** |

---

## 14. Design Studio components

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Studio Shell | Organize tools, canvas, layers, properties, and status | Design Studio | Full desktop workspace; constrained responsive state | Separate application chrome from Admin OS; shares only partial controls | **Improve** |
| Studio Toolbar | Provide document and editing commands | Design Studio | Top toolbar; canvas toolbar; command list | Command buttons, dropdowns, and state indicators use several local patterns | **Merge** internally |
| Tool Button | Activate a creation or editing tool | Design Studio | Icon; icon/text; active; disabled | Does not share standard admin icon-button states | **Merge** |
| Canvas | Display and interact with the design document | Design Studio | Editing canvas; preview; zoomed/panned | Specialized and appropriately unique | **Keep** |
| Layer Item | Select, reorder, hide, lock, and identify a node | Design Studio | Standard; selected; nested; hidden; locked | Bespoke sortable row; selection and action density need consolidation | **Improve** |
| Layer Tree | Present document hierarchy | Design Studio | Docked list; nested groups | Specialized and appropriately unique | **Keep** |
| Properties Panel | Inspect and edit selected-node properties | Design Studio | Typography; layout; appearance; data; phase-one sections | Repeated panel sections and field groups lack a consistent anatomy | **Merge** internally |
| Inspector Section | Group related properties | Design Studio | Standard; collapsed; disabled; contextual | Uses generic panel-card treatment and inconsistent section controls | **Improve** |
| Canvas Status Bar | Show zoom, document state, and save state | Design Studio | Bottom status; top save status | Duplicated state messages and control placement | **Merge** |
| Inline Text Editor | Edit text directly on canvas | Design Studio | Active editor; committed state | Specialized and appropriately unique | **Keep** |
| Preset Item | Apply a design preset | Design Studio | Layout; appearance; reusable preset | Selection resembles generic cards but behavior is tool-specific | **Improve** |
| Draft/Save State | Communicate unsaved, saving, saved, and failed changes | Design Studio, Admin pricing/configuration drafts | Studio draft; pricing workspace draft; configuration draft | Three independent save-state systems | **Merge** semantic pattern |

---

## 15. Legacy and duplicate component families

| Component Name | Purpose | Where it is used | Variants | Current inconsistencies | Decision |
|---|---|---|---|---|---|
| Legacy Public Topbar | Navigate old shop/help surfaces | Legacy Shop, Help | Basic topbar | Superseded by Public Header | **Remove** |
| Legacy Shop Hero and Game Cards | Discover games in the old storefront | Legacy Shop | Shop hero; old game card | Superseded by Home and Catalog discovery components | **Remove** |
| Legacy Admin Shell | Operate old order administration | Legacy Admin Orders, standalone remnants | Old sidebar/topbar/stats/orders | Superseded by Admin OS | **Remove** |
| Legacy Admin Order Card/Modal | Review and update old orders | Legacy Admin Orders | Order card; status action; slip modal | Duplicates Admin Orders queue/detail and lacks Commerce projection | **Remove** |
| Legacy Legal Info Card | Group policy text | Old Terms, Privacy, Refund | `info-card` inside `page-wrap` | Superseded by current policy pages and conflicts with card definition | **Remove** |
| Legacy Auth Layout | Reset password and older auth flows | `reset.html` and older styles | `auth-layout`; `auth-switch` | Superseded by current Auth shell/card | **Merge**, then remove legacy implementation |
| Payment Mock Shell | Simulate payment completion | `payment-mock.html` | Bottom nav; order loading; success modal | Development/legacy surface reuses production-looking components outside current checkout architecture | **Remove** from customer inventory; retain only as an internal test fixture if required |
| OAuth Success Utility | Complete external authentication redirect | `google-success.html` | Minimal utility page | Not a reusable visual component; should remain a utility state | **Keep** as non-component utility |
| Verification File | Domain verification | `googlef3b883efac53feee.html` | Static verification content | Not UI and not part of the design system | **Remove** from component scope |

---

## 16. Consolidation priorities

The inventory identifies the following highest-value duplicate families for future redesign work. This ordering does not redesign them; it establishes dependency priority.

1. **Foundational controls:** Button, Icon Button, Form Field, Text Input, Select, Validation Message.
2. **State and feedback:** Status Badge, Alert, Toast, Loading, Skeleton, Empty State, Error State.
3. **Overlay architecture:** Modal, Confirmation Dialog, Bottom Sheet, Drawer, Media Preview.
4. **Navigation and selection:** Tabs, Dropdown, Search, Filter Bar, Chip, Pagination.
5. **Commerce objects:** Product Item, Package Item, Payment Method Item, Order Summary, Price Breakdown.
6. **Customer operations:** Order Item, Order Detail, Timeline, Wallet Transaction, Notification Item.
7. **Admin operations:** Queue Row, Split Workspace, Detail Section, Data Table, Action Modal.
8. **Manual review:** Order evidence review and wallet top-up review.
9. **Content structure:** Hero, Section Header, Policy Section, FAQ, CTA, Footer.
10. **Specialized tools:** Pricing, Payment Infrastructure, Fulfilment, Security, and Design Studio components after shared dependencies are defined.

---

## 17. Audit conclusion

AZIEL already contains a broad and capable component ecosystem, but most reuse is conceptual rather than systemic. The same roles are repeatedly implemented with page-specific classes and runtime renderers.

The strongest candidates to keep are specialized functional objects with clear domain ownership: the checkout sheet, recovery overlay, Design Studio canvas, deep-link tester, and domain-specific operational workspaces.

The largest opportunity is consolidation. Buttons, fields, statuses, tabs, dialogs, feedback, product items, order items, manual review, admin queues, and detail sections currently exist in multiple independent forms.

Future redesign should begin with shared primitives and high-frequency component families before redesigning pages or specialized domain tools. Components must inherit the frozen Foundation, especially Minimalist Commerce hierarchy and the rule that cards are reserved for functional interactive objects.
