# AZIEL Design System v1.0

## Foundation

**Status:** Foundation specification  
**Design language:** Minimalist Commerce  
**Scope:** Long-term design rules for every AZIEL customer, commerce, operational, and administrative experience

---

## 1. Purpose

The AZIEL Design System Foundation is the single source of truth for the visual and experiential rules that govern every future page, component, and feature.

The Foundation defines durable principles rather than implementation instructions. It describes how AZIEL should communicate hierarchy, trust, value, action, and state across different platforms and technologies.

This document does not define components, page layouts, code, or framework-specific behavior. Those layers must inherit from and remain consistent with this Foundation.

### 1.1 Foundation promise

Every AZIEL experience should feel:

- Clear before expressive.
- Trustworthy before persuasive.
- Efficient without feeling mechanical.
- Premium without unnecessary decoration.
- Consistent without becoming visually monotonous.
- Appropriate for commerce, where value, price, payment, and status must be immediately understandable.

### 1.2 Design language

AZIEL follows a **Minimalist Commerce** design language.

Minimalism at AZIEL does not mean removing useful information. It means removing visual competition so that the customer can understand the product, price, action, and current state without effort.

Typography, spacing, and imagery create hierarchy. Decorative containers must not substitute for hierarchy. Cards are reserved for functional interactive objects.

### 1.3 Normative language

- **Must** identifies a requirement. A conforming AZIEL experience cannot contradict it.
- **Should** identifies a strong recommendation. Deviation requires a clear product, accessibility, legal, or technical reason.
- **May** identifies an optional approach that remains consistent with the Foundation.

### 1.4 Precedence

When requirements conflict, decisions must follow this order:

1. User safety, legal obligations, financial accuracy, and accessibility.
2. This Foundation.
3. Domain specifications, including commerce and administrative rules.
4. Component specifications.
5. Page, campaign, and feature presentation.

Lower levels may specialize higher-level rules but must not contradict them.

---

## 2. Principles

### 2.1 Commerce clarity

The product, payable price, primary action, and transaction state must always be easier to identify than secondary information.

Commerce information must never depend on decoration, animation, or color alone to be understood.

### 2.2 Purposeful reduction

Every visible element must support orientation, evaluation, action, confirmation, or recovery. Elements that do not serve one of these purposes should be removed.

Minimalism must not hide essential conditions, fees, restrictions, or status information.

### 2.3 Trust through consistency

The same concept must retain the same visual meaning across storefront, checkout, payment, tracking, account, support, and administration.

Prices, statuses, warnings, and actions must not change meaning between surfaces.

### 2.4 Hierarchy before containment

Use typography, spacing, alignment, and imagery to establish hierarchy before introducing borders, backgrounds, panels, or cards.

Content should not be placed inside a card merely to make it appear organized.

### 2.5 Functional cards only

A card is a bounded object that represents one identifiable entity and supports direct interaction with that entity. The interaction may select, open, compare, configure, or act on the object. Examples include a selectable product, package, payment method, or actionable order.

A read-only record, explanatory group, page section, or decorative container is not a card unless the object itself has a direct interactive purpose.

Cards must not be used as generic wrappers for headings, explanatory copy, decorative groups, or entire page sections.

### 2.6 Calm confidence

AZIEL should feel composed and dependable. Strong color, emphasis, motion, and promotional language must be used selectively.

Urgency must represent a real time constraint or risk. It must not be manufactured solely to increase conversion.

### 2.7 Inclusive by default

Accessibility is a foundation requirement, not a later enhancement. Meaning must remain available across vision, motor, cognitive, language, device, and motion preferences.

---

## 3. Token Architecture

Tokens are the conceptual vocabulary through which the Foundation is expressed. They should communicate meaning rather than mirror isolated visual values.

### 3.1 Token layers

AZIEL uses three conceptual layers:

1. **Primitive foundations** describe raw visual scales such as color families, spacing steps, type sizes, radii, and motion durations.
2. **Semantic foundations** describe purpose, such as primary text, commerce price, critical status, interactive focus, or page background.
3. **Contextual aliases** allow a future component or experience to consume semantic meaning without redefining the Foundation.

