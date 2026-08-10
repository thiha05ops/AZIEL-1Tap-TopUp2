# AZIEL Design System — Primary Button Specification

**Version:** 1.0  
**Status:** Final and Frozen  
**Roadmap position:** Phase 1 — Interaction Primitives; first component family  
**Foundation:** AZIEL Design System Foundation v1.0 (frozen)

---

## 1. Selected family and dependencies

The selected family is **Primary Button**.

It represents the highest-priority action available in a decision region. It depends only on the frozen Foundation rules for color, typography, layout and spacing, motion, interaction states, accessibility, and commerce. It has no component dependencies. Secondary Button, Destructive Button, Icon Button, Link Action, Button Group, and feedback components are related future specifications, not variants of this component.

In this specification, **must**, **should**, and **may** carry the normative meanings defined by the Foundation.

A **Decision Region** is a visually and semantically coherent part of an experience in which the user evaluates related information and chooses what to do next. A form, dialog, checkout step, operational panel, or independently actionable list item may be a Decision Region. Visual proximity alone does not create a separate Decision Region.

---

## 2. Existing implementation audit

### 2.1 Public surfaces

| Current family | Representative locations | Current form | Key inconsistencies | Migration disposition |
|---|---|---|---|---|
| Generic primary | `frontend/css/theme/aziel-design-system.css`, `frontend/css/theme/aziel-theme.css` | Filled gradient `.btn-primary` layered on `.btn` | Duplicate definitions; raw white; hover lift and heavy shadow are stronger than the minimalist language; incomplete focus, pressed, loading, and disabled contract | Replace with the canonical Primary Button |
| Authentication submit | Login, registration, verification, and password recovery through `.auth-main-btn` | Large, full-width gradient submit | Independent 54 px height, 16 px radius, very heavy label, shadow, and partial state model | Merge as Large or Standard full-width Primary Button |
| Game commerce action | Nine game pages and shared payment UI, including `#confirmPackagePanel`, `#confirmPaymentOrderBtn`, and `#trackOrderBtn` | Confirm, payment, waiting, and tracking actions | Selectors are ID-driven; duplicate game markup; 52 px and local padding-based sizes coexist; a disabled waiting control pulses; literal colors and multiple radii appear | Merge true principal actions; reclassify status-only or navigation controls by semantics |
| Wallet and evidence submit | Wallet top-up and manual slip flows through `.wallet-submit-btn` and `.wallet-submit-slip-btn` | Full-width generate/submit actions | Pill and local modal treatments conflict; repeated overrides; loading and disabled behavior are locally defined | Merge as Standard/Large full-width Primary Button |
| Support, account, and tracking | `.support-submit-btn`, `.primary-btn`, `.security-btn`, `#trackBtn`, refund submission controls | Form submit, save, track, and refund actions | Heights, radii, shadows, margins, and state coverage differ; unrelated controls share styling; IDs carry presentation | Merge principal actions; move non-principal actions to their future families |
| Trust and policy calls to action | About, Contact, and policy pages through `.trust-btn.primary` and `.policy-btn` | Link styled as a primary action | Button and navigation semantics are visually conflated | Migrate navigation to Link Action unless the action changes state in the current context |

### 2.2 Admin surfaces

| Current family | Representative locations | Current form | Key inconsistencies | Migration disposition |
|---|---|---|---|---|
| Admin primary | Admin dashboard and upload/save flows through `.admin-primary-btn` | Compact gradient command | 38 px visual target, admin-only tokens, hover and focus merged, toggle state allowed through `aria-pressed`, and incomplete loading presentation | Merge principal commands; migrate toggles to Toggle or selection controls |
| Order primary action | Admin order and wallet operations through `.order-primary-action` | Compact solid accent action | Separate selector and fill; shares a rule with danger actions; size and state behavior differ from public controls | Merge eligible non-destructive principal commands |
| Settings save | Admin settings through `.admin-save-btn` and `.save-settings-btn` | Wide gradient save action | Multiple class families, hard-coded minimum width and colors, different radius and shadow | Merge as Standard Primary Button with layout-controlled width |
| Design Studio primary | Design Studio through `.ds-primary-button` | Compact tool command | Separate token vocabulary, 38 px control, translucent/gradient styling, and tool-specific interaction rules | Merge only commands with primary action priority; keep tool selection outside this family |

