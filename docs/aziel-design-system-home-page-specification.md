# AZIEL Design System — Home Page Specification

**Version:** 1.0  
**Status:** Draft for review  
**Classification:** Page specification  
**Applies to:** AZIEL customer storefront home  
**Authority:** Inherits the frozen Foundation, Primary Button Specification, and Section Header Pattern Specification

---

## 1. Purpose

The AZIEL Home Page is the primary storefront entry point. It must help a customer:

1. Resume an active transaction when continuity is required.
2. Find a game, digital product, or service quickly.
3. Evaluate relevant products and active offers.
4. Understand why AZIEL is trustworthy.
5. Reach orders, wallet, and support without searching for those destinations.

The page must feel calm, direct, spacious, and commerce-ready. It must create hierarchy through typography, content order, alignment, whitespace, and authentic product imagery. Decorative containers, ornamental cards, excessive promotional color, and artificial urgency are prohibited.

The page is not a campaign landing page, a dashboard, a complete catalog, or an informational brochure. It must not attempt to expose every AZIEL capability at once.

---

## 2. Experience principles

### 2.1 Product discovery before promotion

The product-finding task must be clearer than promotional content. Promotions may support discovery but must not displace search, active transaction continuity, or recognizable product entry points.

### 2.2 Continuity before a new transaction

When a customer has an actionable pending payment or active order, the page must make that transaction understandable and recoverable before encouraging a conflicting new purchase.

### 2.3 Commerce clarity

Product identity, region, price, currency, offer eligibility, action, and transaction state must remain accurate and audience-appropriate. The Home Page must never imply that a quoted starting price is the authoritative final payable amount.

### 2.4 Minimalist composition

Cards may be used only for functional objects that customers can select, open, compare, configure, or act upon. Headings, explanatory copy, trust statements, and page sections must not be placed in cards merely for organization.

### 2.5 State-aware relevance

Authenticated context may improve continuity and relevance, but the page must remain understandable before authentication and must not expose private activity until user readiness is established.

---

## 3. Information hierarchy

Information must be prioritized in this order:

1. **Critical transaction continuity** — recoverable payment, required customer action, or active order exception.
2. **Page identity and product-finding task** — what AZIEL offers and how to begin.
3. **Recognizable product entry points** — popular games and services.
4. **Category navigation** — broader routes into the catalog.
5. **Eligible active promotions** — time-bound commercial opportunities with clear conditions.
6. **Purchase orientation** — concise explanation of the customer journey.
7. **Trust and support** — evidence, expectations, and assistance routes.

This hierarchy must remain stable across desktop, tablet, and mobile. Responsive layout may reposition supporting information but must not lower the priority of transaction continuity, product identity, or the primary product-finding action.

---

## 4. Content hierarchy

### 4.1 Page-level hierarchy

- One page title must identify the storefront proposition.
- One concise supporting statement should explain the value of AZIEL without promotional exaggeration.
- The product-finding entry must be visible with the page title or immediately after it.
- Each following section must use the frozen Section Header pattern.
- Section titles must remain subordinate to the page title.
- Supporting copy must be concise, literal, and useful for orientation, evaluation, action, confirmation, or recovery.

### 4.2 Commerce-object hierarchy

Functional product objects must present, as applicable:

1. Recognizable game or product identity.
2. Product type or region when material.
3. Authoritative availability state.
4. Price context with explicit currency when a reliable amount is available.
5. Promotion or eligibility information when applicable.
6. A clear open or select affordance.

Equivalent objects must use equivalent information order. Product artwork must assist recognition without overpowering price, state, or action.

### 4.3 Content limits

- Home must show a curated subset rather than the full catalog.
- Long explanations, policy summaries, full order histories, full transaction histories, and support documentation belong on their destination pages.
- A section without useful, current content should be omitted when omission preserves continuity; it must not be filled with placeholder decoration.

---

## 5. Section order

The canonical order is:

1. Global customer header
2. Transaction Continuity — conditional
3. Storefront Introduction and Product Finder
4. Popular Games and Services
5. Shop by Category
6. Latest Promotions — conditional
7. How AZIEL Works
8. Trust and Support
9. Global footer