Components must not become the source of foundational values.

### 3.2 Naming principles

Foundation names must:

- Describe purpose before appearance.
- Remain valid across light and dark themes.
- Avoid page names, campaign names, and temporary feature language.
- Avoid encoding specific colors into semantic names.
- Distinguish foreground, background, border, and interaction roles.
- Use one canonical name for one concept.

### 3.3 Modes

AZIEL supports light and dark visual modes. Both are equal expressions of the same system, not separate designs.

Mode changes may alter visual values but must preserve:

- Hierarchy.
- Semantic meaning.
- Contrast relationships.
- Interaction priority.
- Status recognition.
- Brand identity.

No feature may exist exclusively through a theme-specific visual effect.

---

## 4. Color

Color communicates brand, interaction, status, and emphasis. It must not become the primary method of organizing ordinary content.

### 4.1 Brand color

AZIEL purple is the primary brand signal. It identifies intentional interaction, selection, focus, and distinctive brand moments.

Brand purple must not cover large portions of routine screens or compete with product artwork. Its scarcity gives it authority.

### 4.2 Neutral color

Neutral colors carry most of the interface. They establish page depth, readable text, quiet boundaries, and visual calm.

Neutral relationships must be defined by function:

- Page background.
- Primary surface.
- Elevated surface.
- Primary text.
- Secondary text.
- Muted text.
- Standard border.
- Strong border.
- Disabled content.

### 4.3 Semantic status colors

Status color families communicate:

- Success and completion.
- Warning and attention.
- Danger, failure, or destructive consequence.
- Information and neutral progress.

Status colors must have stable meanings. Promotional discounts must not borrow danger styling unless the information is genuinely critical.

### 4.4 Color usage rules

- Color must reinforce meaning already expressed through text, iconography, shape, or position.
- Primary and destructive actions must remain visually distinct.
- Muted text must remain readable and must not be used for essential transaction information.
- Borders should clarify boundaries, not decorate every region.
- Large saturated areas should be exceptional and purposeful.
- Product artwork may be colorful; surrounding interface color should remain restrained.

### 4.5 Contrast

All meaningful text, icons, controls, focus indicators, and status markers must meet recognized accessibility contrast standards.

The system must define valid foreground and background pairings. A color must not be approved in isolation without its intended contrast relationship.

---

## 5. Typography

Typography is the primary instrument of hierarchy in AZIEL.

### 5.1 Typographic character

AZIEL typography should feel modern, direct, stable, and highly legible. It should support commerce scanning without becoming cold or overly technical.

The primary type family must:

- Perform well at small interface sizes.
- Support English, Thai, and Burmese usage through suitable fonts or intentional fallbacks.
- Provide reliable numeric forms for prices and balances.
- Offer enough weight range to establish hierarchy without excessive size changes.

### 5.2 Hierarchy roles

The type system should define stable roles for:

- Display expression.
- Page title.
- Section title.
- Subsection title.
- Interactive object title.
- Body text.
- Label.
- Supporting text.
- Metadata.
- Commerce value.
- Numeric and reference data.

Roles describe purpose. Pages must not invent new typographic hierarchies for local visual preference.

### 5.3 Hierarchy rules

- Use weight and spacing before extreme size differences.
- A screen should have one unmistakable primary heading.
- Section headings should organize content without competing with the page title.
- Body text must remain comfortable for sustained reading.
- Labels and metadata may be compact but must remain legible.
- Price and payable total require a distinct numeric hierarchy.
- Uppercase text should be limited to short labels and identifiers.
- Excessively heavy weights must not be used as a substitute for hierarchy.

### 5.4 Multilingual typography

English, Thai, and Burmese content must receive equal consideration.

- Line height must accommodate each script without clipping.
- Layouts must allow text expansion and different word-breaking behavior.
- Font fallback must be intentional and visually compatible.
- Critical commerce language must not rely on abbreviated English where localized meaning is required.
- Hierarchy must survive translation even when text length changes significantly.

### 5.5 Numeric typography

Prices, quantities, balances, reference numbers, and countdowns should be easy to compare and verify.