### 2.3 Audit conclusion

The product already uses a recognizable filled purple primary action, and principal actions are usually labeled and placed near their workflow. The weakness is not absence but fragmentation: selector names encode pages, sizes range from compact admin controls to 54 px public submits, radii range from moderate to pill, gradients and shadows vary, and state behavior is incomplete or contradictory. Some links, toggles, waiting indicators, and secondary actions currently borrow primary styling despite different semantics.

---

## 3. Purpose

Primary Button triggers the single most important, non-destructive action in the user's current decision region. It creates unmistakable action priority without relying on decorative containers or excessive visual effects.

It does not communicate status, act as a passive progress indicator, navigate as an ordinary link, or represent a destructive decision.

---

## 4. Usage

- A Decision Region must contain no more than one Primary Button. The same action may be mirrored for responsive placement only when every instance has the same label, state, and outcome.
- A page may contain multiple Primary Buttons only when each belongs to a clearly separate, independently understood decision region.
- Repeated desktop and mobile placements of the same action must share one label, state, and outcome.
- The component must be used for the highest-priority action in its Decision Region, whether that action changes state, retrieves information, opens the required next context, confirms a selection, or advances a defined workflow.
- Navigation should use Link Action. Destructive actions must use Destructive Button. Icon-only actions must use Icon Button.
- A primary action must not be introduced merely to add visual emphasis.

For commerce, the label must describe the actual commitment. An action that only submits payment evidence must not imply that payment has been approved. Before a financially consequential action, the confirmation context must summarize the product, account destination, authoritative final payable amount, charge currency, and payment method according to Foundation commerce rules. This information belongs in the surrounding confirmation context, not inside the button.

---

## 5. Anatomy

1. **Container** — provides the semantic action target, shape, fill, and state treatment.
2. **Label** — required, concise text naming the action.
3. **Supporting icon** — optional leading or trailing icon that reinforces, but never replaces, the label.
4. **Progress indicator** — optional temporary indicator used only during an in-progress action.
5. **Focus indicator** — required visible boundary for keyboard focus; it must remain distinguishable from the container and surrounding surface.

Badges, prices, status labels, counters, multiple icons, subtitles, and arbitrary imagery must not appear inside a Primary Button.

---

## 6. Variants

Primary Button has one semantic variant: **default primary action**.

The following are permitted treatments, not separate semantic variants:

- **Label only** — default treatment.
- **Leading icon** — for a familiar action symbol that improves recognition.
- **Trailing icon** — only when it clarifies progression or an external transition.
- **Full width** — a layout treatment for constrained forms, sheets, and small screens.

Commerce, submit, confirm, save, and admin actions must not gain different visual variants solely because of their domain. Destructive, tonal, outline, link, icon-only, toggle, and status treatments are explicitly outside this family.

---

## 7. Sizes

| Size | Visual height | Minimum interactive target | Intended use |
|---|---:|---:|---|
| Compact | 36 px | 44 × 44 px | Space-constrained admin toolbars only; the target must be enlarged without crowding adjacent controls |
| Standard | 44 px | 44 × 44 px | Default across public and admin workflows |
| Large | 52 px | 52 × 52 px | High-confidence form completion, checkout steps, sheets, and narrow-screen full-width actions |

Horizontal inset must use the corresponding control-spacing token and preserve a label-first silhouette. Width is content-driven by default and controlled by the parent layout when full width. Arbitrary minimum widths and pill geometry must not define action importance. Labels should remain on one line; when localization makes this impossible, the control may grow vertically and must not clip, truncate, or reduce its target.

---

## 8. States

| State | Required behavior |
|---|---|
| Default | Uses the primary action fill and on-action content color with no unnecessary elevation |
| Hover | Provides a restrained, non-layout-shifting visual change only on hover-capable devices |
| Pressed | Provides immediate tactile feedback without changing dimensions or moving surrounding content |
| Focus-visible | Shows a persistent, high-contrast focus indicator independent of hover; focus must never be removed without an equivalent replacement |
| Disabled | Is visibly unavailable, cannot activate, and retains a readable label; disabling must not be the only explanation of why action is unavailable |
| Loading | Prevents repeated activation, exposes busy state to assistive technology, preserves its footprint, and communicates that the named action is in progress |

