# UI refresh
- Logo centering fixed (block SVG now centred with auto margins; invalid gradient id `lglogo big` replaced).
- Login + home header redesigned: flatter, hairline borders, softer shadows, no dot-grid (kept only for CEPALCO).
- Stats are an inline strip; header actions are ghost buttons; theme swatches moved into a Theme menu.
- 11 themes: Classic, Dark, Midnight, Graphite, Ocean, Forest, Lavender, Sunset, Sand, Pink, CEPALCO.
  Add one by: a `.th-name{...}` block in style.css, an entry in `THEMES` in auth.js and netlify/functions/api.mjs, and a swatch button.
- Shared-mode accent is now a per-theme token (`--sec`).

# Profiles
- Click anyone in the chat's people list (online or offline) or a message's name/photo to open their profile.
- Offline people now appear in the list (new `offUsers` in `GET /api/chat`); `GET /api/profile/<id>` returns the profile.
- Profile settings has "Hide my profile from other users" (`POST /api/profile-visibility`, stored as `profileHidden`).
  Hidden = others see only name + role and no photo; the owner and Heads still see everything.

# Overview fix
- `overview.html`: the stats strip is now a direct child of the header (it was nested in the toolbar), and `style.css` lets the filters and user chips span the full header width. The two-column header grid had squeezed them into a narrow column.
- Mobile: the Calendar / List / Completed tabs no longer wrap.
