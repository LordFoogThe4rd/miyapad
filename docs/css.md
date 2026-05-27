# CSS Architecture

Styles are organized into 18 partial files under `src/css/`, imported via `src/styles.css`. Each partial targets a specific component or logical group.

## Import Order

The ordering in `src/styles.css` is intentional — variables and base reset load first, then component-specific partials, then utilities and responsive overrides last.

```
@import './css/_variables.css';         # CSS custom properties (colors, spacing, fonts)
@import './css/_base.css';              # Reset, body, typography, scrollbar
@import './css/_prompt-overlay.css';    # Prompt textarea overlay for log-probs
@import './css/_probs.css';             # Token probability visualization
@import './css/_widget.css';            # Sidebar widgets (stats, presets)
@import './css/_search-replace.css';    # Search & replace modal
@import './css/_modal.css';             # Generic modal shell
@import './css/_world-info.css';        # World Info / lorebook modal
@import './css/_logit-bias.css';        # Logit bias editor modal
@import './css/_horde.css';             # AI Horde status/settings
@import './css/_sidebar.css';           # Main sidebar layout
@import './css/_sessions.css';          # Sessions management modal
@import './css/_form-controls.css';     # Inputs, selects, labels, sliders
@import './css/_buttons.css';           # Button variants and icon buttons
@import './css/_context-menu.css';      # Right-click context menu
@import './css/_crash-screen.css';      # Error/ crash overlay
@import './css/_utilities.css';         # Helper classes (hidden, sr-only, etc.)
@import './css/_responsive.css';        # Global media queries
```

## Partial Reference

| File | Purpose |
| :--- | :------ |
| `_variables.css` | CSS custom properties: color palette, font stacks, spacing scale, border radii, z-index layers, transition timings. |
| `_base.css` | Element reset, body defaults, scrollbar styling, link styles, selection colors. |
| `_prompt-overlay.css` | Transparent overlay on the prompt textarea for rendering log-probability highlights. |
| `_probs.css` | Token probability bar chart and hover tooltip styles used in the log-probability viewer. |
| `_widget.css` | Sidebar information widgets (token counters, generation stats, quick presets). |
| `_search-replace.css` | Find-and-replace text modal. |
| `_modal.css` | Shared modal container: backdrop, dialog box, header/body/footer sections. |
| `_world-info.css` | World Info entry editor: entry cards, key fields, filtering and search. |
| `_logit-bias.css` | Logit bias slider and token selector interface. |
| `_horde.css` | AI Horde integration panel: queue status, worker info, settings. |
| `_sidebar.css` | Main sidebar layout: width, collapse states, drag resize, scroll. |
| `_sessions.css` | Sessions browser modal: session cards, search bar, sort controls, action buttons. |
| `_form-controls.css` | Shared form element styling: text inputs, selects, checkboxes, radio buttons, range sliders, number inputs. |
| `_buttons.css` | Button styles: primary, secondary, icon-only, danger variants, disabled states. |
| `_context-menu.css` | Right-click context menu: positioning, item hover, separator. |
| `_crash-screen.css` | Full-screen error crash overlay with stack trace display. |
| `_utilities.css` | Simple utility classes (e.g. `.hidden`, `.sr-only`, `.flex`, `.text-muted`). |
| `_responsive.css` | Global media queries for layout breakpoints, sidebar collapsing, font sizing on small screens. |

## Theming

Dynamic themes are injected at runtime via a custom CSS injector element. Themes can override any CSS custom property defined in `_variables.css`. Theme storage uses the same adapter pattern as sessions and templates (see [Architecture](architecture.md)).

## Conventions

- Component-specific media queries live inside the partial for that component.
- Only global layout media queries go in `_responsive.css`.
- When adding new styles, put them in the matching partial or create a new one if none fits.
- Class names use kebab-case.
- Avoid `!important` — use specificity or utility classes instead.
