# UX/UI feedback (Prompify comments.pdf) — what shipped, and what still needs testing

Reported by tester (patcharada), 9 items. Traced, fixed and committed 2026-08-10 on
`feat/persistence-on-euleros`. **Typecheck 0 errors, lint 0 errors, production build passes.**

> ⚠️ **Nothing below has run in a browser or against Postgres.** This is a static-verification
> pass only. The VM deploy is the first real test — the checklist at the bottom is the thing to
> walk through, in that order.

---

## What was wrong, and what changed

### 6. Data admin: no delete, column-less tables, no way to add columns — **fixed, untested SQL**
Three separate gaps:
- `CreateTableModal.tsx` filtered to named columns but never checked the result was non-empty, so
  `columns: []` was POSTed and the server created a table with only the auto-managed
  `id`/`created_at`/`updated_at` → showed as "0 cols", and Add Row (which hides those) dead-ended
  on `No valid columns to insert`.
- `api.data.$chatId.schema.ts` implemented only GET-list and POST-create. No DROP, no ALTER
  anywhere — which is why delete-table and add-column-later did not exist.

Changes:
- `api.data.$chatId.schema.ts` now dispatches on method: `PATCH` (add/drop columns),
  `DELETE ?table=x` (drop table). Same auth + ownership guard as create; identifier, reserved-name
  and default-value validation reused verbatim.
- The physical table name always resolves through the `app_tables` registry, never from the
  request, so a caller cannot address a table it does not own.
- `app_tables.columns` is rewritten on every ALTER. This matters: the registry — not Postgres
  introspection — is what both the admin UI and `getSchemaContext` read, so a stale registry
  would silently desync the grid *and* the AI's schema context.
- `ADD COLUMN NOT NULL` without a default is rejected with a plain-English reason rather than a
  raw PG error.
- UI: per-card delete with type-the-name confirm; `AddColumnModal.tsx` (new) reached from an Add
  Column toolbar button; Add Row disabled with a reason when there is nothing to insert; an
  empty-state that offers "Add a column" instead of the dead-end toast.
- All DDL is gated on `platformMode` — the endpoint targets the platform schema, so offering it
  against a user's own Supabase would hit the wrong database.

### 5. Preview error persisted after recovery — **root cause fixed, may not cover their exact case**
Alerts were enqueued but nothing ever invalidated them; `clearAlert()` only shifts the queue head,
so the sole clearers were the user's own Dismiss and the Problems buttons.

Added `workbenchStore.clearAlertsBySource()` and `resolveBySource()` (marks errors fixed rather
than deleting, so Problems keeps the history), called on the not-ready→ready transition and on
manual reload.

**Caveat — read before testing.** `ready` goes false→true on a dev-server restart or an explicit
refresh cycle, and the fix fires on both. It does *not* fire on a full browser refresh, where
`ready` starts `true` — but it needn't, because `#alertQueue` initialises empty in production, so
a page reload already wipes alerts. That means what the tester saw after refreshing was either a
*new* error, or the auto-fix's injected chat message (`Chat.client.tsx:762-772`), which is
persisted transcript and stays **by design**. If the report was about the transcript, this is not
fixed and was never a bug.

### 1. Auth modal unreadable orange — **fixed by calculation, unverified visually**
Brand `#f97316` used as *text*: ~2.2:1 on the panel. Worse, a "glassmorphism" block dropped the
panel to `rgba(255,255,255,0.55)`, so the effective surface — and therefore the contrast —
depended on whatever scrolled behind it.

- New `--prompify-accent-text: #9a3412` (orange-800) for every orange *string* on a light surface:
  modal h2, footer links/buttons, required marker, password "Show", secondary submit. `#f97316`
  stays for fills, where white-on-orange already passes. ≈5.8:1.
- Panel raised to 0.92 opacity so contrast is a fixed, testable number.
- The faint password checklist (0.42 alpha, ~2.65:1) and hints (0.48) raised to 0.62 → ~4.9:1;
  placeholder 0.35 → 0.5.

**Not done:** `landing.css` still has zero dark-mode rules. Making the panel opaque fixes the
reported contrast in both themes; a proper dark treatment needs eyes on it and is a follow-up.

### 3. Controls unreadable in dark mode — **partly fixed, one item unexplained**
- *Style-picker card:* `bg-bolt-elements-bg-depth-2` **is not a real utility** — the token is
  registered as `background.depth.2` (`uno.config.ts:122-127`), so the cards had no background at
  all and inherited whatever was behind them. Same dead class in `FillBlanks.tsx:48`. Both fixed;
  swept the tree for others (remaining hits are `var(--bolt-elements-bg-depth-N)`, which is the
  correct variable name).
- *Brand icons:* the 10 `/icons/brands/*.svg` are single-colour `fill="currentColor"` glyphs
  loaded through `<img>`, which cannot inherit page colour — `currentColor` resolved to black on a
  dark card. Now rendered as CSS masks so they take the theme's text colour. Nothing is lost;
  verified all 10 are single-colour.