Transaction Continuity may appear after the Storefront Introduction only when the active state is informational and requires no immediate customer decision. An actionable payment, account-destination issue, order exception, or expiring recovery state must appear first.

Sections must not be reordered for campaign preference, visual variety, or device size. Personalization may change eligible content within a section but must not change the meaning of the sequence.

---

## 6. Section specifications

### 6.1 Global customer header

**Purpose:** Provide persistent access to brand identity, primary navigation, search entry, locale, notifications, account, and wallet context.

**Rules:**

- The header must remain visually lighter than page content.
- It must not duplicate the complete product finder when a compact search entry is sufficient.
- Authentication, wallet, and notification state must be accurate before private information is exposed.
- The page specification does not redefine the frozen or future global header components.

### 6.2 Transaction Continuity — conditional

**Purpose:** Help an authenticated customer understand and resume the single most relevant active commerce state.

**Content:** Product identity, audience-appropriate state, what is waiting, expiry when material, next expected step, and a truthful recovery or tracking action.

**Rules:**

- The state must preserve separate payment, evidence, order, fulfilment, and refund meanings.
- Submitted receipt evidence must not be described as verified payment.
- Recovery must resume the existing transaction rather than imply or initiate a new charge.
- A recoverable payment object or actionable order may use a card because it is a functional object.
- If multiple active transactions exist, the section should show the most urgent legitimate customer action and provide access to the complete order list.
- Urgency must reflect real expiry or risk and must not be manufactured.

**Primary action:** Resume the existing required action, such as “Continue payment,” when that is the current transaction truth.

**Secondary action:** View or track the related order.

### 6.3 Storefront Introduction and Product Finder

**Purpose:** State the AZIEL proposition and provide the fastest route to a relevant product.

**Content:** One page title, one concise supporting statement, and the primary product-finding control. Game artwork may provide brand expression only when it preserves text and action clarity.

**Rules:**

- This area must not be enclosed in a card.
- The page title must be content-led rather than a campaign slogan.
- Search must accept customer-recognizable game, product, and service names.
- Search results and suggestions must distinguish similarly named or region-specific products.
- Promotional badges, statistics, trust claims, and multiple competing calls to action must not crowd the introduction.

**Primary action:** Find a game or product through the product finder. If submission requires a Primary Button, its label must name the immediate action, such as “Search.”

**Secondary action:** Track an order through a clearly named navigation action.

### 6.4 Popular Games and Services

**Purpose:** Give customers fast access to the most relevant, available products without requiring search.

**Content:** A curated set of functional Product/Game Items using authentic artwork, customer-facing name, region or service type when material, availability, and reliable price context when useful.

**Rules:**

- Every item must open or select the represented product; decorative product cards are prohibited.
- Popularity must come from an approved merchandising or product source, not visual preference.
- Product order must not falsely imply endorsement, scarcity, or availability.
- Unavailable items should be omitted unless their unavailable state provides useful customer information.
- The section-level secondary action may navigate to the complete catalog.

### 6.5 Shop by Category

**Purpose:** Provide broad, predictable catalog routes for customers who think in product types rather than specific titles.

**Content:** A concise set of functional Category Items, such as Mobile Games, PC Games, Gift Cards, or Digital Services, based on the authoritative catalog taxonomy.

**Rules:**

- Category Items must be interactive objects and may therefore use card treatment.
- Category names must be customer-recognizable and mutually understandable.
- Imagery or icons must reinforce category meaning and must not carry the only label.
- Categories must not duplicate promotional collections or temporary campaigns.

### 6.6 Latest Promotions — conditional

**Purpose:** Present relevant, valid offers after customers can already find the underlying product.

**Content:** Active functional promotion objects containing the offer, eligible product, truthful benefit, eligibility or limitation summary, and relevant end condition.

**Rules:**

