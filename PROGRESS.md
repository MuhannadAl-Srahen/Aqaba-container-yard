# الموقع الجديد — سجل التقدم

Ground-up web rebuild in its own repository. SPEC.md is the specification;
nothing here imports from the old desktop project. Newest entry at the bottom.

## المرحلة 1 — الخريطة والعمليات — 2026-08-07

Status: complete pending owner review

Built:
The whole phase-1 scope of SPEC.md as one standalone package: a Fastify +
node:sqlite server (zero native dependencies, one DB file), shared pure rules,
and an Arabic-only RTL React client where the yard drawing is the interface.
First-run setup (password + yard shape with a live preview), login, the
top-down map with pan/zoom/pinch, gate-in by tapping an empty slot, move by
tap-then-tap-green, gate-out and edit and soft-delete from the container card,
search that lights up the map, and full movement history per container.
57 tests: shared rules, ISO 6346, addresses, map model, and 26 API tests
through `app.inject()`.

Decisions:

- **One slot per container, even for 40 ft.** SPEC.md briefly carried the old
  two-slots-per-40ft model in one sentence; with the yard strictly split into a
  20 half and a 40 half, a 40 slot IS a 40 ft ground position, so the split
  makes the two-slot bookkeeping needless. The map draws 40 cells twice as
  wide — the visible promise is kept; the invisible ledger got simpler.
- **node:sqlite over Prisma/Postgres.** One file database, no native build, no
  container. Synchronous single-writer means every handler transaction is
  serialized by construction — the isolation-level machinery of the old stack
  has nothing left to protect against. Backup = copy one file.
- **A partial unique index backs up the rules**: `(zone,row,col,tier) WHERE
zone IS NOT NULL AND deleted_at IS NULL`. Even a future code path that skips
  `canPlace` cannot double-book a slot; the error handler translates the
  constraint violation into the same `SLOT_TAKEN` the rules would have given.
- **The same rule functions run on both sides.** `src/shared/rules.ts` is the
  server's authority inside the transaction AND the client's green-target
  painter, so the map can never promise what the server refuses.
- **Sessions are stateless HMAC tokens** (`expiry.signature`), scrypt for the
  password, secrets in the settings table. No session table to clean, nothing
  user-controlled to parse.
- **The wire carries codes, ar.ts carries sentences** — same contract as the
  old system, one file of Jordanian-register Arabic.
- **Tap-vs-drag on the map** is a travelled-distance check (8 px slop), so
  panning never fires a cell tap and a shaky finger on a phone still taps.
- **Tapping an illegal empty cell explains instead of ignoring**: the refusal
  reason appears as a toast (e.g. "ما في حاوية تحت — ما بتنحط بالهوا"), which
  teaches the rules without a manual.
- **15-second polling, not sockets.** Two clerks see each other's work within a
  poll; realtime push is not phase-1 scope and the query layer makes adding it
  later a local change.

