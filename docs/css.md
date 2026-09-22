# CSS Architecture

Styles are split into 22 partial files under `src/css/`, imported by `src/styles.css`. Each partial covers one component or one logical group.

## Import Order

The order in `src/styles.css` matters. Variables and the base reset load first, then the component partials, and utilities and responsive overrides come last.

```
@import './css/_variables.css';         # CSS custom properties (colors, spacing, fonts)
@import './css/_base.css';              # Reset, body, typography, scrollbar
@import './css/_probs.css';             # Token probability visualization
@import './css/_widget.css';            # Sidebar widgets (stats, presets)
@import './css/_search-replace.css';    # Search & replace modal
@import './css/_modal.css';             # Generic modal shell
@import './css/_world-info.css';        # World Info / lorebook modal
@import './css/_logit-bias.css';        # Logit bias editor modal
@import './css/_horde.css';             # AI Horde status/settings
@import './css/_sidebar.css';           # Main sidebar layout
@import './css/_sessions.css';          # Sessions management modal
@import './css/_statistics.css';        # Statistics modal
@import './css/_form-controls.css';     # Inputs, selects, labels, sliders
@import './css/_buttons.css';           # Button variants and icon buttons
@import './css/_context-menu.css';      # Right-click context menu
@import './css/_crash-screen.css';      # Error / crash overlay
@import './css/_utilities.css';         # Helper classes (hidden, sr-only, etc.)
@import './css/_quick-switcher.css';    # Quick Switcher overlay
@import './css/_connections.css';       # Connection Manager presets UI
@import './css/_sampler-presets.css';   # Sampler Preset Manager UI
@import './css/_markdown-decorations.css'; # Markdown decorations in the prompt editor
@import './css/_responsive.css';        # Global media queries
```

## Partial Reference

| File | Purpose |
| :--- | :------ |
| `_variables.css` | CSS custom properties: color palette, font stacks, spacing scale, border radii, z-index layers, transition timings. |
| `_base.css` | Element reset, body defaults, scrollbar styling, link styles, selection colors. |
| `_probs.css` | Token probability bar chart and hover tooltip used in the log-probability viewer. |
| `_widget.css` | Sidebar information widgets (token counters, generation stats, quick presets). |
| `_search-replace.css` | Find-and-replace text modal. |
| `_modal.css` | Shared modal container: backdrop, dialog box, header/body/footer sections. |
| `_world-info.css` | World Info entry editor: entry cards, key fields, filtering and search. |
| `_logit-bias.css` | Logit bias slider and token selector interface. |
| `_horde.css` | AI Horde integration panel: queue status, worker info, settings. |
| `_connections.css` | Connection Manager modal: sidebar/detail layout, model list, error messages, mobile-responsive toggle. |
| `_sampler-presets.css` | Sampler Preset Manager modal: sidebar/detail layout, import/export actions, mobile-responsive toggle. |
| `_markdown-decorations.css` | Markdown decoration classes (`.pm-md-*`) rendered inside the ProseMirror prompt editor in wysiwyg mode. |
| `_sidebar.css` | Main sidebar layout: width, collapse states, drag resize, scroll. |
| `_sessions.css` | Sessions modal: the session table and its folder rows, the toolbar, the slot above the list for the selection bar, folder box and drop zone, and the row action buttons. |
| `_statistics.css` | Statistics modal: section headers with their Reset buttons, the counter tables, and the per-session name line. |
| `_form-controls.css` | Shared form element styling: text inputs, selects, checkboxes, radio buttons, range sliders, number inputs. |
| `_buttons.css` | Button styles: primary, secondary, icon-only, danger variants, disabled states. |
| `_context-menu.css` | Right-click context menu: positioning, item hover, separator. |
| `_crash-screen.css` | Full-screen error crash overlay with stack trace display. |
| `_utilities.css` | Utility classes (`.hidden`, `.sr-only`, `.flex`, `.text-muted`). |
| `_quick-switcher.css` | Quick Switcher overlay: backdrop, floating panel, search input, results list. |
| `_responsive.css` | Global media queries for layout breakpoints, sidebar collapsing, font sizing on small screens. |

## Theming

Themes are injected at runtime through a custom CSS injector element, and can override any custom property defined in `_variables.css`. Theme storage uses the same adapter pattern as sessions and templates (see [Architecture](architecture.md)).

## Conventions

- Component-specific media queries live inside the partial for that component.
- Only global layout media queries go in `_responsive.css`.
- New styles go in the matching partial. If none fits, start a new one.
- Class names use kebab-case.
- Avoid `!important`. Use specificity or utility classes instead.
- Use `overflow-wrap` rather than `word-break` for text wrapping; `word-break: break-word` is deprecated.