- Promotions must be secondary to product discovery and final payable price.
- Every promotion object must open an eligible offer or product context; decorative campaign panels are prohibited.
- Discount claims must be accurate, explainable, and supported by authoritative pricing.
- Original price, discount, and resulting price must retain distinct roles and explicit currency.
- Automatic rotation is prohibited. Multiple offers must remain user-controlled and understandable without motion.
- The section must be omitted when there are no active customer-relevant promotions.

### 6.7 How AZIEL Works

**Purpose:** Explain the purchase journey for new or uncertain customers without interrupting discovery.

**Content:** A short ordered sequence covering product selection, account details, payment, verification where applicable, and fulfilment.

**Rules:**

- Steps must use simple text, numbering, and optional supportive icons—not cards.
- The explanation must distinguish customer submission from AZIEL verification.
- The sequence must not promise instant delivery or approval unless that promise is operationally valid for the product.
- Detailed instructions belong in the relevant checkout or support context.

### 6.8 Trust and Support

**Purpose:** Provide concise evidence of reliability and a clear route to assistance.

**Content:** A small number of truthful assurance statements and direct navigation to Support, FAQ, payment information, or relevant policies.

**Rules:**

- Trust statements must be specific, supportable, and written without inflated claims.
- Trust content must use an open text or list composition, not decorative cards.
- Partner, payment, or publisher logos must reflect actual relationships and must not imply unsupported endorsement.
- Support access must remain clearly named and must not compete with the page's primary product-finding action.

---

## 7. User journeys

### 7.1 New customer discovery

1. Understands what AZIEL sells.
2. Searches for a known game or scans popular products.
3. Confirms the correct title, product type, and region.
4. Opens the product detail or commerce flow.

Trust and process information remain available later in the page without blocking product discovery.

### 7.2 Returning customer with an active transaction

1. Sees the most relevant pending or exceptional transaction state.
2. Understands what has happened and what is expected next.
3. Continues the existing payment or opens the related order.
4. Returns to discovery only after continuity is understood.

### 7.3 Returning customer without an active transaction

1. Re-enters through search, a familiar product, or category.
2. May navigate to orders, wallet, notifications, or account through global entry points.
3. Encounters promotions only after primary discovery routes.

### 7.4 Customer seeking help

1. Uses the global Support entry or reaches Trust and Support.
2. Chooses self-service information or starts a support request.
3. Retains commerce context when support originates from an active order or payment.

---

## 8. Entry points

The Home Page must support these clear entry points:

- Product finder
- Popular product item
- Category item
- Eligible promotion object
- Recoverable payment or active order
- Order tracking
- Wallet
- Notifications
- Account and authentication
- Locale selection
- Support and FAQ

Each entry point must have one stable meaning. Equivalent entry points across the header, page content, and footer must use consistent naming and destination behavior.

Deep links into a product, order, payment recovery, or support context must preserve that destination rather than forcing an unnecessary Home Page detour.

---

## 9. Actions

### 9.1 Page-primary action

The page-primary task is **finding a relevant product**. The product finder is the dominant action context for customers without a more urgent active transaction.

If Transaction Continuity contains a required customer action, that recovery action becomes the highest-priority action until the customer dismisses or resolves the context. It must not create a new transaction.

### 9.2 Section actions

- Each section must contain no more than one Primary Action and one Secondary Action, following the frozen Section Header pattern.
- A Primary Button must follow the frozen Primary Button Specification.
- Navigation must use appropriate link semantics even when visually prominent.
- Item-level actions must remain attached to their functional object rather than move into the Section Header.
- Financially consequential actions must not complete directly from Home unless the page also presents the complete required confirmation context.

### 9.3 Action priority

The page must not present competing Primary Buttons across adjacent sections within the same viewport. Full-width promotional actions, floating purchase controls, and repeated campaign calls to action are prohibited.

---

## 10. Empty, loading, and unavailable states

Every data-driven section must resolve to content, a purposeful empty state, an unavailable state, or omission. Loading indicators must not remain after the request settles.