Numeric presentation must prioritize clarity over stylistic novelty. Decimal separators, grouping, currency placement, and precision must remain consistent within a locale and transaction.

---

## 6. Layout & Spacing

Layout creates order through alignment, rhythm, proportion, and whitespace.

### 6.1 Spatial rhythm

AZIEL uses a consistent spacing progression rather than arbitrary gaps.

Spacing should express relationships:

- Tight spacing indicates direct association.
- Standard spacing separates related items.
- Generous spacing separates concepts or sections.
- Major spacing marks a change in page context.

Whitespace is active structure. It should not be filled with decoration simply because space is available.

### 6.2 Alignment

- Content should follow clear shared edges.
- Price, quantity, and status data should align for rapid comparison.
- Related labels and values must maintain predictable relationships.
- Intentional asymmetry is acceptable only when it strengthens hierarchy.
- Misalignment must never be used as a decorative effect in transactional flows.

### 6.3 Page structure

Every page should have:

- A clear content boundary.
- A consistent reading direction.
- Predictable horizontal gutters.
- Distinct section rhythm.
- A primary action location appropriate to the task.
- Sufficient breathing room around critical commerce information.

Wide screens should improve readability and comparison, not stretch content indiscriminately.

### 6.4 Responsive behavior

Responsive design must preserve priority rather than merely shrink dimensions.

- Product identity, price, status, and primary action remain prominent at every size.
- Secondary information may reposition or progressively disclose.
- Controls must remain reachable and readable on small screens.
- Responsive changes must not alter semantic order.
- Breakpoints should represent meaningful layout changes, not device brands.
- Safe areas and browser interface constraints must be respected.

### 6.5 Sizing and touch

- Interactive targets must be comfortably operable by touch.
- Essential actions must not depend on precise pointer movement.
- Text inputs must remain readable without browser zoom intervention.
- Fixed dimensions should be reserved for content with a genuinely fixed role, such as icons or control targets.

### 6.6 Shape and radius

Shape communicates relationship and function.

- Radius should follow a small, consistent progression.
- Interactive objects may use a stronger radius than structural regions.
- Nested objects should maintain visually related radii.
- Pills are reserved for tags, compact statuses, filters, and tightly bounded actions.
- Excessive rounding must not make unrelated objects appear equivalent.

### 6.7 Borders

Borders clarify interaction, separation, selection, focus, or state.

They should not outline every region. Spacing and background relationships should carry ordinary grouping wherever possible.

---

## 7. Depth

Depth establishes layering and interaction priority without making the interface visually heavy.

### 7.1 Elevation

AZIEL uses a limited elevation hierarchy:

- Base content.
- Raised interactive objects.
- Floating controls or menus.
- Modal and blocking experiences.
- Critical system feedback above active content.

Elevation must correspond to behavioral layering. A decorative object must not appear more elevated than the action or message that matters.

### 7.2 Shadows

Shadows should be soft, restrained, and consistent with the active theme.

- Use shadows to explain separation from the surface below.
- Avoid shadows on every card or container.
- Selected state should not rely on a larger shadow alone.
- Dark mode and light mode may require different shadow values while preserving the same perceived hierarchy.

### 7.3 Layering

The system must maintain a predictable layer order for:

- Page content.
- Sticky navigation.
- Menus and popovers.
- Drawers and sheets.
- Modals.
- Toasts and system notices.
- Critical blocking states.

New features must join this hierarchy rather than introducing arbitrary stacking values.

---

## 8. Motion

Motion explains change, confirms action, and preserves spatial understanding. It is not decoration.

### 8.1 Motion character

AZIEL motion should feel quick, controlled, and calm.

- Small interactions respond immediately.
- Entering content may settle smoothly into place.
- Exiting content should leave efficiently.
- Important transitions may receive slightly stronger emphasis.
- Repeated commerce interactions must not become tiring.

### 8.2 Motion purposes

Motion is appropriate when it:

- Confirms an interaction.
- Shows a relationship between states.
- Preserves orientation during navigation or disclosure.
- Draws attention to meaningful live updates.
- Communicates progress without implying completion.

Motion is inappropriate when it delays access, creates artificial urgency, or animates content without adding understanding.