Selected, error, and success are not Primary Button states. Selection belongs to choice controls. Action errors and success must be communicated by the appropriate feedback pattern while the button returns to the correct actionable or completed condition. A waiting or passive status must not be rendered as a pulsing Primary Button.

### 8.1 State precedence

When states coincide, the component must apply this precedence from highest to lowest:

1. **Loading** — suppresses activation, pressed, hover, and disabled visual treatment while preserving focus visibility when focus remains on the control.
2. **Disabled** — suppresses pressed and hover behavior while retaining the required unavailable presentation.
3. **Pressed** — overrides hover during active input.
4. **Hover** — applies only when the control is enabled, not loading, and the device supports hover.
5. **Default** — applies when no higher-priority state is present.

**Focus-visible** is additive rather than exclusive. It must remain visible over every state in which focus is retained and must never be hidden by loading, disabled, hover, or pressed treatment.

---

## 9. Content rules

- Labels must describe the immediate action and outcome in natural wording for the active language. English should use clear verb-led labels such as “Save changes,” “Submit receipt,” or “Confirm order”; Thai and Burmese must use natural grammatical order rather than imitate English syntax.
- Labels should be concise and use the capitalization and writing conventions appropriate to the active language.
- “Continue” may be used only when the next step is already clear from the surrounding sequence.
- Labels must not use vague text such as “Click here,” “OK,” or “Yes” when a specific outcome can be named.
- Labels must not end with punctuation or use all capitals for emphasis.
- A loading label must retain the action context, such as “Submitting receipt,” rather than use a context-free “Loading.”
- Translated labels may expand; wording and layout must not depend on a fixed character count.
- Financial labels must not overstate finality. “Submit payment” and “Payment approved” are not interchangeable.

---

## 10. Interaction behavior

- The control must activate through pointer/touch and the platform's standard keyboard button inputs, including Enter and Space.
- One intentional activation must initiate at most one action. An asynchronous action must become loading before a second activation can be accepted.
- A financially consequential action must use an idempotent operation contract. Retry, recovery, reconnection, or repeated presentation of the action must not create a duplicate charge, order, refund, or other financial operation.
- Loading must end in an explicit success, error, navigation, or restored actionable state; it must not persist indefinitely after the operation settles.
- Focus should remain predictable after activation. If the action opens a modal or sheet, focus must move into it; if it produces inline feedback, focus must remain on the action unless the error requires focus at the failing field or message.
- Disabled controls must not receive activation. When users need to understand prerequisites, nearby text or validation must provide the reason.
- Hover-only disclosure is prohibited. Press feedback must respect reduced-motion preferences.
- A native link must not be assigned button behavior merely to match the Primary Button appearance.

---

## 11. Accessibility

- The component must conform to WCAG 2.2 AA as required by the Foundation.
- It must expose native button semantics for actions and a programmatically determinable accessible name matching the visible label.
- Text, icons, fill, focus indicator, and state changes must meet applicable contrast requirements in every supported theme and state.
- Color, opacity, motion, or iconography alone must not communicate availability or progress.
- The interactive target must meet the size rules above and remain operable at supported zoom, text enlargement, and reflow settings.
- Decorative icons must be hidden from assistive technology. A meaningful icon must not introduce a conflicting accessible name.
- Loading must expose a busy state and announce material progress or completion through the surrounding workflow without repeatedly interrupting the user.
- Disabled state must be programmatically available. The selected implementation method must preserve the intended focus and explanation behavior.
- Motion must be restrained and reduced or removed when the user requests reduced motion.

---

## 12. Responsive behavior

- Size does not change solely at a breakpoint; it changes only when the workflow and available space justify it.
- In narrow form, checkout, modal, or sheet layouts, the Primary Button should become full width when that improves reach and action clarity.
- In wider layouts, it should remain content-width and align with the decision region rather than stretch decoratively.
- A sticky bottom placement may be used for a persistent principal action, but must respect safe areas, avoid covering content, and remain synchronized with any repeated action.
- Label and icon order must remain stable across viewport sizes.
- The visible label must not collapse to icon-only on small screens.

---

## 13. Token dependencies

The component must consume semantic tokens rather than page, domain, or raw color values.