| Context | Required state |
|---|---|
| No active transaction | Omit Transaction Continuity; do not show a celebratory or placeholder card |
| Authentication unresolved | Do not expose private content or claim there is no activity; resolve readiness before rendering personalized state |
| Active transaction unavailable | Show a concise recoverable message with a safe retry or Orders entry; do not encourage a duplicate payment |
| No popular products | Present a concise catalog-unavailable message and a recoverable retry when appropriate; preserve category or support routes if valid |
| Product service failure | Explain that products could not be loaded, preserve unaffected sections, and provide a retry |
| No active promotions | Omit Latest Promotions entirely |
| Promotion service failure | Omit the section unless a useful recoverable message can be shown without distracting from discovery |
| Search has no matches | State that no matching products were found, preserve the query, and offer category exploration or Support when appropriate |
| Search failure | Preserve the query, explain that search is temporarily unavailable, and provide retry or category navigation |
| No categories | Omit the section if product search and direct discovery remain valid; otherwise expose the catalog-unavailable state |
| Image unavailable | Use the approved product or category fallback while retaining the text identity and action |

Skeletons may be used only when the likely structure and response time justify them. They must not create false content, animate indefinitely, or cause major layout shifts.

---

## 11. Desktop behaviour

- The page must use a restrained maximum content measure with consistent shared edges and generous section separation.
- The Storefront Introduction may use an asymmetric text-and-imagery composition when imagery materially strengthens product recognition and does not reduce search prominence.
- Product and category collections may use multi-column grids sized for meaningful comparison rather than maximum item density.
- Section Headers may place content and actions on one row according to the frozen pattern.
- Transaction Continuity must remain close to the top and must not become a full-width promotional banner.
- Wide screens must increase breathing room and comparison quality, not stretch text, controls, or imagery indiscriminately.

---

## 12. Tablet behaviour

- The page must preserve desktop information order while reducing simultaneous columns before objects become compressed.
- Section Header actions may move below their content group when labels or descriptions no longer fit comfortably.
- Product and category objects must retain artwork recognition, complete names, price context, and comfortable targets.
- The product finder must remain visible without requiring customers to pass promotional content.
- Trust and process content may reduce columns or become a vertical sequence; it must not become horizontally scrollable solely to preserve desktop composition.

---

## 13. Mobile behaviour

- The page must use a single primary reading column with predictable gutters and generous vertical rhythm.
- Transaction Continuity must appear before new-product encouragement when customer action is required.
- The page title, supporting statement, and product finder must remain visible and readable without decorative imagery occupying the initial viewport.
- Section Headers must follow their mobile content-first stack.
- Product and category collections may use a readable single-column list or a compact multi-column grid only when names, imagery, states, and targets remain clear.
- Horizontal scrolling must not be required for essential discovery. A user-controlled horizontal collection may be used only for supplementary content and must expose its position and alternatives accessibly.
- Actions must remain comfortably reachable and must not collapse to unlabeled icons.
- Sticky actions are prohibited on Home unless required for active transaction recovery; any approved sticky recovery action must respect safe areas and must not cover content or navigation.
- Product artwork must crop responsively without removing recognizable subjects, logos, or information required to choose correctly.

---

## 14. Responsive rules

- Responsive changes must follow content pressure, not named device brands.
- Semantic order must remain identical across viewport sizes.
- The page must not maintain separate desktop and mobile content sources that can diverge in product, price, status, or action state.
- Product identity, currency, price context, status, and primary action must not be removed to make an object fit.
- Text must wrap naturally across English, Thai, and Burmese without clipping or fixed-height truncation.
- Images must use stable aspect-ratio roles appropriate to the product context and approved focal treatment.
- Layout changes must avoid disruptive cumulative shifts, especially around search, transaction continuity, and product collections.
- Browser zoom, text enlargement, reflow, orientation change, safe areas, and on-screen keyboard constraints must preserve access to content and actions.
- Responsive layouts must not duplicate headings or expose duplicate operable actions.

---

## 15. Accessibility considerations

