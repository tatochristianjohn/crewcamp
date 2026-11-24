# CrewCamp design file

Single source of truth for look and feel. Read this before changing any UI.

## Intent
CrewCamp is a work tool (calendars, tasks, chat for a team), not a landing page. It should feel calm, readable and a little warm, never like a generated template.

## Colour
- Brand blue `#2f66b8` is the default accent (`--pri`). It matches the logo blue `#4a7fc4`.
- Shared calendar accent is teal `#0d9488` (`--sec`).
- No purple/indigo defaults and no gradients anywhere in the default UI. Logo and icons are flat fills.
- Opt-in themes (Lavender, Pink, Sunset, etc.) stay as user choices; they are never the default.
- Priority dots use flat red / yellow / green via `.pd`, not coloured emoji.

## Type
- Headings: Fredoka. Body: Quicksand. Sticky-note text: Architects Daughter (notes only).
- Do not add Inter/Roboto/Arial as a "safe" font.

## Icons
- No emoji as UI icons. Use the inline SVG set in `public/icons.js` (Lucide-style, 2px stroke, `currentColor`).
- `icons.js` converts mapped emoji in UI text automatically. To add an icon, add a path to `P` and a mapping to `M`.
- Emoji are allowed only where a person typed them (chat messages, posts, reaction picker). `icons.js` skips those.

## Copy
- Headlines say what the thing does: "Calendars and tasks for your team", not slogans.
- No version numbers in the header. No placeholder or invented testimonials, stats or logos.

## Layout and motion
- No three-identical-cards rows. Header stats are a plain inline strip; Personal/Shared is a two-way switch.
- No scroll-triggered fade-ins. Motion is limited to modal/popover open (`pop`, `sheet`, ~0.2s) and is disabled under `prefers-reduced-motion`.

## Components
- One button family (`.btn`, `.mini`, `.x`), one control height (`--ctl: 44px`), one radius (`--r: 12px`).
- Colours come from CSS variables in `style.css`; never hard-code a hex in a component.

## Review checklist (run before merging UI work)
1. Screenshot every page at phone width and desktop width.
2. Check each page in at least one dark theme.
3. Grep for `gradient`, `#6366f1`, and new emoji in markup.
4. Compare the screenshot against this file, fix, repeat.

---

# Changes in this pass (13-rule audit)

| # | Rule | Result |
|---|------|--------|
| 1 | Kill the purple gradient | Default accent `#6366f1` replaced by brand blue `#2f66b8` in CSS and JS fallbacks. Cross-server icon pink/indigo gradient made flat. Midnight theme accent moved from violet to sky blue. Lavender kept as an explicit opt-in theme. |
| 2 | Choose real fonts | Already Fredoka / Quicksand / Architects Daughter. Kept and documented. |
| 3 | Delete the template chrome | Removed the `v2.13.2` version string from the header. |
| 4 | Break the three-card row | No card rows exist; header stats are an inline strip. Documented as a rule. |
| 5 | Swap emoji for icons | New `public/icons.js` swaps about 50 UI emoji for inline SVG across all 8 pages, including dynamically rendered content. Priority dots become flat CSS dots. Chat and post text, inputs and the reaction picker are skipped. Emoji inside `<option>` elements are removed (they cannot hold SVG). |
| 6 | Real photos and screens | Not applicable (internal app, no marketing imagery). |
| 7 | Specific headline | Tagline "your coworking camp!" became "Calendars and tasks for your team" on index, login and register. |
| 8 | Cut scroll fade-ins | None existed; only short modal open animations, already reduced-motion safe. |
| 9 | Remove fake testimonials | None found. |
| 10 | Remove builder leftovers | Removed version string and the logo's gradient `<defs>`. No generator tags found. |
| 11 | Show it sites you like | Process step; add reference links to this file when you have them. |
| 12 | Keep a design file | This `DESIGN.md`. |
| 13 | Screenshot its work | Not possible in this environment (no browser). Checklist step added above. |

## Known limits
- Emoji set through `title=` / `aria-label=` attributes and in `<option>` text are not converted; options are stripped instead.
- `🎉` toasts, and chat emoji (`🙂 😂 👍 ❤️ 🔥` etc.) were deliberately left as emoji because they are expressive, not chrome.
- `npm test` shows the same 7 failures (Google sign-up tests) before and after; the backend was not touched.
- I could not open the pages in a browser here, so please eyeball icon alignment on buttons once.

## Games (chess)
Rail button "Games" sits under "Add a server" and opens `games.html`. Chess styles live in `chess.css` and use only theme variables (board squares are `color-mix` of `--pri` and `--panel`). No emoji icons except the chess glyphs, which are text symbols.