### 8.3 Reduced motion

Reduced-motion preferences must be honored across the system.

When motion is reduced:

- Meaning and state changes must remain clear.
- Large translation, scaling, parallax, and repeated ambient motion should be removed.
- Essential feedback may use immediate state change, color, text, or minimal opacity transitions.

---

## 9. Interaction & Accessibility

### 9.1 State completeness

Every interactive pattern must account for:

- Default.
- Hover where hover exists.
- Pressed.
- Focus-visible.
- Selected.
- Disabled.
- Loading or processing.
- Error.
- Success when confirmation is required.

These states must be semantically consistent across the product.

### 9.2 Focus

Keyboard focus must always be visible, high contrast, and distinct from hover or selected state.

Focus order should follow the visual and semantic reading order. Modal experiences must manage focus without trapping users outside the active task.

### 9.3 Meaning and redundancy

- Color alone must never communicate state.
- Icons that carry meaning require an accessible name or adjacent text.
- Error messages must identify the problem and provide a recovery direction.
- Loading states must describe what is happening when the wait is meaningful.
- Success messages must confirm the completed action rather than merely display positive color.

### 9.4 Language and comprehension

Interface language should be concise, literal, and action-oriented.

- Avoid technical payment or system terminology in customer-facing surfaces.
- Use consistent names for the same action and state.
- Distinguish submitted payment evidence from verified payment.
- Explain irreversible or financially significant actions before commitment.

### 9.5 Accessibility baseline

AZIEL targets **WCAG 2.2 Level AA** as its minimum accessibility standard. Later compatible standards may strengthen this baseline but must not reduce it.

All AZIEL experiences must support:

- Keyboard operation.
- Screen-reader interpretation.
- Sufficient color contrast.
- Text resizing and browser zoom.
- Touch interaction.
- Reduced motion.
- Clear error identification.
- Logical heading and landmark structure.
- Localized content without loss of function.

---

## 10. Imagery

Imagery is a primary source of product identity and emotional recognition in AZIEL. It must be expressive without reducing commerce clarity.

### 10.1 Imagery principles

- Imagery must support product recognition, context, or trust.
- Product imagery should be authentic to the represented game or offering.
- Interface decoration must not compete with product artwork.
- Cropping must preserve recognizable subjects and important brand marks.
- Text must remain readable regardless of image brightness or complexity.
- Image treatment must remain consistent across equivalent product contexts.
- Low-quality, stretched, distorted, or visibly compressed assets are not acceptable.

### 10.2 Imagery accessibility

- Meaningful imagery must have an accessible text alternative that communicates its purpose in context.
- Decorative imagery must be ignored by assistive technology.
- Essential product, price, status, eligibility, or instructional information must not exist only inside an image.
- Alternative text must describe useful meaning rather than repeat nearby text or filenames.
- Cropping and responsive treatment must not remove information required to understand the product or action.

### 10.3 Game artwork

Game artwork is treated as product identity, not generic decoration.

#### Selection

- Use officially authorized or properly licensed artwork.
- Prefer artwork that communicates the game quickly at small and medium sizes.
- Select a clear focal subject rather than a visually crowded scene.
- Avoid imagery containing unrelated promotional messages, prices, dates, or obsolete events.
- Regional artwork should match the product region when regional differences are material.

#### Composition

- Maintain a protected focal area for the primary character, object, or scene.
- Anticipate responsive cropping before approving an asset.
- Do not place essential artwork details beneath text, controls, badges, or navigation.
- Background extensions or tonal treatments may support legibility, but must not materially alter the original artwork.
- Multiple artworks shown together should have comparable visual weight.

#### Treatment

- Do not distort aspect ratio.
- Do not recolor characters, environments, or official game assets to match the AZIEL palette.
- Do not apply excessive blur, glow, saturation, or contrast.
- Overlays may be used only to preserve readable hierarchy.
- Rounded clipping should follow the function and context of the interactive object, not be applied indiscriminately.

#### Fallbacks

When approved artwork is unavailable, use a deliberate neutral fallback with the game name or approved identifier. Never substitute unrelated game artwork.

