# AZIEL Design System — Section Header Pattern Specification

**Version:** 1.0  
**Status:** Draft for review  
**Classification:** Reusable content-composition pattern  
**Foundation:** AZIEL Design System Foundation v1.0 (frozen)  
**Related specification:** Primary Button Specification v1.0 (frozen)

---

## 1. Purpose

Section Header introduces a distinct content section, establishes what the section contains, and optionally provides context or actions that apply to the section as a whole.

It creates hierarchy through typography, alignment, and whitespace. It must not use a card, decorative panel, gradient, shadow, or background container to manufacture importance.

Section Header is smaller in hierarchy than a page header or hero. It must not compete with the page title, product identity, final payable amount, or transaction state.

---

## 2. Information hierarchy

The pattern must preserve this priority:

1. **Section Title** — identifies the section and remains the dominant element.
2. **Supporting Description** — explains scope or purpose when the title is insufficient.
3. **Meta Information** — provides concise context such as item count, timeframe, update time, or state summary.
4. **Actions** — allow the user to act on or navigate from the whole section.
5. **Eyebrow** — provides optional categorization but must remain subordinate to the title.

Visual order may place the Eyebrow before the Section Title, but the title remains the primary semantic and visual anchor. Optional information must not weaken recognition of the title.

Commerce-critical product, price, eligibility, payment, and status information must remain in the relevant commerce object or workflow context. Section Header must not become a substitute for required commerce disclosure.

---

## 3. Anatomy

### 3.1 Content group

1. **Eyebrow — optional**  
   A short category or context label. It must add information rather than repeat the title.

2. **Section Title — required**  
   The clear, unique name of the section. It establishes the accessible label and visual anchor for the section.

3. **Supporting Description — optional**  
   Concise explanatory text that clarifies purpose, scope, or what the user can do in the section.

4. **Meta Information — optional**  
   Secondary factual context such as a result count, date range, last-updated time, or audience-appropriate status summary.

### 3.2 Action group — optional

5. **Primary Action — optional**  
   The highest-priority action applying to the section as a whole. It must conform to the frozen Primary Button Specification when it uses Primary Button semantics.

6. **Secondary Action — optional**  
   A lower-priority section-level action. It must use the appropriate action component and must not visually compete with the Primary Action.

The pattern must contain no more than one Primary Action and one Secondary Action. Item-level actions, filters, tabs, search fields, status controls, pagination, and overflow menus belong to their own patterns and must not be inserted into the Section Header anatomy without a future approved composition specification.

---

## 4. Alignment rules

All alignment must use logical start and end positions so the pattern can adapt to writing direction without changing its hierarchy.

### 4.1 Desktop

- The content group must align to the section's content start edge.
- When actions are present and space is sufficient, the content and action groups should share one row.
- The action group must align to the logical end and should align with the title line when the description is short.
- When the content group is taller than the action group, actions should align to the top rather than float vertically between unrelated text lines.
- The text measure must remain readable; wide screens must not stretch the description across the full available width.

### 4.2 Tablet

- The pattern may retain the desktop row when both groups remain readable and actions retain comfortable targets.
- The action group must move below the content group before title, description, meta, or action labels become crowded.
- A wrapped layout must preserve content first and actions second.

### 4.3 Mobile

- The pattern must use a single-column content-first arrangement.
- Eyebrow, title, description, and meta must align to the logical start.
- Actions must follow the complete content group and must not appear between the title and its supporting information.
- A Primary Action should become full width when this improves clarity and reachability, in accordance with the Primary Button Specification.
- If both actions are present, they should stack when a horizontal arrangement would compress labels or targets.

---

## 5. Spacing rules

Spacing must use the Foundation spacing progression and express semantic relationship:

- **Eyebrow to title:** tight spacing because both identify the section.
- **Title to description:** tight or standard spacing according to title scale and script.
- **Description to meta:** tight spacing when meta qualifies the description; standard spacing when it is a separate fact.
- **Content group to action group:** standard spacing in a row and generous enough spacing in a stack to preserve the two groups.
- **Between actions:** tight control-group spacing without merging their targets.
- **Section Header to section content:** standard or generous spacing, consistently applied across equivalent page structures.
- **Previous section content to the next Section Header:** generous section spacing to communicate a change in concept.

External section spacing belongs to the parent page layout. The pattern must not introduce arbitrary margins to correct page-specific composition.