- The page must meet the Foundation target of WCAG 2.2 Level AA.
- Global header, main content, search, sections, and footer must use appropriate landmarks and accessible names.
- One page-level heading must identify the page. Section headings must follow a logical hierarchy independent of visual size.
- A skip mechanism must allow keyboard users to bypass repeated global navigation.
- Focus order must follow semantic and visual order, including when desktop layouts place content side by side.
- All interactive objects must support keyboard, pointer, and touch operation with visible focus and comfortable targets.
- Search must have a persistent accessible label, clear submission behavior, and understandable suggestion and result announcements.
- Dynamic transaction, search, loading, error, and result changes must be communicated without stealing focus unnecessarily or repeating announcements.
- Meaning must not rely on color, motion, image, position, or iconography alone.
- Meaningful game and product imagery must have contextual text alternatives. Decorative imagery must be ignored by assistive technology.
- Price, currency, discount, availability, and transaction state must remain available as text.
- Automatic carousel movement, ambient promotional animation, and manufactured countdown urgency are prohibited.
- Reduced-motion preferences must be honored without removing state or feedback meaning.
- English, Thai, and Burmese font fallback, line height, word breaking, and accessible naming must preserve equal function.

---

## 16. Content and commerce rules

- Customer-facing product names must take precedence over internal identifiers.
- Region or platform must be shown when choosing the wrong variant would affect fulfilment.
- Price shown on Home must identify its currency and context, such as “From,” when it is not the authoritative final payable amount.
- Display formatting must not recalculate price, discount, or currency values.
- Promotions must not visually overpower the actual product or payable-price context.
- Status language must explain what is pending, what has happened, and what the customer should expect next.
- Payment evidence submission must remain distinct from payment verification.
- Errors must preserve the customer's query or transaction context whenever safe and practical.
- Content must use natural, concise wording in English, Thai, and Burmese rather than mirror English grammar mechanically.

---

## 17. Acceptance criteria

The AZIEL Home Page Specification is satisfied only when all of the following are true:

1. The page enables transaction continuity, product finding, evaluation, trust, and support in the defined priority order.
2. The canonical section order is preserved, including the conditional rules for Transaction Continuity and Latest Promotions.
3. The page has one unmistakable title and one dominant product-finding task when no urgent active transaction exists.
4. An actionable active transaction is presented before conflicting new-purchase encouragement.
5. Recovery resumes an existing transaction and financially consequential actions preserve idempotent behavior.
6. Popular products, categories, and promotions use cards only as functional interactive objects.
7. Introduction, process, trust, support, and section structure use typography and whitespace rather than card containers.
8. Every section has a defined purpose and contains only content or actions that serve that purpose.
9. Actions use their correct semantics and conform to the frozen Primary Button and Section Header specifications where applicable.
10. Product, region, price context, currency, discount, availability, and commerce state are truthful and authoritative for their displayed context.
11. Empty, loading, error, unavailable, and unauthenticated states resolve without false content, indefinite loading, or major layout instability.
12. Desktop, tablet, and mobile layouts preserve semantic order, commerce priority, readable content, and reachable actions.
13. The page does not use automatic promotion rotation, decorative cards, artificial urgency, excessive color, or ornamental depth.
14. Global and section navigation provides clear entry to catalog, orders, wallet, notifications, account, locale, and support.
15. Heading structure, landmarks, focus order, search behavior, dynamic announcements, contrast, imagery alternatives, zoom, reflow, touch, and reduced motion meet WCAG 2.2 AA.
16. English, Thai, and Burmese content remains natural, legible, complete, and functionally equivalent.
17. The page remains calm and spacious while keeping product identity, price context, action, and transaction state immediately understandable.

---

## 18. Out of scope

This specification does not define:

- Wireframes or visual mockups.
- HTML, CSS, JavaScript, framework architecture, or API contracts.
- Component implementation details.
- Catalog, product-detail, checkout, payment, tracking, wallet, support, or admin page specifications.
- Campaign-specific creative direction.
- Ranking, recommendation, pricing, promotion, authentication, or order business logic.

---

**End of AZIEL Home Page Specification. No implementation or subsequent page specification is included.**