### 10.4 Game logos

Game logos are protected identity assets.

- Use official logo files whenever available.
- Preserve original proportions, colors, and internal spacing.
- Maintain clear space around the logo.
- Do not redraw, stretch, rotate, outline, bevel, or add unapproved effects.
- Do not place logos on backgrounds that impair recognition.
- Use an approved monochrome version only when one exists and the context requires it.
- Avoid repeating a logo when nearby artwork already communicates the same identity clearly.

### 10.5 AZIEL brand and partner logos

- The AZIEL mark must retain consistent prominence and clear space.
- Partner, bank, payment, and publisher logos must not imply endorsement beyond the actual relationship.
- Competing logos should be optically balanced rather than forced into identical dimensions.
- Logos must not be used as decorative patterns.
- Logo treatment must remain respectful in both light and dark modes.

### 10.6 Promotional imagery

Promotional imagery may be more expressive than routine product imagery, but the offer, eligibility, and action must remain clear.

Promotional artwork must not obscure the actual product, price, or limitations. Campaign styling is temporary and must not redefine Foundation colors, typography, or interaction meaning.

---

## 11. Commerce Rules

Commerce presentation must optimize recognition, comparison, confidence, and accurate decision-making.

### 11.1 Product presentation

Every product presentation should establish, in order:

1. Product or game identity.
2. Package or offer identity.
3. Quantity or included value.
4. Payable price.
5. Eligibility, region, or important restriction.
6. Available action.

Product names must use customer-recognizable language. Internal codes and supplier identifiers must not replace customer-facing names.

Equivalent products should use equivalent information order so customers can compare them quickly.

### 11.2 Price presentation

The final payable amount is the primary commerce value.

- Price must be visually adjacent to its currency.
- Currency must never be inferred from color, region flag, or page context alone.
- Original price, unit price, fees, discounts, and totals must have clearly different roles.
- The most prominent price must be the amount the customer is expected to pay.
- A price shown before checkout must not imply finality when additional fees or conversion may apply.
- Before commitment, the final payable amount must include every mandatory fee, surcharge, tax, and currency conversion that AZIEL can determine.
- Any cost that cannot yet be determined must be disclosed before commitment, together with when and why it will be calculated.
- Confirmation must repeat the authoritative final payable amount and charge currency.
- Zero values must be described accurately as free, waived, or zero according to the underlying business meaning.

### 11.3 Discount presentation

Discounts must be accurate, explainable, and secondary to the final payable amount.

- Show an original price only when it is a genuine comparison value.
- Distinguish fixed-amount and percentage discounts.
- Do not use false urgency, inflated reference prices, or misleading savings language.
- Promotion eligibility and limitations must remain accessible.
- Discount color must not overpower product identity or final price.
- A discount must never make fees or final payable amount less clear.

### 11.4 Currency formatting

Currency formatting must be consistent with the transaction and locale.

- Always display the currency symbol or code with monetary values.
- Use locale-appropriate grouping and decimal separators.
- Monetary precision and rounding must come from the authoritative transaction or pricing domain, not from presentation code.
- Quote, checkout, payment, receipt, tracking, administration, and refund surfaces must display the same authoritative monetary result for the same transaction state.
- Rounding must follow the currency's supported precision and the approved commercial calculation order. Display formatting must not recalculate monetary values.
- Do not silently convert currencies.
- When conversion occurs, distinguish source amount, exchange rate context, and final charge currency.
- Avoid mixing multiple currencies in one price hierarchy without explicit labels.
- Administrative views may show additional currency detail, but customer-facing totals must remain simple and unambiguous.

### 11.5 Status presentation

Commerce statuses must communicate what has happened, what is happening, and what the customer should expect next.

#### Status domains

Commerce state is composed of separate domains that must not be collapsed into one ambiguous status:

- **Payment** describes whether money is unpaid, pending, confirmed, failed, cancelled, expired, or refunded.
- **Payment evidence** describes whether evidence is absent, submitted, awaiting verification, accepted, or rejected.
- **Order** describes the commercial lifecycle from pending payment through completion, cancellation, failure, or refund.
- **Fulfilment** describes delivery progress after the required payment condition is satisfied.
- **Refund** describes request, review, approval, processing, rejection, or completion of returned value.