Borders, background fills, shadows, and card shells must not replace spacing as the means of separation.

---

## 6. Responsive behaviour

- Responsive changes must preserve semantic and reading order: Eyebrow, Section Title, Supporting Description, Meta Information, Primary Action, Secondary Action.
- Layout must respond when content no longer fits comfortably, not at a device-brand breakpoint.
- Text must wrap naturally without clipping or ellipsis when it carries essential meaning.
- Action labels must remain complete and readable; they must not collapse to icon-only controls.
- Secondary content may wrap or move to a separate line, but the title and action priority must remain unchanged.
- The pattern must support text enlargement, browser zoom, and reflow without horizontal scrolling caused by the header.
- Responsive treatment must not create duplicate visible headings or duplicate operable actions.
- Safe areas and narrow viewport gutters must be respected by the parent layout.

---

## 7. Typography usage

| Element | Foundation typography role | Rules |
|---|---|---|
| Eyebrow | Label | Compact and subordinate; uppercase may be used only where natural for the active language and established label convention |
| Section Title | Section title | Dominant within the pattern but visibly subordinate to the page title; use weight and spacing before extreme scale |
| Supporting Description | Body or supporting text | Comfortable reading line height and restrained measure; must remain legible rather than excessively muted |
| Meta Information | Metadata | Compact but readable; essential state or commerce facts must not use muted treatment that reduces clarity |
| Actions | Applicable action-label role | Must inherit typography from the selected action component rather than the Section Header |

Pages must not invent local Section Title sizes, weights, or letter spacing. Excessive weight, all-capital titles, decorative type, and color-only hierarchy are prohibited.

---

## 8. Interaction rules

- The Section Header container is not interactive and must not behave like a card or large click target.
- The Section Title is text, not an implicit link. Any navigation action must be exposed as a clearly named action.
- Actions must apply to the section as a whole. Actions for individual products, orders, promotions, or records belong with those objects.
- The Primary Action must represent the highest-priority action in this Decision Region and conform to the frozen Primary Button Specification.
- A navigation action must use the appropriate link-action semantics rather than being presented as a state-changing button.
- Action order and meaning must remain stable across responsive layouts.
- Loading, disabled, focus, and feedback behaviour belong to the selected action component; Section Header must not override them.
- The pattern must not use hover, animation, or elevation to suggest that the whole header is actionable.

---

## 9. Accessibility

- The pattern must conform to the Foundation target of WCAG 2.2 Level AA.
- The Section Title must use the correct heading level for the document outline; visual size must not determine semantic level.
- When the content is a distinct section, the section should be programmatically named by its Section Title.
- Heading levels must follow a logical sequence and must not be selected for visual styling.
- DOM order must match the semantic order even when desktop layout places actions beside the content group.
- Eyebrow text must not be the only accessible name for the section.
- Supporting Description and Meta Information must remain available to assistive technology when they convey meaningful context.
- Status or meta meaning must not rely on color, iconography, position, or abbreviation alone.
- Actions must retain visible focus, accessible names, keyboard operation, and comfortable touch targets through their own component specifications.
- Text and meaningful icons must meet applicable contrast requirements in every supported theme.

---

## 10. Localization rules

- English, Thai, and Burmese must receive equal typographic and layout consideration.
- Titles, descriptions, metadata, and action labels must use natural wording and grammatical order for the active language.
- The pattern must support text expansion, script-specific line height, and different word-breaking behaviour without clipping.
- Eyebrows must not be forced to uppercase in scripts or contexts where uppercase is unavailable or unnatural.
- Fixed character limits must not determine layout. Content guidance should control concision without truncating meaning.
- Dates, times, counts, numbers, and currencies in Meta Information must use the approved locale and commerce formatting rules.
- Currency must never be inferred from page context or a regional label.
- Critical commerce or status wording must not remain as an unexplained English abbreviation in localized experiences.
- Translation must preserve the distinction between title, explanation, metadata, and action rather than combining them into one ambiguous phrase.

---

## 11. Do

- Use a clear Section Title as the dominant anchor.
- Use description or meta only when it adds useful orientation.
- Use whitespace to separate the header from adjacent content.
- Align the pattern with the section's shared content edge.
- Keep actions limited, section-level, and truthful to their outcome.
- Preserve the same hierarchy across customer and admin surfaces.
- Allow natural wrapping for localized content.
- Keep commerce-critical information in its authoritative object or confirmation context.