- *Restore button:* given a proper pill (`item-backgroundActive` + `contentActive`) instead of
  bare low-contrast text whose hover surface was *darker* than the row it sat on.
- 🔴 *Workspace dropdown:* **UNRESOLVED.** An earlier note claimed `95af32d` had already fixed
  this — that claim was wrong. The pre-fix code used `background-depth-1` + `textPrimary/Secondary`,
  theme tokens that read correctly in both modes, so it does not explain the blank row in the
  screenshot. The row looks *empty*, not low-contrast, which points at data rather than colour —
  but `companies.name` is `NOT NULL` and personal workspaces seed as `'Personal'`, so that theory
  doesn't close either. **Needs a full-resolution screenshot and the prod commit hash.**

### 4. Orange border "not all the way round" — **fixed**
Not a border: an always-on SVG (`BaseChat.tsx`) whose stroke was `dasharray: 35px 65px`. Upstream
animates that dash while generating; this branch had neither keyframes nor a conditional render,
so it was a frozen arc over ~a third of the perimeter. SVG and the three SCSS rules deleted — the
box already has a real `border-bolt-elements-borderColor`.

### 2. `Free` badge outside the dropdown — **fixed**
`UserProfile.tsx`: the email `<p>` sat in a fixed `w-56` flex row with no `min-w-0`. A flex item
defaults to `min-width:auto` and refuses to shrink below its content, so a long email pushed the
`shrink-0` badge past the panel edge, which had no `overflow-hidden`. Added `min-w-0 truncate` +
`title`, widened to `w-64`, gave the tier a real chip style.

### 7. Supabase connect step had no back button — **fixed, approach changed**
The original plan was "add a Back button". That would not have worked: `handleDisconnect` cleared
`platformMode`, `savedConfig` and `tables` *before* showing the form, so Back had nothing to
return to.

Instead: navigating to the connect form no longer tears down the connection
(`handleShowConnectForm`), so Back is trivially safe. The real disconnect is now an explicit
labelled button inside the form. The bare Supabase-mark icon — an unlabelled control that silently
killed your connection, and *how* people got stranded — is now labelled "Use my own Supabase".

### 8. Toggles look wrong — **fixed**
`Switch.tsx`: the **off** track was `button-primary-background`, which in dark theme resolves to
`accent.500` — brand orange. On was `accent.400`. Two shades of the same orange, so nothing read
as off. Off is now a neutral track, on is solid `accent-500`. Shared component: this fixes every
toggle in Settings at once, so give the Settings tabs a look after deploying.

### 9. Awkward gap above the preview — **fixed, scope reduced**
The panel was `top-[calc(var(--header-height)+1.5rem)] bottom-6 mr-4` inside a further
`px-2 lg:px-6` — a 24px dead band under the header plus 24px sides and bottom. Now flush under the
header, `bottom-0`, `px-0 lg:px-2`.

The plan also proposed an in-app maximize toggle. **Dropped — it already exists.**
`--workbench-inner-width: 100%` / `--workbench-left: 0` are already driven by `data-chat-visible`,
which the header's Chat/Code toggle sets. Building a second control would have been redundant UI.

---

## Test checklist for the VM (in this order)

**First — settle the open question:** `git log --oneline -1` on prod before deploying. That tells
us whether item 3a was ever fixed, and whether any of this feedback was already closed.

**Data admin (item 6) — the only new SQL, test it first, on a throwaway chat:**
- [ ] Create a table with **no** columns named → blocked with "Add at least one column"
- [ ] Create a table with one column → appears with the right column count (not "0 cols")
- [ ] Add Row → form has fields, insert works
- [ ] Add Column on a table **with existing rows**, nullable → appears, existing rows show blank
- [ ] Add Column, required, no default → rejected with the plain-English reason
- [ ] Delete table → type-to-confirm gate works; table disappears from the grid
- [ ] After a delete, `SELECT * FROM app_tables WHERE chat_id='…'` → registry row is gone too
- [ ] Ask the AI about the schema afterwards → it sees the current columns (registry stayed in sync)

**Everything else:**
- [ ] Auth modal: title, footer links, password checklist all readable (light *and* dark)
- [ ] Account dropdown with a long email → `Free` stays inside the box
- [ ] Settings → Event Logs: toggles visibly differ on vs off; check other Settings tabs too
- [ ] Prompt box: no orange arc
- [ ] Style picker: cards have a background, brand logos visible in dark mode
- [ ] Version history → Restore button legible
- [ ] Data → "Use my own Supabase" → Back to tables returns with the connection intact
- [ ] Preview: no dead band under the header; workbench still sane at small widths
- [ ] Break the preview, let it recover → the Preview Error card clears itself
- [ ] 🔴 Workspace dropdown → **screenshot it at full resolution**, blank row or not

## Known-not-done
- `landing.css` dark-mode rules (item 1 follow-up).
- Item 3a workspace dropdown — cause not established.
- `landing.css` has mojibake in several comments (`ï¿½`), same encoding damage `048393c` cleaned
  out of `BaseChat.module.scss`. Cosmetic, untouched.