Verified: `tsc --noEmit` clean, eslint (the repo's strict config) clean, 57/57
tests, production build 83 KB gzip, and a live smoke test over a real socket:
setup → gate-in 20/40 → stack → NO_SUPPORT and BURIED refusals → move → exit →
history IN→OUT → auth guard → SPA serving → Arabic UTF-8 round-trip.

Known gaps (all deliberate phase-1 scope, per the owner's answers):

- No deployment yet: needs a VPS, a domain and HTTPS. The server already
  serves the built client from one process, so deploy = `bun run build` + run
  `src/server/index.ts` behind Caddy.
- Excel import (دفتر-الساحة.xlsx) not built yet — next phase, before go-live,
  so the staff's interim records are never retyped.
- No user accounts, reports, notifications or label printing (deferred by the
  owner's explicit choice).
- The login throttle is in-memory per-IP; behind a reverse proxy it needs
  `trustProxy` so it sees real client IPs.
- Nothing has been SEEN rendered in a browser in this environment; the visual
  result rests on the build, the tests and the smoke run.

## اختبار المتصفح الحقيقي — 2026-08-07

Status: complete — every phase-1 flow driven in a real browser (headless Edge
via playwright-core, desktop 1440×900 and phone 390×844) against the live dev
servers. Setup, login, gate-in 20/40, stacking, NO_SUPPORT toast, buried card
with disabled actions, move with green targets, search highlight + departed
dropdown, gate-out, full IN→MOVE→OUT history, logout, wrong-password error —
all pass with screenshots; console clean apart from the deliberate 401s.

The browser found four bugs the 57 `app.inject()` tests could not see, all
fixed this session:

- **Every cell tap was dead in a real browser.** `setPointerCapture` on
  pointerdown made Chromium retarget the gesture's `click` to the pan
  container, so no cell ever heard it. Capture now engages during pointermove
  only once travel exceeds the 8 px tap slop (or a pinch starts) — a tap never
  captures, a drag still pans past the container edge. Also removed the 1 px
  per-move drag marking that contradicted the documented slop and would have
  eaten shaky-finger taps.
- **Gate-out and logout always failed (500).** `api.ts` sent
  `content-type: application/json` on bodyless POSTs; Fastify refuses an empty
  JSON body and the catch-all turned it into 500 VALIDATION. The header is now
  sent only when a body is.
- **The map opened with slot 1 off-screen.** The pan/zoom transform assumed a
  top-left origin, but `dir="rtl"` right-aligns the block, shifting the whole
  coordinate system ~570 px. The transformed div is now pinned physically
  top-left.
- **SVG labels spilled outside their panels.** Under `dir=rtl`, `text-anchor`
  follows reading direction, so the zone title leaked right and the free-count
  label leaked left (the setup preview showed titles clipped to "قدم"). Anchors
  corrected for RTL.

Also linked the existing `favicon.svg` in `index.html` (browsers were 404-ing
on `/favicon.ico`).

An adversarial multi-agent review of the fixes then caught what the first pass
introduced or missed, all fixed and re-verified the same session:

- Deferring capture opened a leak: a mouse press exiting the container under
  the slop never delivered its pointerup, and the stranded entry made
  buttonless hover pan the map, swallowed the next tap, and could fake a
  pinch. Now a tracked non-touch pointer moving with `buttons === 0` is
  dropped, and `onPointerLeave` forgets uncaptured pointers.
- Sub-slop jitter used to nudge the view while still counting as a tap; pan
  now engages only past the same 8 px slop.
- The row-letter labels were the one `<text>` the RTL anchor fix missed —
  two-letter rows (27+) would have collided with column-1 cells.
- `body: null` would have resurrected the bodyless-POST 500; the header guard
  now treats null as fetch's own "no body".
- Wheel zoom moved to a native non-passive listener: React's root wheel
  listener is passive, so `preventDefault` there could not stop ctrl+wheel
  from zooming the whole page along with the map.

The browser drive gained a gestures step that locks these in: a 120 px drag
pans without opening a sheet, a 3 px jittery tap opens the sheet without
moving the view, and a press released outside the container must not turn
hover into panning.

Known minor left open (owner's call on the UX): the setup preview assumes
≥560 px of width, so on narrow phones its left side clips with no way to
scroll; first-run setup is realistically a desktop task, so it was reported,
not fixed.

Verified after the fixes: `tsc --noEmit` clean, eslint clean, 57/57 tests, and
the full browser drive green twice. Lesson recorded for later phases: inject
tests prove the rules, not the pointer pipeline — map interactions need a real
browser pass.

Dev password set during this test on `data/yard.db`: `aqaba-2026` (change it
before go-live). The test containers were soft-deleted or exited; two remain
standing at 20-A-01 (a laden CSQU with an empty MSCU stacked on top) as sample
data.

## المرحلة 2 — ساحة على كيفك — 2026-08-07

Status: complete pending owner review — approved by the owner before build
(15° rotation steps, owner-named blocks, layered stacked cards).

Built: the yard became a set of free blocks. Each block carries a name the
owner writes, a size (20/40), rows×cols, a position on the canvas and an
angle in 15° steps. A new edit mode on the map itself: drag a block to move
it, select it for a bottom toolbar (rename, rows/cols steppers, ±15°
rotation, delete-if-empty), add 20/40 blocks, one atomic save. Stacked slots
draw as two overlapping cards with the upper number readable; tapping one
opens a chooser (الفوقانية / الأرضية), and a ground container's card offers
«حط حاوية فوقها» so stacking never needs the tier toggle.

Decisions:

- **Addresses now speak the owner's names**: `اسم المنطقة-صف-موقع`. The wire
  carries block ids; `blockNames` in the state covers deleted blocks so old
  history keeps its names (blocks soft-delete like everything else).
- **One geometry, both sides.** `src/shared/geometry.ts` holds the drawing
  metrics, rotated corners (SAT overlap) and the first-run layout; the editor
  paints red with the same function the server refuses BLOCK_OVERLAP with.
- **The layout saves as one PUT** carrying every block; the server diffs
  against live ids: update/insert/soft-delete, refusing NAME_TAKEN,
  BLOCK_OVERLAP, BLOCK_NOT_EMPTY and the old SHRINK_OCCUPIED (now also
  covering deleted blocks and size changes under standing containers).
  Moving/turning a block carries its containers with it by construction —
  positions are block-relative.
- **DB migration v1→v2** rebuilds containers/movements (zone columns sat in
  CHECKs/indexes SQLite cannot drop), creates the two blocks with the exact
  old drawing positions, re-points every position, stamps user_version=2.
  Verified against the REAL dev database: both standing containers and all
  history survived the restart untouched.
- **The editor canvas freezes its origin at entry** so dragging one block
  never visually shifts the rest; the SVG overflows visibly for blocks pushed
  past it and the map renormalises on the next load.

Verified: typecheck/eslint clean, 80/80 tests (new: geometry SAT suite,
v1→v2 migration suite, layout-endpoint suite), and the full browser drive
including: migration survival, stack chooser (desktop+mobile), layered cards,
«حط حاوية فوقها» offered only when the top is free, editor add→rename→drag→
rotate 30°→save→verify→delete→save. The drive is now additive-only: it
recognises its containers by test customer names and never touches the
owner's blocks (the owner was live-testing the editor mid-session — their
blocks and containers were preserved throughout).

Known gaps:

- Concurrent layout edits are last-write-wins; two people saving the editor
  at once can silently drop the other's just-added block. Fine for the
  single-clerk phase; needs a layout version stamp before multi-user.
- The setup preview's narrow-phone clipping from phase 1 remains open.
- Labels inside rotated blocks rotate with the block; at steep angles the
  numbers read sideways (as on paper yard maps). No counter-rotation yet.

## المرحلة 3 — دفتر الساحة على الشاشة — 2026-08-07

Status: complete pending owner review. Scope came from the owner's Excel
register (كشف الدخول/الخروج، التقرير اليومي، بطاقات الدخول والخروج) and his
answers: free mouse rotation, addresses in the paper notation, truck/type/slot
mandatory, the 4+4 number form as first-class, card counters from 1, and the
real yard A–J built for him with all old test data wiped at his request.

Built:

- **Addresses now speak the register**: `A1-5-H` — area name fused with its
  line, then the position, then L (ground) / H (upper). Rows number 1..n on
  the map, line headers read A1/A2 when the area's name is short. Old
  history keeps resolving through deleted blocks' names.
- **Free rotation**: any whole degree. The editor grew a grab-handle above
  the selected block (drag = turn, live), the ±15° buttons stay for tidy
  steps, blocks snap edge-to-edge while dragging, and an EMPTY block's size
  can be flipped 20↔40 from the toolbar (the 40-vs-20 area split stays the
  owner's call, area by area).
- **The gate paperwork**: gate-in records truck (mandatory, per the owner),
  driver and weight (optional); gate-out asks for its own truck/driver in a
  small exit form. Card serials count from 1, one counter per direction, in
  settings, bumped inside the write transaction. DB migration v3 = seven
  additive columns.
- **The عرض «الكل» view**: a third tier button splits every slot into L|H
  halves side by side — the paper register's paired columns, live. Taps are
  unambiguous there, so the stack chooser stays out of the way.
- **Printed cards**: بطاقة دخول/بطاقة خروج from the container card, matching
  the paper design (serial, day/date, driver, truck, type, company, weight,
  slot, two signature boxes) with print CSS that isolates the card.
- **صفحة التقارير**: three sheets matching the Excel column for column, over
  a date range (Amman calendar), each printable — entry register, exit
  register (with dwell), and the daily summary with the running standing
  count.
- **The real yard**: areas A–J, each 2 lines × 30 positions, A at the right
  edge, built through the layout API after soft-deleting the test records
  (the owner asked for a clean start; history stays findable in search).
- The 4-letters+4-digits working number is valid alongside full ISO; dates
  in reports and cards render dd/mm/yyyy in Latin digits so RTL cannot
  scramble them.

Verified: typecheck/eslint clean, 87/87 tests (new: paperwork/serials,
report endpoints, free-angle validation, local number form, v3 columns), and
the full browser drive: 600 cells render, gate-in with paperwork, NO_SUPPORT
toast, stacking, the الكل split (1200 halves), chooser + buried card, entry
card print, move, exit form, exit card print, all three reports, editor with
free-handle rotation (saved at a hand-dragged 90°), delete pass, auth, and
the phone pass (zoom + pan + tap on the big yard).

Fixed along the way: a newly added block used to spawn under the editor
toolbar where neither drag nor handle could reach it — new blocks now appear
at the right edge, below the yard.

Known gaps:

- The registers' المستخدم column awaits user accounts (deferred scope).
- window.print() in the drive is asserted visually, not against paper.
- Report ranges assume the Amman calendar; the server groups by
  Asia/Amman regardless of where it is deployed (deliberate).

### جولة ملاحظات المالك — نفس اليوم

The owner's five fixes after trying it (his register screenshots were dummy
data, sent to shape the printing):

- **Print no longer clips.** Reports declare `@page A4 landscape` with
  compact print type (9.5px, tight padding, repeating header row, rows never
  split across pages); the emulated-print screenshot and a Chromium-made PDF
  confirm every column of the widest register fits. Cards print portrait.
- **تصدير Excel** on every report — the sheet as an Excel-readable RTL HTML
  file (.xls) with title, period and totals. PDF stays the browser's own
  حفظ كـ PDF from the print dialog (a hint line says so).
- **The ground view shows the ground.** The layered pair flipped: الأرضي
  paints the ground container in front with the upper peeking behind; الأول
  and الكل unchanged.
- **The map no longer re-renders per pan frame.** YardMap is memoized and
  both screens pass referentially stable props; the 1200-half الكل view was
  re-building thousands of SVG nodes on every pointer move before this.
- **Report look redesigned**: document header (site name, sheet title,
  period), zebra rows, heavy outer border, totals row, printed-at footer —
  one table model feeding screen, paper and Excel alike.

Also fixed: long unbroken notes overflowing the container card
(wrap-anywhere), and a new editor block used to spawn under the toolbar
where neither drag nor rotate could reach it. The owner's last message ended
mid-sentence («وكمان في مشكلة ف…») — awaiting the rest.

### جولة ملاحظات ثانية — نفس اليوم

Seven more owner asks, all delivered and browser-driven:

- **سجل العمليات** — the full audit: every operation on every container —
  دخول، نقل، خروج، تعديل، **وحذف** — deleted records included and flagged
  «سجل محذوف». Deletions now write a DELETE movement (movements table
  rebuilt as migration v4 to widen its CHECK; an `at` index added).
- **كشف سيارة** — type a plate, see everything it carried in and out over
  the range, with the count.
- **تصدير PDF حقيقي** — POST /api/reports/pdf renders the same sheet
  through the machine's own browser engine (playwright-core driving
  Edge/Chrome headless) and streams a downloadable file; verified by an
  actual download in the drive. Deployment note: the VPS needs
  Chrome/Chromium plus an Arabic font package.
- **Excel export restyled** — the export now carries the document header,
  borders, header shading, zebra rows and the totals row (one sheet-HTML
  builder feeds PDF and Excel alike).
- **Reports screen redesigned** — pill tabs, filter row, sticky header on
  screen, cleaner table borders.
- **Notes are real multiline text** — textarea in gate-in and edit, shown
  as a wrapped block in the card (the previous inline row still clipped
  pathological unbroken strings).
- **Container size is editable 20↔40** — refused with WRONG_ZONE while the
  container stands in a mismatched block; free once it is out. Logged in
  the EDIT movement as «المقاس».

The drive now picks genuinely free slots from the live state instead of
assuming slot 1 is empty — the owner tests on the same yard concurrently and
had containers standing exactly where the script used to aim.

Known nit: legacy history rows naming DELETED blocks whose names end in
digits («منطقة 40») bidi-scramble next to the address digits; the real yard's
letter names are unaffected.

### جولة ملاحظات ثالثة — 2026-08-08

Thirteen owner asks in one message, all built:

- **40s stand tall.** A 40 slot draws twice as HIGH, not wide — the box lies
  along the line like on the ground. Shared geometry change, both sides.
- **القالب المختلط** (block size 0): every slot takes either size, chosen in
  the gate-in card; the map tags 40s with a corner badge. A block converts
  to mixed even while occupied; back to single-size only when nothing of
  the other size stands in it (editor greys the button; the server refuses
  regardless). Migration v5 rebuilt the blocks CHECK.
- **Two sheets never stack**: tapping any cell closes whatever card/sheet
  was open first — the second-modal-behind-the-first bug is gone.
- **Editor faster**: BlockPanel is memoized per block, so dragging one area
  re-renders one panel, not six hundred cells. Rows/cols are now typed
  directly (number inputs with ±), new blocks name themselves with the next
  register letter (A, B, …), and a third add-button creates mixed areas.
- **سجل العمليات moved out of التقارير** to its own «السجل» screen.
- **Sheets fit the screen**: no horizontal scrolling — cells wrap; long
  sheets paginate (15 rows, السابق/التالي) while print/PDF/Excel always
  carry every row.
- **Gate cards redesigned** as a proper voucher (accent strip: serial,
  title, day/date/time; clean grid; signature boxes); exit card included.
- **زر تصفير (تطوير)**: POST /api/dev/reset hard-wipes containers,
  movements and card counters, keeps the yard and password. Explicitly a
  DEV exception to soft-delete-only; disabled when NODE_ENV=production and
  slated for admin-only later.
- Escape closes every sheet/dialog; notes wrap fixed earlier held.
- Wheel-zoom on the MAIN map was probed live and works (scale changes on
  wheel) — the owner's report predated the passive-listener fix.

Verified: 93/93 tests (new: mixed rules/API, vertical frames, dev reset),
typecheck/lint clean, and the full drive: gate flows, chooser, prints,
reports with pagination + real PDF/Excel downloads, the log screen, free
rotation, auth, phone. The drive now reads the live state to pick free
slots, since the owner tests concurrently on the same yard.