---

## 12. Don't

- Do not wrap the Section Header in a card or decorative container.
- Do not add a background, border, gradient, glow, or shadow merely to create hierarchy.
- Do not use the pattern as a Hero, page title, toolbar, filter bar, tab list, or navigation region.
- Do not repeat the title in the Eyebrow or Supporting Description.
- Do not place item-level controls in the action group.
- Do not add more than one Primary Action and one Secondary Action.
- Do not truncate essential title, status, count, price, or action text.
- Do not let actions visually overpower the title or critical commerce information.
- Do not use Meta Information as an unlabeled status dump or expose internal system terminology.
- Do not create page-specific spacing or typography variants.

---

## 13. Usage examples

These examples define content structure, not final interface copy or layout implementation.

| Context | Eyebrow | Section Title | Supporting Description | Meta Information | Actions |
|---|---|---|---|---|---|
| Home | Optional: “Discover” | Popular Games | Optional explanation of the current collection | Optional localized game count | Secondary navigation: “View all games” |
| Home or Promotions | Optional: “Offers” | Latest Promotions | Brief eligibility or collection context when needed | Optional end date or offer count | Secondary navigation: “View all promotions” |
| Wallet | Optional: “Account” | Wallet | Explanation of balance and transaction scope when needed | Authoritative balance with currency, if this is the correct commerce context | Primary: “Add funds”; Secondary: “View transactions” |
| Orders | Optional: “Purchases” | Recent Orders | Brief explanation only when the collection scope is not obvious | Localized order count or last-updated time | Secondary navigation: “View all orders” |
| Support | Optional: “Help” | Support | “Find answers or contact the support team.” | Optional support availability stated in customer language | Primary workflow action: “Start a support request”; Secondary navigation: “Browse FAQs” |
| Admin | Optional: operational domain | Activity | Description of the activity scope | Localized timeframe, result count, or last-updated time | Optional section-level action appropriate to the current admin task |
| Game Detail | Optional: product category | Available Packages | Brief selection guidance | Localized package count, when useful | Optional section-level action; package actions remain with each package |

If an example action only navigates, it must use link-action semantics even when positioned in the action group. Examples do not authorize a new visual variant.

---

## 14. Token dependencies

The pattern must use semantic roles rather than raw values or page-specific tokens.

| Token category | Required roles |
|---|---|
| Typography | Section title, label, body/supporting text, metadata |
| Color | Primary text, supporting text, metadata text, interactive text, focus indicator through action components |
| Spacing | Tight association, standard relationship, action gap, section-content gap, major section separation |
| Layout | Content measure, page gutter, logical alignment, responsive stack threshold |
| Actions | Primary Button tokens and the tokens of any future approved secondary or link action |
| Motion | None for the pattern itself; actions inherit approved component motion |

Section Header must not define new primitive values. Component or pattern aliases may be introduced only when they map to the approved Foundation scales and describe a stable Section Header role.

Shape, elevation, imagery, and surface tokens are not dependencies of the Section Header pattern.

---

## 15. Acceptance criteria

A Section Header is conformant only when all of the following are true:

1. It introduces one identifiable content section through a required Section Title.
2. Its hierarchy is created by typography, alignment, and whitespace rather than a card or decorative container.
3. The Section Title is visually subordinate to the page title and dominant within the pattern.
4. Every optional element adds information or a section-level action without repeating another element.
5. It contains no more than one Primary Action and one Secondary Action.
6. Actions use their appropriate component semantics and apply to the section as a whole.
7. Content precedes actions in semantic and responsive reading order.
8. Desktop, tablet, and mobile layouts preserve the same information and action priority.
9. Titles, descriptions, metadata, and action labels wrap without loss of essential meaning.
10. The correct heading level and programmatic section name are used without deriving semantics from visual size.
11. The pattern and its actions meet the Foundation's WCAG 2.2 Level AA target.
12. English, Thai, and Burmese content remains natural, legible, unclipped, and structurally equivalent.
13. Commerce prices, currency, counts, dates, and statuses follow their authoritative Foundation rules.
14. No page-specific typography, spacing, surface, shape, or decorative treatment overrides the pattern contract.
15. The pattern remains non-interactive outside its explicit actions.

---

**End of Section Header Pattern Specification. No implementation or subsequent pattern is included.**