| Token role | Required dependency |
|---|---|
| Color | Primary action fill for default, hover, and pressed; on-primary content; disabled content/fill; focus indicator |
| Typography | Action-label family, size, weight, line height, and tracking for Compact, Standard, and Large |
| Layout and spacing | Control heights, horizontal insets, icon gap, minimum target, and full-width layout behavior |
| Shape | Canonical control radius; Primary Button must not introduce page-specific or pill radii |
| Motion | Short state-transition duration, standard easing, press feedback, and reduced-motion treatment |
| Iconography | Size and stroke relationship appropriate to each control size |

Elevation is not a default dependency. It may be used only when the surrounding surface requires separation and must remain subordinate to hierarchy created by typography, spacing, and action color.

---

## 14. Do and Don't

### Do

- Use one clearly labeled Primary Button for the principal action in a decision region.
- Match the label to the immediate and truthful outcome.
- Preserve a stable footprint during loading.
- Provide complete keyboard, focus, disabled, and loading behavior.
- Keep public and admin actions on the same semantic contract.
- Put final payable amount and currency near consequential commerce confirmation.

### Don't

- Do not use a Primary Button as decoration, a passive status, or a selected filter.
- Do not style ordinary navigation, icon-only controls, or destructive actions as Primary Button.
- Do not create page-specific gradients, shadows, radii, or sizes.
- Do not place competing Primary Buttons in one decision region.
- Do not disable without explaining unresolved prerequisites or validation.
- Do not use perpetual pulse, lift, or glow to manufacture importance.
- Do not claim that payment is complete when the action only submits evidence for review.

---

## 15. Migration notes

1. Inventory each current control by semantics before replacing its class. Do not migrate solely by visual similarity.
2. Consolidate eligible `.btn-primary`, `.auth-main-btn`, `.wallet-submit-btn`, `.wallet-submit-slip-btn`, `.support-submit-btn`, `.primary-btn`, `.admin-primary-btn`, `.order-primary-action`, `.save-settings-btn`, and `.ds-primary-button` uses into the canonical family.
3. Map public form and payment-sheet submits to Standard or Large; map eligible admin toolbar commands to Compact only when the 44 px interactive target is preserved.
4. Remove page-owned dimensions, raw colors, gradients, shadows, radii, transitions, and margins after the canonical component owns those concerns. Parent layout must own external spacing and width.
5. Reclassify link destinations such as trust and policy calls to action as Link Action. Reclassify toggle, waiting/status, destructive, secondary, and icon-only controls into their correct future families.
6. Replace ID-based visual rules on game and tracking surfaces with the shared component contract while retaining IDs only where behavior requires them.
7. Preserve existing workflow outcomes, event wiring, localization keys, permissions, idempotency guards, and commerce confirmation logic during migration.
8. Verify each migrated control in default, hover, pressed, focus-visible, disabled, loading, error-return, and reduced-motion conditions before retiring its legacy selector.

Migration must be incremental. A surface must not mix a partially migrated Primary Button with legacy overrides that alter the canonical contract.

---

## 16. Acceptance criteria

A Primary Button specification or implementation is conformant only when all of the following are true:

1. The control represents the single highest-priority non-destructive action in its decision region.
2. It uses native action semantics and has a visible, programmatically determinable, outcome-specific label.
3. It uses only the defined semantic variant, permitted icon treatments, and Compact, Standard, or Large size.
4. Its interactive target is at least 44 × 44 px, including Compact usage.
5. Default, hover, pressed, focus-visible, disabled, and loading states are complete and do not shift surrounding layout.
6. Keyboard, pointer, touch, zoom, reflow, text enlargement, and reduced-motion use meet the Foundation's WCAG 2.2 AA target.
7. An asynchronous action cannot be submitted repeatedly and always reaches an explicit terminal UI state.
8. The component consumes semantic tokens and contains no page-specific color, radius, shadow, size, or motion rule.
9. Full-width behavior is controlled by layout context and does not create a new semantic variant.
10. Commerce labels and the surrounding confirmation context truthfully represent the immediate action, product, account destination, authoritative final payable amount, charge currency, payment method, and verification state.
11. Links, destructive actions, icon-only actions, selection controls, and passive statuses are not represented as Primary Button.
12. Public, admin, and Design Studio uses follow the same anatomy, state, content, accessibility, and responsive contract.
13. Financially consequential actions are idempotent across activation, retry, recovery, and reconnection.

---

**End of Final and Frozen Primary Button specification. No subsequent Phase 1 component is specified here. This document must not change unless the Foundation changes.**