An experience may summarize these domains for its audience, but the summary must preserve their distinct meanings. Customer-facing wording may differ from persisted system terminology, but it must not imply a transition that has not occurred.

Status language must distinguish:

- Awaiting payment.
- Payment evidence submitted.
- Awaiting verification.
- Payment confirmed.
- Processing.
- Completed.
- Failed.
- Cancelled.
- Refund requested or under review.
- Refunded.

Rules:

- Persisted system status and customer-facing explanation may differ in wording, but must never conflict in meaning.
- Submitted evidence must not be presented as confirmed payment.
- Pending must include enough context to explain what is pending.
- Status must use text in addition to color.
- The next expected action or waiting condition should be visible when useful.
- Terminal states must be unmistakable.
- Status history should preserve chronological clarity and avoid exposing internal event names.

### 11.6 Trust and disclosure

- Final confirmation must summarize product, account destination, amount, currency, and payment method.
- Financially significant actions must provide clear feedback.
- Errors must preserve entered information whenever safe and practical.
- Recovery experiences must resume the existing transaction rather than imply a new charge.
- Payment instructions must clearly distinguish customer action from administrative verification.

---

## 12. Glossary

- **Card:** A bounded representation of one identifiable entity with a direct interactive purpose.
- **Commerce status:** An audience-appropriate expression of one or more payment, evidence, order, fulfilment, or refund states.
- **Contextual alias:** A role that connects a future component or experience to an established semantic foundation.
- **Final payable amount:** The authoritative total the customer is expected to pay, including every determinable mandatory cost.
- **Foundation:** The highest design-system rules governing visual meaning, hierarchy, accessibility, and commerce presentation.
- **Fulfilment:** Delivery of the purchased product or value after the required payment condition is satisfied.
- **Package:** A purchasable configuration of a product, including quantity, value, eligibility, and region where applicable.
- **Payment evidence:** Customer-submitted material used for verification; submission does not mean payment confirmation.
- **Primitive foundation:** A raw scale or value family without product-specific meaning.
- **Product:** The customer-recognizable game, service, or offering being purchased.
- **Semantic foundation:** A durable role defined by purpose, such as primary text, final price, focus, or critical status.
- **Surface:** A visual plane used to establish background or structural depth; a surface is not automatically a card.

---

## 13. Governance

Governance for v1.0 is intentionally lightweight.

### 13.1 Authority

This Foundation is the authoritative reference for foundational design decisions. Page and component specifications must conform to it.

### 13.2 Decision rule

When a new design decision is needed:

1. Reuse an existing Foundation principle or semantic role.
2. Extend the Foundation only when the need is durable and system-wide.
3. Avoid creating page-specific foundation rules.
4. Document approved additions in the source of truth.

### 13.3 Consistency review

Foundation review should verify:

- Semantic consistency.
- Accessibility.
- Commerce clarity.
- Theme parity.
- Multilingual resilience.
- Reuse across more than one isolated feature.

## 14. Foundation acceptance criteria

A future AZIEL design conforms to the Foundation when:

- Product, price, action, and status hierarchy is immediately clear.
- Typography, spacing, and imagery establish structure before containers do.
- Cards represent functional interactive objects only.
- Color and motion reinforce meaning without becoming necessary for comprehension.
- Light and dark modes preserve identical semantics.
- Customer-facing commerce information is accurate and unambiguous.
- Game artwork and logos preserve identity and recognition.
- The experience remains understandable across supported languages and accessibility needs.
- Local design choices do not introduce competing foundation systems.

---

## 15. Out of scope for Foundation v1.0

The following are intentionally outside this version:

- Component specifications.
- Page templates.
- Implementation tokens or code.
- Framework guidance.
- Data-visualization palettes.
- Analytics-specific rules.
- Blur and translucency systems.
- Density modes.
- Advanced localization standards.
- Governance ownership, review boards, and exception workflows.
- Advanced token lifecycle and release management.

These may be defined in later design-system layers or Foundation revisions without weakening the principles established here.
