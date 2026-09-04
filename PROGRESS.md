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

### جولة ملاحظات رابعة — 2026-08-08

Nine more owner asks, all landed:

- **The wheel died after visiting the editor** — the real bug behind "zoom
  only works in edit mode": the native wheel listener stayed bound to the
  unmounted map container. usePanZoom now exposes a callback ref that
  re-binds on remount; probed live (editor round-trip, then wheel: zooms).
- **BAD_STACK**: a 40 never lands on a 20 (Standing carries size; the rule
  names the underneath container; mixed blocks were the only place it could
  happen). 20-on-40 and 40-on-40 stay legal.
- **The exit card opens itself** the moment an exit is confirmed — the
  paper exists before the container leaves the screen. It also remains
  printable later from the departed record's card.
- **Sheets**: 12-hour times (م/ص), day names never split mid-word (wrapping
  is per-cell policy now), and a per-page selector (20/50/80 rows).
- **Truck plates are doorways**: tap one in any register → that truck's own
  sheet, plate prefilled.
- **Undo from the log**: DELETE rows grow an استرجاع button (un-deletes and
  re-stands the container in its old slot when rules allow — otherwise the
  usual refusal), EDIT rows a تراجع button (EDIT notes now carry the old
  values as JSON {k, b}; old CSV notes stay readable, just not revertible).
  RESTORE is a first-class movement type — the movements CHECK widened
  again via the SQL-keyed rebuild.
- The log's action column is screen-only: prints and exports never see it.

Verified: 95/95 tests (BAD_STACK, restore round-trip incl. slot-taken
refusal, before-values in EDIT notes), typecheck/lint clean, full drive
green — including the auto exit-card and a wheel probe for the editor
round-trip. Mid-drive discovery: the owner had already turned areas A and J
mixed on the live yard, so the drive's gate-in waits became policy-agnostic.

### الموقع صار سلة — schema v7 — 2026-08-09

The owner went and stood in the yard. The address model did not survive the
visit: it promised a precision the crew will never record.

**A location is a basket.** `A-01` — the column's letter and the row's odd
number, and nothing finer. `(col, tier)` is gone from the coordinate: no
left/right, no front/back, no floor. Containers are *members* of a location,
not occupants of a slot in it. The one question the map must answer became
«كم فيه من كم، ومين جوّاته» — the cell says the count, a tap lists the boxes.

- **Rows count in odd numbers** (01, 03, 05 …) because a location is forty
  feet long — two twenty-foot bays of the ground's own marking. `rowNumber`
  is `row * 2 - 1`, zero-padded; the label is computed, never stored.
- **Capacity replaced geometry.** A location holds `placesPerTier × tiers`
  twenty-foot places; a 20 claims one, a 40 claims two. Four places per tier
  is four 20s (two front, two behind) or two 40s — the same box either way,
  which is why `cellSize` lost its size argument and a panel is now one
  narrow column. Both numbers are per-column and editable: the owner expects
  tiers to change and thinks capacity might.
- **The editor speaks each column's own language.** A 40 column is typed in
  whole 40s, a 20 column in 20s, a mixed one in places; the wire stores
  places, and a zod refine keeps a 40 column's count even so the round-trip
  cannot invent half a container.
- **Rules that died with the precision they needed**: NO_SUPPORT, BURIED,
  BAD_STACK, SLOT_TAKEN. `canLift` is now the HOLD check alone. What
  arrived: LOCATION_FULL (carrying how short the location is) and
  CAPACITY_OCCUPIED (a layout save cutting places or tiers under a location
  that already holds more).
- **Location states are gone entirely** — «المكان مستحيل بنعطب». The
  `slot_states` table, `blocks.state`, their two endpoints and their sheet
  all went with them. Container conditions stay; a location that holds one
  wears a small dot, which is the only thing the cell says beyond its count.
- **The unique index is gone and could not be replaced.** `idx_one_per_
  position` guaranteed one container per slot; a capacity is a SUM, not a
  key, and no index expresses it. Every write already runs inside
  `transaction()` on a single-process node:sqlite handle, so the
  read-then-write in `canPlace` is atomic — the shared rule stays the sole
  authority rather than being duplicated into a trigger that could drift.
- **Migration v7** rebuilds blocks, containers and movements and drops
  `slot_states`. `places_per_tier = cols * 2, tiers = 2` is the old worst
  case exactly (a 40 on every line, both tiers), so nothing standing is ever
  pushed out. The panel shape changed completely, so live columns are
  re-laid left to right — the owner drags them into place once. The v1→v2
  upgrade stopped calling `defaultLayout` and froze its own v2 metrics
  inline: a migration must draw the old yard the old way, whatever the
  shared geometry becomes.

Verified: 127/127 tests, typecheck and lint clean.

### الموظفين والرصاصة وكشوفات مضبوطة — schema v8 — 2026-08-10

Four people work this yard now, and the owner wanted to know which of them
touched what. Alongside that came a review of the registers that turned up two
real defects — both the sort a spreadsheet would never forgive.

- **Employees, PINs, permissions.** A `users` table (soft-deleted, like
  blocks — last year's register must still name whoever signed it) and a
  session token that grew an actor: `userId.expires.signature`, the HMAC
  taken over the pair so a cookie cannot be edited into somebody else's. The
  old two-part tokens no longer parse; everyone signs in once more, which is
  the right thing for the release that introduces accounts. `setPassword`
  and the PINs share one `hashSecret`/`verifySecret` pair — one storage form
  for every secret in the system.
- Six per-user permissions (`GATE_IN, MOVE, GATE_OUT, EDIT, DELETE, REPORTS`)
  and three things that are **never** a checkbox: the yard editor, the staff
  list and the dev tools. The client hides what it may not do; the server
  refuses it. As always, hiding is courtesy and the refusal is the rule.
- **`movements.user_id`** carries the actor (NULL is the owner, who is not a
  row in `users`). The entry and exit registers, the standing sheet and the
  operations log all name the person.
- **The seal (الرصاصة)**, mandatory both ways. The exit form pre-fills the
  entry seal, so an actual change is a deliberate edit rather than a typo,
  and a mismatch flags «الرصاصة تغيّرت» on the card — the door was opened
  inside the yard.
- **Cargo left** (every container here is laden) and **every container status
  left with it** — dents, an opened lock, a customs hold all live in the notes
  now, which the owner asked for twice. This removed HOLD, the one flag that
  physically froze a container against move, exit and delete, so `canLift` is
  gone entirely. The compensation is placement: the notes column now rides on
  every register and the map dots any location holding one, so the warning is
  in front of whoever signs the paper.

**Two accuracy defects the owner caught, and one this work caught:**

- **The daily register invented days.** It emitted a row per calendar date in
  the range whether the yard had worked that day or not — «بحط أيام من عنده».
  Only days that actually carry a movement get a row now. Driven against a
  seeded month: 29 rows over a 40-day window, every one of them real.
- **Dwell was counted with a stopwatch, not a calendar.** Both the server and
  the client divided elapsed milliseconds by 86 400 000, so a container that
  came in at 23:30 read «0 يوم» the next morning. New `src/shared/dates.ts`
  counts Amman calendar days, and both sides call it — the duplicate
  implementation that let them disagree is gone.
- **A migration step had quietly stopped being idempotent.** v6 adds
  `containers.status` and `blocks.state` "when missing", and v7/v8
  deliberately removed them — so an up-to-date file failed the same test an
  ancient one fails and grew the columns back on every restart. The live yard
  file had collected both. Found by running the migration against a copy of
  it, exactly as the plan's verification step said to. Both v6 steps are now
  gated on the file being old enough to want them, `dropPhantomColumns`
  sweeps up files that already drifted, and a test opens the same database
  four times and demands the schema not move.

- **The standing register** (كشف الحاويات بالساحة): what is in the yard right
  now, oldest first, with its dwell — and `SheetScreen` grew a `rangeless`
  mode for it, because a snapshot has no date range to pick.
- **A card is one tap away.** The gate registers use the same screen-only
  action column the log uses for استرجاع, so a lost gate card reprints from
  its own row instead of being hunted by exact container number.
- **Search answers «وين هي»** in words: standing hits list first, each with
  its location, above the departed ones.
- **The column header** says what the owner asked for beside the letter: the
  size it takes, how high it stacks, and free against total.
- **Dark mode.** Semantic tokens (`surface`, `ink`, `muted`, `line`, plus a
  `--yard-*` set the SVG reads directly) rather than a `dark:` twin on every
  class, so the map turns over with the chrome and there is one vocabulary to
  keep straight. `@media print` redeclares the light values, so paper and the
  server-made PDF are unaffected by the screen. The theme is applied by an
  inline script in `index.html` before first paint — no white flash.

Verified: 143 tests (new: `dates`, `users` covering PINs, permissions, the
audit trail and session forgery; daily-register accuracy; the seal both ways;
the standing sheet; v8 and migration idempotence), typecheck and lint clean,
the v8 migration run against a copy of the live yard file (45 standing
containers and 90 movements intact, phantom columns swept), and a full drive
of the running server: setup → hire four → sign in as نور by PIN → receive
with a seal and a long note → her 403s → fill a location to the brim → وسام
moves and gates out under a new seal → every register carries seal, note and
name → a removed employee still signs her old entries and loses her session.

### الجولة اللي بعدها — تبديل المستخدم، كشوفات مضبوطة، والفاضي بالساحة — 2026-08-10

The owner drove the built app and came back with a list. Everything below was
found by driving the real thing in a real browser (playwright-core against a
copy of the live yard file), not by reading the code.

- **«لما بدي أفوت ع تبويب المالك ما بيعمل إشي.»** Reproduced and measured:
  after signing in as an employee, signing out, and signing back in as the
  owner, the app fired **585 boot/me/state requests in three seconds** and the
  header kept the previous person's permissions — so the owner's own buttons
  never appeared. Two causes, both fixed:
  - `YardScreen`'s unauthorized-bounce effect listed the whole `props` object
    in its dependencies. `props` is a new object every render, so the effect
    body ran on every render; a 401 left in the cache by the session that had
    just ended re-fired the bounce, the bounce invalidated every query, and
    the re-render fired it again. It is now keyed on the callback alone and
    latched to fire once per mount.
  - `reboot` invalidated the cache instead of resetting it, so the previous
    session's `me` answer survived the switch. It now `resetQueries()`, and
    it is a `useCallback` so the dependency above can be honest.
  After: **4 requests**, header reads «المالك», both owner screens open.

- **التصفير والتعبئة التجريبية removed from the system**, as asked: the two
  header buttons, the two client calls, `POST /api/dev/reset`,
  `POST /api/dev/seed`, `store.devReset`/`devSeed` and `src/server/seedData.ts`
  are gone. A test now asserts both routes answer 404 — with the yard in real
  use, nothing in the API may delete a container or a movement for real.

- **The column header spilled out of its panel.** One long line at 10px inside
  a 110px box ran past the panel's own edge. It is two lines now (the letter
  with its size, then how the location is built) over a taller title block,
  with bigger cell type. The panel's WIDTH is deliberately unchanged: the
  owner's columns stand 150 units apart in their drawing, and a wider panel
  would have made their yard overlap itself.

- **«اسم الشركة سيئ طريقة عرضها مثل كانو مقصوضة الكلمة.»** The free-text cells
  carried Tailwind's `wrap-anywhere`, which tells the browser a single letter
  is a legal column width — «شركة النورس للشحن والتفريغ» came out sawn through
  the middle of a word, and the squeezed columns at the far edge were clipped
  by the scroll container. Replaced with a computed column layout:
  `columnShares` weighs every column by the longest thing it actually carries
  (headings counted by their longest word, since headings wrap), clamps free
  text between 14 and 26, and emits percentages under `table-layout: fixed`.
  The register now fits its container exactly — measured 1388px table in a
  1388px box, company column 208px, no clipping, no broken words — and the
  same shares are written into the PDF/Excel document so paper matches screen.

- **Dark mode on the registers.** `bg-slate-100` headers and `border-slate-700`
  rules were hardcoded light, so the header band was white with white text. A
  new `--color-rule` / `--color-rule-strong` pair joins the token set (a
  register's ruling is darker than the chrome's), the print block redeclares
  them light, and `print-color-adjust: exact` keeps the header band and the
  zebra on paper — a register without its ruling is a wall of numbers. Swept
  every screen in the dark with a contrast probe: no low-contrast text left.
  The theme toggle now also sits on the register, log and staff screens.

- **الطباعة**: repeated header AND footer groups, rows that never split across
  a page, fixed column layout, and «صفحة 2 من 5» in the PDF footer beside the
  sheet's own title, so a loose page is still identifiable on a desk.

- **«قديش باقي»** on the map header, kept apart by size: `yardFreeSpace` sums
  each column's free places and reports 40s and 20s in their own units (a free
  place in a 40 column is no use to a 20 waiting at the gate), with the mixed
  reserve counted in places. Verified against the live copy: 258 forty slots
  and 109 twenty slots free with 45 standing — 34 + 11 = 45.

Verified: 140 tests, typecheck and lint clean, and the whole thing driven in a
real browser against a copy of the live yard — role switch, both owner
screens, the registers light and dark, and the generated PDF read back page by
page.

### الساحة الرسمية — Aseza Yard، تتبع لحد الطابق — schema v9 — 2026-08-10

The owner came back from the authority with the official plan: **Aseza
Yard**, two yards (Y1: TGS 571, Y2: TGS 110, TOTAL = 681 twenty-foot ground
slots), the drawing itself in `Aseza yard.xlsx`, and one sentence that
reversed the whole basket era: «انسى موضوع الونش… بدي دقة التتبع مية بالمية
وين مكان الحاوية بالزبط الغلط صفررررررر». Everything yard-shaped changed;
the staff, the seal, the registers machinery and dark mode carried over.

- **The drawing was decoded, not transcribed.** `tools/decode-aseza.mjs`
  reads the xlsx (a ~40-line ZIP reader over zlib — no new dependency) and
  emits `src/shared/asezaLayout.ts` as committed pure data. Each zone sheet
  paints bays as 15-row bands: the band's first row carries the usable stack
  numbers — one numeric cell = one ground slot — with the bay number in
  column B below it. The tool REFUSES to write if the tally disagrees with
  the printed totals. First run caught its own assumption: zone A switches
  to a 16-row pitch after bay 47, so anchoring on rows ≡ 2 (mod 15) missed
  bays 49–53 (exactly 30 slots). Re-anchored on the bay numbers themselves:
  **A=242, B=230, C=54, D=45 → Y1=571 ✓; E=110 ✓** — and the walls the
  owner described («الحيط ضيق») are in the data: A's first bays lack stacks
  1–2, E's bay 27 keeps only 6.
- **The address is the official five-part code** `1-A-03-01-A` — yard
  derived from the zone (E → 2), odd bay = 20, even bay = a 40 lying across
  the two odd bays around it, stack 01–10, tiers A/B only. `positionLabel`
  is pure now — no DB lookup — and every register, card, search result and
  movement line speaks it.
- **The physics went into shared rules**: parity IS the size; every covered
  ground slot must exist; a spanning 40 occupies the same cell of both odd
  bays; tier B demands support (a 20 only on a 20 — a 40's roof has no
  middle castings; a 40 on two 20s or on a 40); and **BURIED refuses both
  exit and move** until the one on top comes down, naming it in the toast.
  `freeNow` counts real legal landings per size per yard — the header's
  numbers matched the hand-computed 537/102 on the empty yard.
- **Schema v9 is a cutover**: containers, movements and the whole blocks
  table dropped (the owner: «شيل كل الحاويات واشتغل على النظام الجديد
  تماما»); users, PINs, permissions and the password survive; card serials
  restart at 1; the old file is snapshotted first via `VACUUM INTO` as
  `yard.db.pre-v9-backup.db`. The v1→v8 migration ladder was deleted whole.
  The yard editor, `PUT /api/yard`, setup's yard step and `GET /api/state`'s
  yard payload all died — the layout ships compiled into both sides.
- **The map draws the official ground**: five zone strips with the plan's
  own bay numbers, hatched hangars/buildings/tower/caravan as orientation
  marks, per-yard free chips, and TEU counts per bay. Tapping a bay opens
  the new **BaySheet** — stacks across, tier B drawn above tier A, walls
  hatched «حيط» — where every operation picks its exact slot; an empty cell
  offers exactly the landings the rules allow, including «حط 40 بالعرض مع
  الباي المجاور». Gate-in arrives with the slot fixed and the size decided
  by parity; the size toggle locks while standing.
- Verified: **97 tests** (layout totals pinned; parity/wall/occupancy/
  support/burial physics; migration wipe-keep-backup; API flows; users and
  dates untouched), typecheck and lint clean, and a browser drive end to
  end — setup with password alone, both yards and hangars on screen, a 20
  into `1-A-03-08-A`, a second stacked on tier B, the buried one refused
  with the name on top, a 40 landed as `1-B-02-01-A` painting both bays, search
  and the entry register speaking full codes. **23/23 green.** The live
  file, meanwhile, migrated itself under the owner's running dev server —
  backup written beside it, وسام intact — and the owner had already gated
  five containers into official slots before the round was even written up.

### الطابق الثالث، البوليصة، والنسخة الاحتياطية — schema v10 — 2026-08-10

Same-day follow-up round, on the owner's list: «ارفع طابق 3 للكل احتياط»,
a one-tap backup, the bill of lading, and two label changes.

- **Tier C everywhere.** TIERS grew to A/B/C with `tierBelow`/`tierAbove`
  helpers, and every rule generalized off the literal pair: support checks
  the tier directly below (20-on-20 only, 40 on two 20s or a 40 — on C like
  anywhere), burial checks the tier directly above, `freeNow` and the bay
  capacity sweep TIERS. The bay sheet draws C over B over A; a bay of 10
  stacks now reads 0/30. Physics proven in tests AND in the browser: a
  three-high stack went in, and the middle one's exit was refused with
  «فوقها CCCC3333 — نزّلها الأول».
- **رقم البوليصة** rides the container end to end: optional at the gate (the
  owner's call), on the container card, the printed entry card, and as a
  clickable column on the entry/exit/standing/truck registers. A new
  **كشف بوليصة** gathers the whole group — standing first with exact slots,
  departed after with exit dates, footer split 20/40 — and the search box
  understands bills: typing 3210 lights all its containers on the map and
  offers «بوليصة 3210 — 4 حاوية» as a doorway straight to that sheet.
  Tapping the bill number in any register jumps the same way.
- **Schema v10, non-destructive**: `containers.bill` plus the tier CHECK
  widened to accept C — a rebuild (SQLite cannot edit a CHECK) that carries
  every row across, proven by a v9-fixture migration test. Detected from the
  table's own SQL as always.
- **النسخة الاحتياطية بكبسة**: POST /api/backup (owner-only) runs
  `VACUUM INTO data/backups/yard-<stamp>.db` — WAL folded in — and streams
  the same bytes back as a download. One tap, two copies. The header button
  sits beside «الموظفين»; the test opens the download and checks the SQLite
  magic bytes plus the server-side copy.
- **Labels**: «اسم العميل» became **«اسم المالك»** everywhere (the container's
  owner — distinct from the yard's المالك in the employee column), and the
  weight is **بالكغم** on the form, the card and every register.

Verified: **107 tests**, typecheck and lint clean, and a browser drive: the
three-tier stack, the BURIED refusal by name, the bill doorway from search,
the bill sheet with its 3-عشرين/1-أربعين footer, the clickable bill cell on
the entry register, the kg label, and the free chips counting honestly
(571 − 3 covered grounds = 568 with the roofs balancing out).

## 2026-08-11 — v11: gravity, dangerous goods, the storage card, owner tools

The system is live on the office server in Aqaba behind a permanent Tailscale
URL and the staff are learning it there, which is the shape of this whole
round: the owner asked for one big list, and it landed as six commits.

- **Gravity replaces the BURIED refusal.** Lifting a container no longer says
  no because something stands on it: everything resting above descends exactly
  one tier, C,B,A minus A becoming B,A. `planRemoval` walks the stack upward,
  orders the fallers lowest-first so no write lands on a slot still to be
  vacated, then proves the result twice — once that every landing cell is
  genuinely being emptied, once by re-running `canPlace` over the projected
  yard. The first check cannot be folded into the second: an occupancy map
  holds one container per cell, so a clash would silently overwrite itself
  exactly where it matters. That clash is the one case still refused —
  `BLOCKED_DESCENT`, a 40 bridging two 20s with only one leg lifted, and the
  message names the 40 to relocate, not the leg blocking it. A move now judges
  its landing AFTER the stack settles, so stepping up into the slot your own
  roof just vacated is legal. Deleting a record settles the stack too; it used
  to empty a slot and leave the box above it standing on air.
- **Each descent is its own `DROP` movement** carrying the number of the
  container that left, so the log never claims a member of staff carried a box
  they never touched. Schema v11 rebuilds `movements` for the widened CHECK.
- **مواد خطرة** rides in at the gate and is drawn red on every surface — bay
  cell, map cell, search row, container card, every register, both gate cards
  — through danger tokens defined in all three palettes: screen light, screen
  dark, and **paper**, without which a dangerous box prints grey like any
  other.
- **Two weights.** `weight` keeps its rows and becomes the gross (القائم);
  `weight_net` joins it as the net (الصافي). Nothing recorded is re-entered.
- **The storage card** is a receipt the directorate and الحق both sign, so it
  says so: the owner's own wording above the table, their two names on the
  signature boxes, «فئة الحاوية», a two-column layout that fits bill, slot,
  storage date, both weights and notes on one upright page, and ruled slots
  for the handwritten date because a run of spaces collapses in HTML. The
  clause prints on the entry card only — a departure receipts nothing.
- **Every entered field is correctable**, dates included. The subtle half: a
  register filters on `movements.at` while the card reads
  `containers.entered_at`, so correcting one without the other would leave the
  same container in two different weeks depending on which sheet you opened.
  Editing a gate date re-times the matching gate movement. Amman wall-clock
  conversion iterates to the fixed point rather than hard-coding +03:00.
- **Owner training tools**, one file each side: demo data off a seeded
  generator, a wipe behind its own dedicated word, and a full restore. The
  restore copies rows into the live handle rather than swapping the file — the
  app holds one handle for its whole life and nothing can hand it another —
  checks the upload before migrating it (the ladder wipes anything pre-v9 by
  design), reseeds `sqlite_sequence`, and keeps the live cookie secret so the
  owner is not thrown out mid-request by his own restore.
- **The gate card had nowhere to appear from inside a register**: the screens
  were early returns and the card was rendered below them. The screen is a
  value now and the overlays sit outside the choice — plus the card suppresses
  the register behind it, or the printer would take both.
- **Live across devices**: map every 8s, registers and log every 20s, an open
  card every 10s, refetch on window focus, nothing while a tab is hidden or a
  form is being edited.
- **All Arabic rewritten formal**, on the owner's call, and CLAUDE.md's
  language rule rewritten with it.

Verified: **129 tests**, typecheck and lint clean. The permission model was
re-confirmed by test at the owner's request: a REPORTS clerk gets all seven
sheets and cannot receive a container; an EDIT clerk corrects a record and
cannot move, exit, delete or open a register; and an employee holding every
grantable permission is still refused the backup, the demo data, the wipe and
the restore. The owner tools are proven by the round trip that matters —
seed, back up, wipe, restore — coming back to the same yard, same staff, ids
that continue instead of colliding, session still alive.

## المرحلة 12 — الطباعة الصحيحة، الترقيم السنوي، الصيغة والاختياري — 2026-08-11

Status: complete

The owner printed the registers and sent back photographs of columns written
on top of one another — bill numbers across seal numbers, container numbers
across card numbers, headings sawn through the middle of a word.

Built:

- **The cause was arithmetic, not CSS.** Every cell carried a Tailwind
  `text-[13px]` class, and a class on the cell beats a size inherited from the
  table, so the print stylesheet's `font-size: 9.5px` on `.report-sheet table`
  never applied to a single cell. An eighteen-column register was being
  printed at screen type on a page sized for two thirds of it, and
  `table-layout: fixed` does not shrink a cell that will not fit — it lets it
  spill over its neighbour.
- **`src/client/sheetGeometry.ts`**, the whole geometry with no React in it so
  the promise it makes can be tested: what each column demands in characters,
  the type size that makes all of them together come to exactly one page, and
  the shares themselves. Three faults surfaced while proving it, each caught
  by a measurement rather than by eye:
  - **Padding is per column, not per character.** Sharing the page in
    proportion to the text alone charges «الرقم» a fifth of a padding and
    gives it a fifth of one. The share is now the text width PLUS the cell's
    own chrome, which is why the unit test passes for the narrow columns and
    did not before.
  - **The actions column is not printed but was still paid for.** A column
    whose cells are `display: none` keeps its share of a fixed layout, so ~6%
    of every register was a reserved blank. Each `<col>` now carries its paper
    width as a custom property, zero for that one.
  - **The totals row was not counted at all.** «المجموع» sits in the narrowest
    column on the sheet and was the last thing still drawn outside its ruling.
- **The character-width estimate is measured, not guessed.** A flat 0.62em had
  the browser breaking «الموظف» into «الموظ / ف»: Cairo's Arabic runs 0.634em
  per character there. It is now 0.66em per character plus a fixed 0.5em for
  the bearings at either end, both measured in Edge against the built client,
  the second term because a one-character word like «ص» measures 1.19em.
- **Long text can no longer break a sheet.** Free-text columns are capped, so
  the codes keep their room; a row whose note is taller than the page is
  allowed to break across pages, alone among rows, instead of falling off one.
- **Card serials are per year.** «0091» meant nothing on its own once the count
  restarts each January, so the year is stored beside the serial and printed
  with it — «0091/2026» — with a counter per year per direction. Schema v12
  adds the two columns and backfills: no card already printed is renumbered,
  each year's counter resumes above the highest serial that year issued, and
  the year comes from the Amman clock, so a card cut at 23:30 UTC on the 31st
  of December belongs to the year the office was already in.
- **Four fields became optional** — the notes, the driver's NAME and the two
  weights — reversing part of «كل الخانات اجبارية» on the owner's later word. A
  scale ticket can arrive after the truck, and refusing the whole record over a
  driver's name only teaches the gate to invent one.
- **The container number is four letters and seven digits**, the owner's
  instruction, and the four-and-four «yard form» that used to pass as correct
  no longer does: a number that short carries no check digit, so it cannot be
  checked at all. Still a warning, never a refusal — the box is in the yard
  whatever its paperwork says.
- **The card stopped forcing Arabic into an LTR paragraph.** Only codes and
  figures are `dir="ltr"` now; a name or a note is `auto`, so its full stop
  stays at the end of the sentence instead of jumping to the other end.
- **A 500 now leaves a line in the log.** Everything reaching the error handler
  was answered with «حدث خطأ» and nothing else, which is unhelpful on a machine
  at the office; it cost half an hour of this session to learn that a bodyless
  POST with a JSON content-type is a Fastify 400 and not an app fault at all.

Verified: **167 tests**, typecheck and lint clean, and — because the complaint
was visual — measured in Edge at paper size rather than looked at: every cell
of all four registers, on screen and in print media, checked for spilling its
column AND for any word too wide for the line it is on, using the browser's own
text metrics. 19/19. The exported PDF/Excel document is re-opened at page size
and measured the same way: 6/6. The gate itself was driven end to end — a
container received with the driver and both weights left blank, its wrong check
digit warned about and recorded anyway, then sent out again with no driver
named: 9/9. The existing 18-check UI sweep still passes unchanged.

## المرحلة 13 — الموقع الحالي، ترقيم بلا فجوات، وثلاثة حقول محذوفة — 2026-08-12

Status: complete

Six changes in one message, two of them called grave by the owner and taken
first.

Built:

- **Every sheet names where the container IS.** The card and the registers used
  to name the slot of the gate MOMENT, so a box carried across the yard went on
  being described by paper that sent the driver to an empty stack — «في حال
  تعديل على مكان الحاوية بطاقة الدخول والخروج لا يتم التعديل عليها وهذه خطا
  فادح». One column, one meaning, everywhere: «موقع الحاوية». Nothing is lost —
  every move is still a line in سجل العمليات with its from and its to — and a
  container that has left is named by the slot it left from, the last thing
  that was true of it.
- **The card serial left the counter behind.** It is read from the records now:
  the highest serial issued that year, plus one. A counter only ever climbs, so
  striking out a record that should never have been written left a hole nothing
  could fill — «يجب ان لا يتم القفز عن الرقم التسلسلي». A mistake deleted at
  once now hands its number straight back. A move touches nothing, because a
  move is not a gate event. And a restored record whose number was handed on in
  the meantime takes the next free one, since two cards of one year may not
  carry one number and the one already in a driver's hand is the one that keeps
  it.
- **Three fields struck out, from the FILE and not just the screens**: اسم
  المالك entirely, الوزن الصافي entirely, «الوزن القائم» renamed to «الوزن»,
  and مواد خطرة with every trace of red that belonged to it — «لان جميع
  الحاويات عادية وليست خطرة». Schema v13 drops the three columns when the
  database is opened, which is to say on every machine the update reaches, and
  writes `yard.db.pre-v13-backup.db` beside the file before dropping the first
  one: the columns cannot come back, but the file as it stood can.
- The registers lost three columns with them, which bought the widest sheet
  real legibility: كشف حركة الدخول now prints at 9.86px where it printed at
  7.66px yesterday.

Verified: **176 tests**, typecheck and lint clean. The two grave ones are
locked by tests that state them in the owner's own terms — a container carried
three times keeps serial 1 and the next one is still 2; a struck-out record's
number goes to the next container; a restored record takes a fresh one; all
four registers and the log follow a moved container to its new slot; a departed
one is named by the slot it left from. Schema v13 is proven against a database
built to look like the office's: the three columns go, the container, its
movement, its serial, its staff and the session secret all stay, the backup
holds the old owner name, and re-opening writes no second backup.

In the browser: 19/19 print checks — every cell of four registers measured at
paper size for overflow and for words too wide for their line — 9/9 on the
export and the PDF, 13/13 driving the move-then-reprint and sweeping every
screen and every register tab for the three struck-out words, and the existing
18-check sweep unchanged.

## المرحلة 14 — آلية المناولة، وبطاقتان بلا حبر — 2026-08-12

Status: complete

Built:

- **آلية المناولة** — crane or straddle, the thing that lifted the container
  off the truck. Chosen at the gate and mandatory, because it is a choice
  between two things the crew is standing in front of. Carried to exactly one
  place, which was the owner's whole point: «بدي اياها تبين ب ورقة الدخول
  فقط». The entry card prints it; the exit card does not, and no register
  does. Correctable like everything else a person typed, and the correction is
  named in the log with the old value beside it. Schema v14, a plain defaulted
  column, so records from before it read as nothing at all.
- **The coloured band is off both cards.** A solid strip of blue across the
  head of every entry card and slate across every exit card was a cartridge
  emptied a page at a time — «ما بدي يصرف حبر» — and it was carrying nothing
  the ruling and the weight of the type could not carry. White ground, black
  type, ruled edges, on screen and on paper alike, since what is on the screen
  is what comes out of the printer. Entry and exit are told apart by their
  titles, which is how they were being read anyway.
- The specification's own «الجديد» list was carrying four statements that
  three rounds of changes had made false — hazmat, the second weight, the red
  bays, searching by owner name. They are corrected, not appended to.

Verified: **185 tests**, typecheck and lint clean. In the browser, ten checks
that walk the field end to end: the gate asks for it, refuses to receive a
container until one of the two is chosen, releases the moment one is, prints
it on the entry card with the answer given at the gate, and leaves it off the
exit card. The ink is measured rather than looked at — every element of each
card's head is read for a background more than 15% away from white, and both
come back with none. The other sweeps are unchanged: 19/19 print, 18/18 UI,
6/6 export and PDF.

## المرحلة 15 — البوليصة في الخانة، والآلة باسمها — 2026-08-12

Status: complete

Built:

- **Every bay-sheet cell names its bill.** The grid already carried the
  container number and the class; the third fact is the one the owner opens a
  bay to settle — «لحتى اقدر اعرف اذا هذول الحاويات من نفس البوليصة او
  الحاويات ب بوليصة منفصلة». So the cell reads number on top, class and bill
  beneath, and a bay holding five bills says so at a glance. The column floor
  went from 6rem to 6.75rem — exactly what the added number needs — so the
  widest bay the plan has, ten stacks, still stands whole on a desk screen
  with no sideways scroll.
- **The two machines by the yard's own names**: `CRANE` reads **ونش** and
  `STRADDLE` reads **عقرب**. Labels only — the wire still carries the codes,
  so nothing in the database moved and no record already written changed. The
  words follow the field wherever it shows: the gate sheet, the container
  card, the edit form, and the entry card that gets printed.

Verified: 185 tests, typecheck and lint clean, and two browser sweeps. The bay
sheet: 9/9 at two screen widths, nothing clipped in any occupied cell, five
distinct bills legible in one bay. The naming: 16/16 — the gate offers both
words and still refuses to receive a container until one is chosen, the card
and the entry card print what the gate chose, the edit form changes it and the
change sticks, and the old words are gone from every surface and from the
shipped bundle itself.

Noticed, not fixed: a chooser button inside a field's `<label>` takes its
accessible name from the label and its neighbour — the ونش button announces as
«آلية المناولة عقرب». It affects the 20/40 chooser the same way. Nothing on
screen is wrong; it is what a screen reader would say.

## المرحلة 16 — البحث في كل كشف، والترقيم بلا فجوة — 2026-08-12

Status: complete

Built:

- **One search box over every register, reading every column.** «بدي كل
  الكشوفات يكون الها امكانية البحث عن اي معلومة» — so it is not a filter per
  column but one box that reads the sheet itself: the container, the bill, the
  plate, the seal, the slot, the date, the employee, a word out of a note.
  Every word typed narrows it further, and the folding is the one a reader
  does anyway (أ/ا, ة/ه, ى/ي, the harakat, and ٣٢١٠ finds 3210). What
  survives the search is what the screen shows AND what the printer, the PDF
  and the Excel file carry — with «بحث: …» written into the sheet's own head,
  so a filtered page can never leave the office reading as the whole register.
  The per-row buttons keep pointing at the row they sit on: the filtered rows
  carry their original index with them.
- **The register is held to 1 … N with no hole in it.** The owner found the
  fault on the office machine: «صار خطأ ب التسلسل … بسبب الحذف». Striking out
  the LAST record hands its number back, which already worked — but striking
  one out of the MIDDLE left every number after it where it was, and the hole
  never closed. Now the year is counted through again, in gate-date order,
  after anything that changes which records are live: a deletion, a record
  brought back, a corrected gate date. He chose this over letting new arrivals
  fill old holes, knowing the cost: a card printed before the deletion may no
  longer match the number the system now holds.
- **It is a rule, not a migration step.** It runs on every open, so a file
  arriving from an older machine or out of a backup is repaired the moment it
  is opened — and a file already whole is left untouched and writes nothing.
  The one time it has something to change it copies the file beside itself
  first: `yard.db.pre-renumber-backup.db`.
- **The bill in the bay sheet takes a line of its own**, at the size of the
  container number rather than the small grey it was — «بتقدر تكبر هاي الخط
  تبعها شوي». Beside the class chip a nine-digit bill would have been sawn
  off; on its own line it has the cell's full width.

Verified: **195 tests** (10 new), typecheck and lint clean, and two browser
sweeps on the real build. The search: 32 checks across كشف الدخول, كشف
الخروج, كشف الحاويات في الساحة and سجل العمليات — every row left carries the
term, off-page rows included (read by textContent, since innerText answers
blank for a row the pager has hidden and would have let this inspect one page
and call it the register); the sheet head names the filter; nothing answers →
it says so and offers nothing to print; clearing brings the whole register
back; and the «بطاقة» button on a filtered row opens THAT container, not the
one that used to sit at its index. The serials: a register of 57 cards read
1 … 57, a record was struck out from the middle through the screen, and it
read 1 … 56 — no number missing. The bay sheet: 13 checks with nine-digit
bills written onto a whole bay, nothing clipped sideways or downwards, and
the widest bay on the plan still whole at 1283px.

## المرحلة 17 — الورقة بيد الموظف: بطاقة الدخول تلقائياً، وبطاقة نقل — 2026-08-14

Status: complete

Built:

- **The entry card prints itself.** Receiving a container is done FOR the
  card, and the clerk was being made to find the container again and press a
  button for it. `api.gateIn` already returned the record it created and the
  screen was throwing it away; now it goes up with the message and the card
  is on the desk before the truck has moved. The same shape the exit card has
  used all along.
- **بطاقة نقل** — the third paper, and the one the yard had none of: «بدي
  يبين اذا بدي انقل من المكان الموجودة فيه الى المكان الجديد». It opens by
  itself the moment a move is confirmed, and its table LEADS with «من الموقع»
  and «إلى الموقع», since that is the whole reason it exists. No truck and no
  driver on it — nothing left the yard — and no receipt clause, which attests
  to taking a container in. It is a working paper inside the yard: on no
  register, exactly as آلية المناولة is on none.
- **A third ledger, under the same rule.** The move card is numbered per year
  like the two gate cards. It lives on the MOVEMENT rather than on the
  container, because one container is moved many times — schema v16, two
  nullable columns on `movements`, read from the file's own shape. And it
  joins the existing renumbering rule rather than inventing a second story:
  striking out a record closes the hole in all three of its ledgers at once,
  and every one of them is held to 1 … N on every open.
- **Gravity is on the paper.** Lifting a buried container brings the stack
  above it down a tier, so a card naming only the container moved would
  describe a stack the yard no longer has. The descents ride on the movement
  itself as JSON — the same shape an EDIT's note already used — so reprinting
  the card months later still says what it said that day, with no extra route
  on the server. Each descent takes its own line, and every code on it is an
  unbreakable left-to-right word: the first cut of this printed «…من 2» at
  the end of one line and «-A-01-08-B إلى» at the start of the next, which is
  not an address any more. The log tells the same fact in one Arabic
  sentence rather than showing raw JSON.
- **Reprint** from the container card, offered only if it has ever moved.

Verified: **198 tests** (3 new), typecheck and lint clean, and 22 browser
checks on the real build — the entry card appearing with nobody pressing
anything, the move card's two slots read back and compared against the slot
the container actually stood in, its own serial and year, the reprint showing
the same move, a container never moved offering no move card, and a buried
container's move naming both descents with their tiers, each code measured
for `nowrap` and `dir="ltr"` so no address can be sawn in half. The other
sweeps are unchanged: 19/19 print, 18/18 UI, 32/32 register search.

## المرحلة 18 — ترتيب الكشوفات بالضغط على العمود — 2026-08-14

Status: complete

Built:

- **Every column heading is a control.** Press it once for تصاعدي, again for
  تنازلي, a third time to put the register back in its own order — «بس اكبس
  على العامود الخاص فيهم». It applies to every column of every register, and
  the two the owner named by hand are the ones it was built for: موقع الحاوية
  and رقم البوليصة.
- **Numbers are read as numbers.** Bills are numbers written as text and of
  different lengths, so plain text order puts 265313216 above 3210; an
  `Intl.Collator('ar', { numeric: true })` reads the digit runs and puts 3210
  first. The same rule sorts slot codes part by part, so stack 10 lands after
  stack 02 rather than between 01 and 02.
- **A cell can say what it is ordered BY.** A date reading «14/08/2026» sorts
  by the instant behind it, the dwell by its number of days, and a container
  that has not left yet carries Infinity so it sits after every departure —
  compared as `a === b ? 0 : a < b ? -1 : 1`, never `a - b`, because
  Infinity − Infinity is NaN and a NaN comparator leaves the order undefined
  rather than merely wrong.
- **The line counter counts the lines of THIS sheet.** Sorted or narrowed by a
  search, column «الرقم» still reads 1, 2, 3 down the page, which is what a
  printed register has to do.
- **What is on the screen is what is printed.** One model feeds the screen,
  the printer, the PDF and the Excel file, and the sheet's own period line
  gains «مرتّب حسب … — تصاعدي» so a page in a different order than the
  register's can never be read as the plain thing. On paper the heading is a
  heading again: a print rule flattens the button's padding and colour, and
  the caret is print-hidden.
- Switching register resets the order: one SheetScreen serves six registers,
  and an order by column 12 means nothing in a register that has six columns.

Verified: **212 tests** (14 new, pure, over the comparator, the ordering and the whole composition),
typecheck and lint clean, and 16 browser checks on the real build — slots up
and down and back to the register's own order, the descending list proved to
be the ascending one reversed, bills ordered numerically, the line counter,
search and sort composing, the «بطاقة» row button still opening the row it
sits on after a sort, dates ordered by their instant, and the DOM order that
prints proved identical to the screen's. The print measurement sweep found
the sort caret being measured into the heading width and now reads only what
the page actually paints: 19/19. The other sweeps: 18/18 UI, 32/32 search,
24/24 cards.

**Reviewed before it shipped.** An adversarial pass over this change — four
lenses, every finding put to two independent skeptics told to refute it —
returned six that survived, five of them real:

- **The line counter was offered as a column to order by.** Column «الرقم» is
  rewritten 1 … N over whatever the sheet shows, so ordering it ascending was
  a guaranteed no-op that still stamped «مرتّب حسب الرقم — تصاعدي» onto the
  paper, and descending reversed every row while the column itself went on
  reading 1, 2, 3 under a ▼ and an `aria-sort="descending"`. It is a plain
  heading again.
- **The search was reading that same counter.** A row could answer «10»
  because it was line 10 of the register, and the one cell that matched was
  erased by the renumbering before the row was shown — a hit with no visible
  reason, riding onto the printed sheet under «بحث: 10». The counter is out of
  what the search reads.
- **Blanks led the sheet.** An em dash is how this register writes "nothing
  recorded", and it collates before every real value, so ordering كشف بوليصة
  by slot opened with a block of departed containers. Rows with nothing in the
  ordered column now go to the FOOT in both directions.
- **The heading's tooltip had two states for a control with three**: after
  descending it promised «ترتيب تصاعدي» and delivered the register's own order.
  It now names what the next press will actually do, «إلغاء الترتيب» included.
- **`p-0` on the heading cell never took effect** — `cellBase` carries `px-2
  py-1.5`, and Tailwind emits shorthand before longhand, so the cell kept its
  padding and the button added its own on top.
- Weights are read as the figure they mean, so a hand-typed «28,000» orders
  beside 9000 rather than before it.

The composition the review found untested — filter, then order, then renumber,
while every row keeps the original index its buttons are addressed by — was
pulled out into `src/client/sheetView.ts` as one pure function and locked with
six tests of its own.

## المرحلة 19 — الخروج يُصحَّح، والفئة تُقفل، وحاسبة الامتلاء — 2026-08-14

Status: complete

The owner sent eleven requests in one message. Four of them are projects in
their own right (driver accounting, photos, the customs-PDF import, an editor
for zones and yards) and were named and deferred; he chose this batch, and he
chose which of it comes first.

Built:

- **An exit can be corrected, and it can be taken back.** The record used to
  FREEZE the moment a container left: one `inYard` condition wrapped all four
  action buttons, so a departed container offered نقل, إخراج, تعديل and حذف —
  none of them. The edit form and the server had supported exit fields all
  along; nothing opened them. Now تعديل is offered whether it is standing or
  gone, and **إلغاء الخروج** returns it to its own slot, voids its exit card
  and hands the serial back to the year's count, writing a `RETURN` movement
  so the log says what happened rather than pretending nothing did. It
  returns to ITS OWN slot or not at all: whatever stood on it came down a
  tier as it left, so the refusal names who is standing there now.
- **The class is fixed for the life of the record.** It was editable once the
  container had left — exactly when nothing on the map contradicts it — and a
  40 occupies two slots to a 20's one, so a class corrected after the fact
  falsifies the ground and every count taken off it. The control is gone from
  the form and the server refuses with SIZE_LOCKED.
- **An edit no longer disturbs the entry date.** The form shows the gate date
  to the minute, so what it handed back for a field nobody touched was that
  minute with the seconds shaved off — a different instant every save. Every
  edit therefore "changed" the entry date: the IN movement was retimed under
  the register, and since v15 the year's card serials were re-seated too. The
  dates are compared by the clock now, and an untouched record keeps the
  instant it already carries.
- **The log's undo is the owner's alone**, on the server and on the screen.
- **The truck register names the driver**, from what the gate already records.
- **«كم باقٍ حتى تمتلئ الساحة»** — the old figure answered a different
  question: how many slots would accept a container this minute (681 for an
  empty yard, one per stack), and its forty-foot number counted POSITIONS,
  which is not a count of forties at all. The calculator answers in
  containers: twenties are what is free, forties are a packing count — two
  adjacent odd bays on one stack, standing only on forties — and the height
  is the office's own assumption, three tiers or two, switchable on the
  screen without touching what the yard accepts.
- Schema v17: the movements table gains the RETURN type, rebuilt carrying the
  card columns v16 added.

Verified: **229 tests** (11 new, including the two defects reproduced before
they were fixed), typecheck and lint clean, and **31 browser checks** on the
real build — the departed record's buttons, the class stated with no control
to press, a note saved with the entry instant and the card serial measured
before and after, an exit taken back through the screen with the ledger
re-counted, the calculator's two answers on both heights, the driver column
filled, and an employee holding every permission seeing no undo in the log.

## المرحلة 20 — الناقلون وسياراتهم، و«عرض الكل» — 2026-08-23

The owner sent his fleet list and asked to SEE it in the system: «يوجد لدي
بعض ارقام السيارات لدى الناقل بهاء اريد ان اضفيفهم لدى بهاء … اريد ان ارى
الكشف وكيف بأمكاني اضفة الناقل وكيف بأمكاني توزيع السيارات … واريد كشف
سيارات بناءا على الناقل» — and, in the same message, «وفي التقارير اريد جعل
في كل صفحة عرض الكل».

- **Schema v18: `carriers` and `trucks`**, soft-deleted like everything
  else, seeded ONCE on the open that creates them: بهاء أبو الربع with the
  27 trucks he dictated (all code 60, each with its driver), and عادل أبو
  غليون empty, to be distributed from the screen. The registry sits BESIDE
  the gate records — the gate still writes free text, and nothing already
  written moves when a truck is registered, moved or struck out.
- **Matching is normalization, not equality** (`src/shared/fleet.ts`, pure,
  shared by both sides): «60-84785», «60 84785», «٦٠٨٤٧٨٥» and «84785» all
  name one truck. A bare number carried by two carriers under different
  codes is refused as a guess — only the full plate decides. The same module
  splits a gate spelling back into code and number for the assignment form.
- **«الناقلون» screen** (owner alone): carriers with their fleets, add and
  rename and delete (a carrier still holding trucks refuses by name —
  CARRIER_HAS_TRUCKS), add a truck, edit it, hand it to another carrier from
  a select on its own row — and the distribution bench: every plate the gate
  has recorded that no carrier owns, with its trip count and the last driver
  written beside it, an «إسناد» button away from its carrier.
- **The gate recognises a registered plate** as it is typed, at entry and at
  exit alike: the carrier's name appears under the field and the driver
  fills in by itself — into an empty field or over this form's own earlier
  suggestion only, never over a person's typing.
- **كشف سيارة grew a second face**: pick a carrier and the sheet gathers his
  whole fleet's movements whatever the gate's spelling, with a plate column
  whose every cell drills into that one truck's register; the single-plate
  face names the plate's carrier in the title when it knows it.
- **«عرض الكل»** on every dated register (entries, exits, daily, truck, log):
  one press shows the whole record, the date pickers step aside, and the
  paper's period line says «كامل السجل حتى تاريخه» so a full-record sheet
  never reads as a period sheet.

Verified: **253 tests** (24 new: the normalizer's spellings, the ambiguity
rule, the seed counted and proven to seed exactly once on a real file, CRUD
and its refusals, the bench filling and emptying, and the carrier register
gathering three spellings of one plate while a stranger's stays out),
typecheck and lint clean, and **28 browser checks** on the real build from a
first-run database — the seeded fleet on screen, a truck moved to عادل and
back, the gate filling «علي جميعان» off «60-93896», the carrier sheet titled
and filled, «عرض الكل» swallowing the pickers, the bench assigning
«77-55555» split into code and number, and an employee seeing no button and
being refused by the server anyway.

Away from the code: the office machine was found still running the previous
build — the owner's «النسخة القديمة … يوجد مشاكل لم يتم حلها» — proven by
fetching its bundle over Tailscale (read-only; not a byte of its data was
touched, as he ordered three times) and finding «إلغاء الخروج» absent from
it while the Desktop AqabaYard-Setup folder carries it. The fix is his own
one step: copy the folder across and run التثبيت.

**Follow-up, same night.** The owner's dev server (tsx watch, live on this
machine) reloaded mid-edit while v18 was being written: it created the two
tables before `seedFleet` existed, crashed, and every later open found the
tables present and never seeded — he opened «الناقلون», found it empty, and
added «بهاء ابو الربع» by hand. Two consequences: the seed condition now
counts rows instead of asking whether the table exists (`carriersEver === 0`),
so a process that dies between creating the tables and seeding them leaves a
state the next open finishes — while soft-deleted rows still count and
nothing he strikes out is ever re-planted. And on his order — «افصلهم على
بيئة التطوير» — the dev database was separated through the store layer
itself: his own hand-added carrier kept (his spelling, his row), the 27
registered under it, «عادل ابو غليون» created, and the 43 remaining gate
plates assigned to عادل each with its trip count and latest driver; «00»
alone left on the bench, not being a plate. Noted for the owner: the list's
82462 (محمد جمعه) never passed the gate, while 60-82463 passed 21 times
under the same driver's name — likely one typo, his call which.

**Backup and restore, same night.** The owner suspected the backup — «تأكد
من موضوع النسخ الاحتياطي لانه لا ينسخ كل شي». The backup itself was whole
(VACUUM INTO copies the entire file, fleet included); the RESTORE was not:
`copyAcross` copied four tables by name — users, containers, movements,
settings — a list written before the fleet existed, so a restore silently
dropped every carrier and truck while claiming success. It now enumerates
the tables from the two files themselves (intersected, sanely-named only,
since the upload arrives over the wire), copies every one, reseats
sqlite_sequence for every AUTOINCREMENT table rather than a chosen few, and
answers with the full count — containers, movements, users, carriers,
trucks — which the screen prints, so «رجع كل شي؟» is answered by numbers.
A backup from before v18 restores WITH the fleet: the upload is migrated
first, and migration now seeds an empty carriers table. Two new tests: a
distinctive fleet (a truck handed to عادل, one struck out, one registered
fresh) round-trips exactly, soft-deleted row included, and new ids continue
past the restored ones; and a pre-v18 file (fleet tables dropped whole)
comes back seeded. 255 tests.

## المرحلة 21 — تصريح التحميل والخروج الداخلي — 2026-08-24

The owner's order, marked «احرص اولا»: a new paper and its register — «كشف
جديد اسمه كشف خروج وتحميل داخلي». The paper is مؤسسة الحق's permission
sheet for one bill: «يسمح بتحميل واخراج الحاويات المبينة ادناه من ساحة رقم
( ) الى داخل موقع المقص فقط», closed by «توقيع وختم موظف مديرية التخزين».

- **Schema v19**: `permits` (serial, serial_year, bill, at, user) and
  `permit_items` (container, truck), soft-deleted, with `renumberPermits`
  holding the book to the ledger rule — live permits of one year read
  1 … N — on every open, after every void, and after a restore (copyAcross
  renumbers the permit book alongside the card ledgers; the training wipe
  clears the practice permits with the practice containers, and the
  table-enumerating restore carries them back without naming them).
- **Issuing**: from the bill's own sheet — «إصدار تصريح تحميل وخروج» opens
  the bill's containers, each with a checkbox and the plate of the truck
  that will carry it out; the fleet watches the field and names a
  registered plate's carrier; a blank plate stays blank on paper, to be
  written by hand at loading. GATE_OUT issues (it is exit paperwork); the
  server refuses a stray container of another bill and a doubled line —
  and issuing MOVES NOTHING on the ground.
- **The paper**: organisation over title with the yard's number read off
  the layout, the serial/bill/date strip, the permission sentence, the
  items table (entry-card voucher serial, container number, entry date,
  truck), the storage directorate's signature block. A4 portrait, no ink
  band, printed through the same .print-area isolation as the cards.
- **The register**: كشف خروج وتحميل داخلي in the reports — serial, day,
  date, time, bill (a doorway), container count, employee — with search,
  column ordering and «عرض الكل» like every register; each row reprints its
  paper; voiding is the owner's alone and closes the year's book.

Verified: **263 tests** (7 new: the numbered book, the entry-card facts on
the paper, the four refusals, the permission split, the reprint, the void
closing the gap, the wipe and restore carrying the book), typecheck and
lint clean, and **20 browser checks** on the real build from a first-run
database — the issue button on the bill sheet, the form excluding the
stranger's container, the carrier named off a typed plate, every block of
the paper read on screen, the register row reprinting it, serial 0002 then
the void leaving 0001 with no hole, and a clerk without GATE_OUT seeing no
button and being refused by the server anyway. An adversarial multi-agent
review ran over the whole diff before commit.

## المرحلة 22 — التصريح على مذهب المكتب، والكشوف تفتح كاملة — 2026-08-24

The owner tried the permit on the dev machine the hour it landed and sent
three corrections, and the adversarial review (18 agents over 5 lenses,
12 findings confirmed) came back the same hour. One batch answers both.

- **The permit takes departed containers** — the owner's own flow: «ادخلت
  رقم البوليصة لحاويات التي خرجت». The gate records the exit first and the
  paper prints after, so the issue form now lists the WHOLE bill, the
  departed boxes wearing a «خرجت» chip with their exit truck already in
  the plate field, and the server no longer refuses ALREADY_OUT.
- **Schema v20 — the lines are a snapshot**: permit_items carries number,
  entry-card serial/year and entry date AS ISSUED (backfilled by a sniffing
  upgrade for tables born under v19). A reprint now always matches the
  stamped original in the drawer, even after the container is corrected,
  renumbered, or struck out — the review's sharpest finding, proven with a
  live probe before the fix and pinned by a test after it.
- **The paper prints whole**: the review's one HIGH — an overlay pinned to
  the screen prints exactly one page, so a 32-line permit lost everything
  past line ~20. On paper the overlay now leaves the viewport (.permit-print
  turns the fixed shell absolute at the document top, scroller and clipping
  off), and the harness prints a 32-line permit onto 2 pages. The serial
  prints the card way — number big, year on its own small line — instead of
  overflowing its box at the card's 20pt.
- **Review fixes around it**: reprint failure now speaks (a voided permit's
  stale row answers with the refusal sentence, not silence); the issue
  sheet is keyed by bill so a second «إصدار تصريح» starts fresh; Escape
  closes only the TOP overlay (a registration stack in useEscape); and the
  restore confirmation counts the permit book too. The one finding settled
  by documentation: reaching the register needs REPORTS, so issuing from
  the screen takes REPORTS + GATE_OUT — SPEC says so now.
- **كشف السيارات وكشف البوليصة يفتحان على كل شيء** — «عند دخول كشف السيارات
  او كشف البوليصة يظهر جميع المعلومات»: no plate and no carrier shows every
  gate movement of the period both ways; no bill shows every container
  record with a bill column, each cell a doorway. Typing narrows exactly as
  before.
- **البحث الذكي**: a digits-only term reads through separators per column —
  «6084785» finds 60-84785, «00052026» finds card 0005/2026 — and the map's
  own search box folds Arabic-Indic digits (٣٢١٠ finds 3210).
- **«التراجع عن طريق السجل»**: an OUT line in سجل العمليات now carries
  «إلغاء الخروج» for the owner — the same walk-back the container card
  offers, reachable from the register being read.

Verified: **270 tests** (departed-container issue, snapshot reprint after a
renumber, the v19→v20 backfill, the all-plates and all-bills registers, the
digit-run search, the permit count in the restore reply), typecheck and
lint clean, and **17 browser checks** on the real build — among them the
issue sheet's three «خرجت» chips with 505 prefilled, the two-page PDF, and
the log-line exit cancel answering «تم إلغاء خروج الحاوية…».

And on the owner's follow-up — «تماما مثل كشف البوليصة» — the paper's table
now wears the register's own ruling: the tinted header band, the
alternating rows, and the bill sheet's المجموع row (عشرين/أربعين split,
the size joining live because SIZE_LOCKED means it can never drift) closing
the table before the signature block.

His screenshots then showed the dark office — «يوجد اخطاء عديدة بالتصميم»:
the issue sheet's one-line rows overpainted each other at 380px (the green
carrier name across the container number, «خرجت» cropped at the edge), and
the paper rendered in the dark palette. Two answers, both verified by a
dark-mode harness with screenshots read by eye: the sheet's rows became two
quiet lines (box and badges, then entry facts and the plate, the carrier on
its own truncated line — a geometric overlap probe finds nothing), and
`paper-light` re-declares the light vocabulary inside every paper — the
permit and the gate cards are white sheets whatever the office theme, and
@media print forces the same on every print area so a register printed
from a dark screen comes out on white paper too. المجموع also learned its
Arabic agreement: «5 حاويات», not «5 حاوية».

## المرحلة 23 — الأرض التي يرسمها المالك — 2026-08-24

«ليس لدي امكانية من اضافة زون او ساحة» — the biggest deferred project,
started the hour the owner answered its three questions: addresses read
like yard 2's (`1-F-07-09-A`), a closed slot refuses placement and he
chooses which, and the tiers stay three, always.

- **The ground opens without the plan moving**: `Zone` widens from the
  A…E union to a string; the LAYOUT — the committed ASEZA drawing plus the
  owner's zones (v21 `custom_zones`) — becomes the one judge of what
  exists. `composeLayout` (shared) builds the effective yard for both
  sides and teaches the address registry each zone's yard, so
  `positionLabel` writes the right leading digit everywhere; the
  containers table is REBUILT to drop its `zone IN (A…E)` CHECK (the
  schema stops judging ground; sniffed by the CHECK's own text, per the
  v11/v17 pattern).
- **The editor** («الساحات», owner-only): yard number, letter (unique
  across every yard — the letter alone decides the address digit), bays ×
  stacks; the grid drawn THE YARD'S WAY on the owner's correction —
  bordered strip, bay numbers over wide dashed cells, three tier layers
  inside each — and a tap closes a slot into the map's own hatch. The
  server refuses any reshape or delete that leaves a standing container
  without ground (ZONE_HAS_CONTAINERS), and the PATCH is PARTIAL — a
  nudge sends the position alone, a save the closed slots alone — after
  the harness caught a nudge resurrecting a stale empty `closed` over a
  save made a second earlier.
- **The map**: yard tabs when more than one yard exists; the search swings
  to the yard its answer stands in; the free-space chips count per yard;
  and the OWNER drags his zone by its title bar (pointer capture, deltas
  read through the SVG's screen matrix so pan/zoom cannot lie) — official
  zones are not in the draggable set and never move. Arrow-nudge and
  auto-place remain in the editor.
- **Permits follow the ground**: the paper names the yard its standing
  containers are in (v21 `permits.yard`, sniffed in for older books).
- **«عرض الكل» في كل صفحة**: the page-size list's last entry shows the
  whole register on one page — the owner's ask, pointed at the dropdown.

Verified: **278 tests** (8 new: definition and refusals, ground realness
at `1-F-07-09-A`, the closed slot, the no-orphaning rule end-to-end, the
permit's yard, the composer's shape and registry) and an **11-check
browser harness** on the real build — the editor's yard-style grid, the
closed cell hatching and refusing from the server, the yard tabs, a
gate-in through the map of ساحة 1, the drag-savable position, and the
whole-register page — its screenshots read by eye.

And the same evening: **«ملاءمة العرض»** — «اذا بدي اخلي الكشف ما في سكرول
يمين وشمال بس دون ما انقص البيانات هل هذه الشي ممكن؟». It is: a toggle on
every register scales the whole sheet by the plain ratio of the screen's
width to the sheet's own natural floor (zoom, floored at 0.45 so type
never shrinks past reading), the same promise the printed page keeps. The
width watcher chases the scroller with a state ref because the table only
mounts once rows exist — the first build measured a null node and scaled
nothing, caught by the harness (426px of overflow → 0, 16 columns before
and after, zoom 0.73, and the second press putting everything back).
Print CSS pins zoom back to 1 — paper has its own fitting arithmetic.
And on the owner's clarification — «ما بدي يكون في scroll يمين وشمال
لحتى اشوف كل البيانات … مثل كشف حركة الدخول والخروج» — fitting is the
DEFAULT: every register opens already inside the screen, and the button
turns it OFF for whoever wants full-size type and a scroll. Verified on
both gate registers: overflow 0 on open, 16 columns, zoom 0.73, and the
switch-off bringing back 435px of scroll.

Next morning (2026-08-24), one line from the owner — «من كشف خروج وتحميل
داخلي اريد ازالة ارقام السيارات من الكشف فقط» — and the permit paper
dropped its «رقم السيارة» column: the plates stay typed and stored in the
permit screen (the gate still names the carrier from the registered
plate, and the truck register still shows every haul), but the printed
paper now rules four columns — التسلسل، سند الإدخال، رقم الحاوية، تاريخ
الدخول — with the totals row spanning what remains. Nothing else moved:
the snapshot rule, the yearly ledger, and the reports register (which
never carried plates) are untouched.

The adversarial review of the whole zones/papers/fit batch came back: 32
agents, five lenses, every finding hunted by its own refuters — 26
confirmed, deduplicating to ten distinct wounds, all closed the same
night. The deep one: yardOf read a registry taught only by LIVE zones, so
deleting zone F (or reusing its letter) silently rewrote every historical
1-F-… address to 2-F-… on the next restart — reprints contradicting the
stamped originals. Now a struck letter is reserved forever (NAME_TAKEN,
live or dead), GET /api/zones carries the retired letters, and both
sides' registries keep labelling history; backup already carries deleted
rows wholesale, so restores keep the promise too. Alongside it: the
permit of a fully-departed bill reads its yard off lastExitPosition
instead of pinning 2; auto-placed zones flow below the lowest parked
strip instead of across it; BAD_SLOT stopped blaming «المخطط الرسمي» for
owner ground and now names remedy as well as cause; NAME_TAKEN explains
the reserved letter; the registers' scroller got scrollbar-gutter:stable
so default-on fit cannot oscillate with the scrollbar; a failed zones
fetch shows a retry banner instead of silently dropping owner yards from
the map; rapid nudges build on the last written spot (no lost steps); the
closed-slots grid resyncs when the server's own set changes; the 8-second
state poll pauses behind the zones editor; and a dragged zone clamps to
the server's 5000-unit fence so no drop ends in a refusal. Three new
tests pin the big three: the reserved letter with intact history, the
departed bill's permit yard, and the parked-band flow — 281 in all.

Then the owner commissioned the two he had deferred — «اشتغل على هدول
الثنتين» — and answered the open questions in the same breath: the wage
is written BY HAND per haul, no currency («نكتفي بالرقم»), with a
receipt confirmation per haul because one truck hauls many times; and
for the wrongly-recorded move, «نعم تعديل». So one evening shipped three
features. (1) Driver accounting: a new ACCOUNTING permission, wages and
receipts on a `wages` table keyed (container, direction) — the IN and
the OUT are two payable hauls — a paid figure locks until the receipt is
lifted, and «حساب السائقين» groups the period per driver with totals and
prints each driver a register-ruled paper closed by his signature line.
(2) Photos: a `photos` table holding the BYTES IN THE DATABASE so the
backup and restore carry them with everything else (proven by test);
raw-body upload capped 8MB/30-per-box, thumbnails and a full view on the
card beside the notes, soft delete, and «طباعة الصور» printing the
container's head and every photo across pages. (3) Move correction: the
card offers «تصحيح النقلة» when the standing slot came from a MOVE; the
same map picking flow PATCHes the movement itself — same card serial,
true slot, an EDIT line in the trail, no second move — refusing anything
but the last placement, a buried box, or an unusable landing. All three
verified twice: 290 tests (9 new across drivers/photos/correctMove),
and a 17-check browser harness on the real build — the accountant's
screen with a written wage and a stamped receipt, the driver's printed
paper, the photo thumbnail-to-paper flow, and a correction that left one
MOVE with its original serial reading the corrected slot — screenshots
read by eye.

He answered the shipment with three sharpenings the same night. «بدي
القدرة البحث عن اسم السايق او رقم سيارته»: the drivers ledger grew a
search box that folds Arabic and Western digits and keeps the WHOLE
statement of a driver found through any one of his plates — the point is
settling with the man, not finding a row. «بدي اقدر اضيفها عند ادخال
الحاوية وتكون اختيارية»: the gate-in form takes photos with the record —
picked with previews, uploaded after the 201 so a failed picture never
fails the entry — and the upload permission widened to GATE_IN (delete
stays EDIT), so the same clerk who receives the box photographs it, at
the gate or later from the card («مكاني ثاني» — already there). «لحتى
ارفقها بالمعاملة عند طباعة بطاقة الدخول»: the entry card now offers the
container's photos as pages of its own print — on by default when photos
exist, «طباعة بلا الصور» turns the paper back into the card alone — the
overlay borrowing the permit-print flow CSS so the pages actually break
(proven: a tall photo made page.pdf() count 2). 291 tests, and a
13-check harness on the real build with the screenshots read by eye.

His screenshots caught what my harness had not: the photos paper opened
FROM THE CARD printed 1/1 with the third photo sawn off — the overlay
was nested inside the card's own DOM, and a clipping/transformed
ancestor cuts an absolutely-positioned print area to one page (the
permit's old wound, through a door I had not tested). And he ruled the
card's screen must stay clean: «فقط اكتفي بكلمة طباعة بصور وبدون صور».
So: every print overlay (PrintCard, PrintPermit, PrintPhotos, the
driver's paper) now PORTALS to document.body — no ancestor left to clip
— and the entry card of a photographed container shows exactly two
buttons, «طباعة بصور» and «طباعة بدون صور»; the photos block lives
display-none, becomes print-only when the first button is pressed
(afterprint spends the choice), and the screen never shows a photo.
Proven by a 14-check harness that counts REAL pdf pages at every print
door: the register 3, the 40-item permit 2, the plain card 1, the card
«بدون صور» 1 and «بصور» 4, the three-photo paper 3 (his 1/1 case), and
the 43-haul driver statement 6 — nothing truncated anywhere.

The next batch came as one long message and shipped as one evening.
The drivers ledger: search now cuts ROWS («اريد فقط ظهور السيارة التي تم
البحث عليها») so a plate shows its own hauls and the totals sum the
screen; three filters joined it — direction, received/not-received, and
carrier off the fleet registry — and the wage field stopped freezing
anything while it saves. The truck register grew the same all/in/out
switch («كي لا يتم التضارب»). Every container register's action column
grew a «تعديل» pencil that opens the card OVER the register with the
edit form out — which surfaced that the card lived inside the map's own
JSX and could not mount over any other screen; it moved to the common
overlay layer, and moving/correcting from it folds the register away to
show the map. The delete button now also serves a departed record. The
map search reaches the seal, server side included. Soft amber doubts —
never refusals — flag a plate off the NN-NNNNN pattern (Iraqi trucks
pass, warned) and a weight outside 1–45 tonnes, at the gate, the exit
and the edit form; a fleet-registered plate is trusted silently. And the
photo weight problem died at the source: every picked photo is shrunk in
the browser (longest side 1600, JPEG) before upload, the photo route
tells the browser to cache forever, thumbnails load lazily, the photos
header and its two small buttons sit on one line, and the card's printed
photo attachment opens its own clean page. 293 tests (delete-exited,
seal search), and a 14-check browser harness — filters counted rows,
the pencil opened the form over the register, the doubts glowed amber —
screenshots read by eye.

And the hosting question closed with the owner's own ruling: NO cloud
server, not even a cheap subscription — «لا اريد ان ارفع النظام على
سيرفر سحابي ولو كان ب اشتراك عادي». The office machine stays the one
server, the data stays in the yard, and reaching it from anywhere is
Tailscale's job (already installed there, already serving the ts.net
URL): each new device installs the Tailscale app, signs into the same
account, and opens the same address. Front and back stay ONE process —
no split, ever, for this system.

Two corrections the next morning. First, MY error on the record above:
the owner's «لا اريد ان ارفع النظام على سيرفر سحابي» read backwards —
he clarified «قصدت اني اريد سيرفر سحابي لا على tailscale»: he WANTS the
cloud VPS and it is Tailscale he refuses. So `deploy/cloud/` was born: a
one-command Ubuntu setup script (Node 24, npm install on the server —
never Windows node_modules — systemd service, Caddy with automatic
HTTPS, UFW closing everything but SSH/80/443), the unit file, the
Caddyfile template, and اقرأني-السيرفر.md walking him rent → upload →
one command → restore the office backup → weekly backup habit. One
process serves client and API — front and back never split. Second, the
permit grew its weight: «اريد وضع خانة للوزن ايضا واظهارها بالطباعة» —
permit_items snapshots a weight column (v23, old lines backfilled from
their containers), the issue screen prefills it from the record and lets
the clerk correct it before the stamp, and the paper prints الوزن (كغم)
between the number and the entry date. Proven the snapshot way: a permit
issued with 30480 over a weightless container reprints 30480 (294
tests), and a browser probe watched 28500 prefill, become 28900 by hand,
and land on the printed paper.

The weight change went through its own adversarial panel (9 agents)
before shipping, and all five confirmed findings closed the same hour:
the v20 AND v23 ALTER+backfill now run in one transaction (exec commits
per statement — a death between them would have skipped the backfill
forever); restore no longer 500s on a brand-new install that never took
a backup (mkdir before the scratch write, locked by a regression test
with a second fresh app); api.createPermit's wire type finally names the
weight (a wieght: typo compiled clean before — proven by the verifier);
the permit sheet's facts row WRAPS instead of overflowing the 380px
panel by 65px (measured in headless Chrome by the verifier); and an
unrecorded weight prints the row's own «—», not an invitingly blank box.
295 tests.

## المرحلة 24 — شرائح الصفحة، وحرف الزون يعود، ودليل السيرفر — 2026-08-26

Three asks in one message. First, the register toolbar: «حسن الترتيب
الخاص ب الفلاتر و البحث بالأضافة على اصلاح ال dropdown menu» — the
native per-page select drew its popup on the OS's light sheet with the
site's pale dark-theme ink, unreadable. With «الغي العشرين وخلي عندك
50 او 80 او عرض الكل» the choices fell to three, so the dropdown is
GONE: a segmented trio of visible buttons (50 · 80 · الكشف كامل), no
native popup to break, one press instead of two. The header split into
two deliberate lines — period+filters, then search+page-size+actions —
and a global CSS rule paints every remaining native select's options
with theme tokens so the carrier picker reads in both themes. Verified
by a headless-Edge probe: dark, light, and a 900px viewport with zero
horizontal overflow.

Second, «اضافة زون ولم احفظ الشكل وحذفته واريد ادخال نفس الرمز يخبرني
انه موجود» — the retired-letters-forever rule was punishing a slip of
the hand. The rule's REASON is history: a letter is reserved so old
papers keep their yard digit. A zone deleted before any container ever
stood in it has no history to protect, so `listRetiredZones` now
returns only struck letters that movements/containers actually
reference (newest row per letter, none owned by a living zone), and
the create route's taken-check frees the rest automatically. Soft
delete untouched — the scrapped row stays in the table, it just stops
riding the wire. A letter that ever held a box stays reserved forever,
exactly as before (test proves both halves).

Third, «اريد روابط وخطوات واضحة ومفصلة اكثر لانه لا علم كيف وهذه اول
مره» — اقرأني-السيرفر.md rewritten as a true first-timer walkthrough:
seven numbered stages with the exact links (hetzner.com/cloud, console
project → Add Server → CX22/Ubuntu 24.04, namecheap Advanced DNS A
record, winscp.net, dnschecker.org), what every form field takes, what
each step should show when it worked, and a «إن علّق شيء» section. The
same guide published as a Claude artifact page for his phone/any
device. 295 tests; adversarial review workflow on the diff before
commit.

The adversarial review (18 agents) confirmed twelve findings, four of them
worth fixing. The heavy one was speed, and it landed the same hour the
owner wrote «لا اريد اية مشاكل في البطئ»: the new retired-letter query
asked `... WHERE m.from_zone = ? OR m.to_zone = ?` over an unindexed
movements table, and it is asked while composing the effective layout —
i.e. inside EVERY yard-write transaction (gate-in, move ×2, exit, unexit,
restore, correction, permit). A verifier measured 229 ms per call at 200k
movements, so a third of a second on every gate press, growing forever.
Fixed with two partial indexes and one EXISTS per column (SQLite cannot
use an index for either side of an OR), locked by an EXPLAIN QUERY PLAN
test. Second: the toolbar now had TWO controls reading «عرض الكل» — the
period button and the page-size choice — so the page-size one became
«الكشف كامل», proven unique by the browser probe. Third: the new test's
`as unknown as` casts (a hard-rule violation) were removed by widening
the test's own ReplyBody instead. Declined: merging the toolbar's segment
into DriversScreen's private `Seg` — the two differ deliberately in size
and tone to match their own rows, and one component with two style axes
would be worse than two honest ones.

Then the owner ruled on hosting: **DigitalOcean, not Hetzner**, and asked
about Heroku. Heroku is disqualified on a fact, not a preference — its
filesystem is ephemeral and dynos cycle daily, which would delete the
yard's database every day; the whole data layer would have to be
rewritten. Writing that up exposed a REAL hole in the cloud kit before he
paid for anything: `POST /api/reports/pdf` launches a system browser
(`launchSystemBrowser`, playwright-core with no bundled browser), and
cloud-setup.sh installed no browser at all — تصدير PDF would have failed
on the cloud while the system looked healthy. The script now installs
Google Chrome, adds 2 GB of swap (droplets ship with none, and the
restore path buffers the whole backup in memory), runs the app as a
dedicated non-root user (Chrome's sandbox refuses to run as root, and a
public server should not run its app at top privilege), and ends with a
self-check. The guide recommends the $18 two-vCPU droplet for one
concrete reason: PDF export burns a whole core, and on a single-core
server it freezes the yard for everyone for a second or two.

The owner then bought it: Hostinger KVM 2, Ubuntu 24.04, Paris, two
cores, and the free domain aqaba-yard.systems that came with the plan.
He sent the panel screenshots and asked what was left, «وكمان اذا في
طريقة عن طريق ال powershell بكون مننونك».

Reading his DNS table caught the thing that would have wasted his
evening: alongside the correct A record his domain carried an **AAAA
record pointing at Hostinger's shared hosting** (2a02:4780:28:1cb1::1).
Let's Encrypt prefers IPv6, so validation would have gone to a machine
that is not his, the certificate would never have issued, and the site
would have sat there with no https and no explanation. Verified with
nslookup against 8.8.8.8 before saying a word.

So deploy.ps1: one PowerShell command from his own machine that checks
the DNS and REFUSES before touching the server if that record is still
there, installs an SSH key (root password typed once, ever), uploads the
four things, runs the provisioning script, and verifies the service and
the site. Re-running it is the update path. Two things surfaced while
building it: PowerShell 5.1 reads a script in the system codepage unless
it has a UTF-8 BOM — every Arabic string turned to noise and the parser
died, so the file is BOM'd and .gitattributes pins .ps1 to CRLF — and
his www CNAME had no certificate coverage, so the Caddyfile now
redirects www to the apex. Tested end to end: the script ran, printed
its Arabic cleanly, confirmed the A record, and stopped dead on the
AAAA with the panel path to fix it.

## المرحلة 25 — النظام على الإنترنت — 2026-08-26

`https://aqaba-yard.systems` is live. Hostinger KVM 2, Ubuntu 24.04,
Paris, two cores, at 88.223.95.144, provisioned by one PowerShell command
from the owner's own machine.

Two failures stood between the rented box and the running site, and
neither was in the yard's code.

The first was mine misreading the world: the AAAA check asked HIS machine
whether the record was gone. He had deleted it, the panel showed it gone,
and the script still refused — because his Windows resolver held the old
answer with three and a half hours left on a four-hour TTL, and Google's
anycast instances disagreed with each other at that moment. The
authoritative nameservers had been right the whole time. The check now
asks them, which is also who Let's Encrypt asks, so the question the
script answers is finally the question that matters.

The second was PowerShell 5.1: ssh printed «Permanently added
'88.223.95.144' to the list of known hosts» — a normal first-connection
notice, exit code zero — and the shell wrapped that sentence in an
ErrorRecord which `$ErrorActionPreference = 'Stop'` made fatal. The
script killed itself over a success message. Judged by exit codes now,
which is what it always checked anyway.

Verified after the run, from outside and inside: the page answers 200 and
titles itself «ساحة العقبة», serving the same bundle that was built here;
Let's Encrypt issued for the apex and www redirects into it; the service
is active and enabled under the user `aqaba`, not root; two gigabytes of
swap stand under the restore path; ufw is up with only 22/80/443 open;
the database files belong to the service user; and headless Chrome runs
as that user and exits clean — which was the point of installing it, and
means «تصدير PDF» will work on the cloud as it does at the office. The
owner had already set his password by the time it was checked: firstRun
is false, the door is shut.

What remains is his: restore the office backup into it.

## المرحلة 26 — القلم يعرف صاحبه — 2026-08-26

The owner caught it: «طريقة التعديل الجديد الي ضفتها عند الكشوفات بتتعدل
من الكل». The pencil added to register rows in stage 24 was drawn for
everyone.

What was actually exposed, exactly: nothing was ever changed. The server
has always guarded the edit — `PATCH /api/containers/:id` opens with
`requirePerm(request, 'EDIT')` and answers 403 — and the audit found
every other door sound too: drivers under ACCOUNTING, zones under owner,
the card's own pencil under `may('EDIT')`. What leaked was the FORM: the
button appeared for anyone who could read a register, and pressing it
opened the editing card, which then refused on save. A clerk could type
into a form he had no right to, and only learn so at the end.

The hole was `startEditing`. The card's own edit button was properly
gated, but the prop let a caller walk around the guard and set the
editing state directly. So the fix is three deep, and the middle one is
the one that matters: the register no longer draws the pencil without
`canEdit`; the CARD now refuses to open editing for anyone without the
permission no matter who asks it to, so no future caller can reopen this
by accident; and the server still refuses, as it always did.

Proved with a real employee rather than an assertion about one: a clerk
with GATE_IN, GATE_OUT and REPORTS but no EDIT logs in, opens the entry
register, and the إجراء column holds «بطاقة» alone — zero «تعديل» — while
the owner on the same register sees both. His forged PATCH comes back
403 FORBIDDEN. 296 tests, gates green.

## المرحلة 27 — المتصفح لا الشيفرة — 2026-08-26

The owner reported the pencil still showing: «فتت على حساب test ما زالت
ال التعديل موجود». It was not a second bug. It was his open tab.

Established, not guessed: the account `test` (id 13) carries
`REPORTS,ACCOUNTING` and no EDIT, so the button had no right to appear
for him; the bundle the server hands out today hashes SHA256
`F12E9AC2506284FF…`, byte-identical to the build the clerk probe passed
against here; and the previous bundle `index-cmiHdK79.js` is still on
disk and still answers 200, which is what a tab opened before the deploy
keeps running. His own screenshot proved which one he had: its toolbar
read «الكشف كامل | 80 | 50», a control that shipped in that earlier
bundle.

So the remedy is Ctrl+Shift+R, and it is not his tab alone — every
employee who left the page open since morning is running the old code
until they reload. `index.html` is served `no-cache`, so one reload is
enough; the JS filename carries its own hash, so there is no stale-file
trap after that.

Nothing was at risk in the meantime. A `test` session pressing that
button reaches a server that answers 403, as it has from the first day.
What leaked was a form, never a write.

Offered and not yet built: a notice inside the app that tells an
employee a new version has shipped and asks him to reload, so a deploy
does not depend on telling people by phone.

## المرحلة 28 — النقلة التي لا اسم لها — 2026-08-26

The owner counted: كشف السيارات gave 79 for 01–15/08, حساب السائقين gave
77. He was right, and the two missing hauls were found by running both
queries against the real book rather than reasoning about them.

The wage sheet read `containers` and filtered on `driver_in <> ''`. The
driver's name is OPTIONAL at the gate. So a haul recorded without one
vanished from the wage book with nothing anywhere to say it had. Two in
his fortnight — TIIU6303396 on truck 60-75540 and MRKU6632180 on
60-61475, both entered late on 11/08 — and eight across the whole book,
five entries and three exits. Every one of them a truck that came and
did work and appeared in nobody's account.

His call on the remedy, and it is the better one: the haul is carried by
its PLATE. «ضعها تحت نفس رقم السيارة … لازم تبين حطها ب الكشف». So the
filter is gone, the sheet groups by name when there is one and by plate
when there is not, the plate groups lead the sheet in amber because they
are what is waiting for a name, and the paper prints «كشف حساب سيارة
60-75540». Verified on his own data: 79 and 79.

The name stays optional — he chose that too — but the field now says in
amber what a blank costs, at the gate in, at the gate out, and in the
correction form.

Two things fell out of the same screen while it was open. Erasing the
amount box did nothing at all: the screen cleared, the book kept the old
figure and handed it back on the next read. `POST /api/wages/clear` now
strikes the figure out — soft, like everything here — and refuses on a
settled haul exactly as editing does. And typing a figure re-read the
whole month to learn one number, which is what made it feel slow; the
saved figure is written into the rows already on screen instead.

One guard is worth naming because it is what makes plate-carrying safe:
the gate demands a plate in both directions, and a departed record
cannot be corrected into having none. «بلا اسم» is a reachable state;
«بلا اسم ولا رقم» is not. There is a test that says so.

Also answered, from the same session and not a bug: a wrongly-exited
record CAN be struck out — the card's حذف works on a departed record as
on a standing one. Its «إلغاء الخروج» would have refused, the slot
B-32-01-B having been taken by GLDU9368397 in the meantime.

299 tests, gates green.

## المرحلة 29 — كشف يُحاسَب منه — 2026-08-26

«تاكد يكون صفحة محاسبة السائقين مرتبة مشان وقت يجي يحاسب يكون سهل
محاسبته». So the sheet was rebuilt around the act of paying somebody.

What it now opens with: one line of totals for everything on screen —
hauls, wages, paid, and المتبقي set large in amber, because that is the
figure a man is about to be handed. Then the accounts, ordered by what
is owed, largest first, with the closed ones at the bottom wearing «تمت
المحاسبة». Each heading carries its own three figures the same way and,
where anything is owed, a **«تسديد الكل»** that stamps every priced haul
under it in ONE transaction — an unpriced haul stops the whole stroke
rather than settling half an account, and an already-settled haul is
left on its own date instead of being re-stamped with today's.

The rows became columns: fixed widths, so the eye runs down the numbers
instead of hunting across a ragged line; a settled row tinted green; an
unpriced box ringed amber; and, under a plate that carried more than one
man, a column saying which of them drove that load.

And the heading is the PLATE now, by his instruction — «بهمني رقم
السيارة اكثر من اسمه» — with the driver's name after it. «حسب السائق» is
still one press away.

Two things the drawing itself caught, after the screen was rendered and
looked at rather than reasoned about: «عدد النقلات: 6 · 1 بلا أجر» read
as a single number ١٠٦ on an RTL line, so the second count became its
own amber badge; and «2 سائقين» is not Arabic — it is «سائقان».

Verified in a real browser against the built bundle on a seeded book:
totals 122/55/67 correct to the ledger, the plate 60-33333 gathering
«حماد عودة» and «حماد عوده» into one account that the name-grouping
splits in two, الاستلام cutting headings and not rows, and تسديد الكل
stamping and the account dropping out of «لم يستلموا».

## المرحلة 30 — الترميز يُقرأ من اليسار — 2026-08-26

«اتاكد من الترميز بيجي من الشمال مو من اليمين يعني 60-85745 وهكذا». He
was right, and it was worse than it looked.

Rendered in headless Edge inside `dir="rtl"` and measured by the visual
x-position of every character — not by reading the string, which returns
logical order and would have said everything was fine:

    سيارة 60-45165 نهاية      displayed as   سيارة 45165-60 نهاية
    الخانة 2-B-32-01-B نهاية   displayed as   الخانة B-32-01-B-2 نهاية
    سيارة 60/45165 نهاية      displayed correctly
    بطاقة 0035/2026           displayed correctly
    الحاوية ASLU5008663       displayed correctly

So it is the HYPHEN. A hyphenated code dropped into Arabic text is cut at
its hyphens and the pieces are laid out right to left. Every plate in his
fleet is hyphenated, and so is every slot address in the yard. Codes
joined by a slash, and codes with no separator at all, were measured and
are correct as they stand — they are deliberately left alone.

The cure is two unprintable characters, U+2066 and U+2069, around the
code — and it belongs in the SENTENCE, not in the screen, because these
same sentences become confirm dialogs, toasts and printed headings, none
of which can carry an HTML tag. `ar.ts` grew one private `ltr()` helper
and every sentence carrying a plate or an address now uses it.

What it must never touch: a value that is stored, compared or searched. A
plate with an invisible character inside it would stop matching the same
plate typed at the gate, and the fleet register matches plates by text.
A test pins that boundary along with the isolation itself.

Also this round, by his word: «ورتب الدخول اولا والخروج اخر شي ب
الترتيب» — inside every account the entries now come first and the exits
last, each run in its own time order, and the printed statement reads
from the same array so paper follows the screen.

Verified in the running app, not asserted: every heading measured
character by character, `60-33333` intact left to right, and a plate
carrying four hauls showing دخول، دخول، خروج، خروج in that order.
313 tests, gates green.

## المرحلة 31 — الخط الذي لم يكن هناك — 2026-08-27

«يوجد مشكلة في النظام عند طابعة الكشوفات PDF وخصوصا كشف الحاويات» — and
the picture showed a register whose every Arabic word was an empty box,
while the numbers and dates beside them were perfect.

Nothing was wrong with the data or the code. `fc-list :lang=ar` on the
server answered with nothing at all: sixteen fonts installed, not one of
them carrying an Arabic glyph. The office machine is Windows and has
Arabic fonts, so this never appeared until the yard moved to a Linux
server — the same build, printing correctly in Aqaba and printing boxes
in Paris.

Two details made it worse than a missing package. The PDF is drawn from
HTML passed through `page.setContent` with no base URL, so the page
cannot reach the app's own Cairo web font even though it sits in the same
build. And the header and footer of a Chrome PDF are rendered in a
SEPARATE document that inherits neither the stylesheet nor any web font
the page loaded — so «صفحة 1 من 3» could only ever come from a font
installed on the machine. Embedding a font in the page would not have
fixed the footer.

So the provisioner installs one, guarded so a redeploy does not reinstall
it, and both font stacks — the page's and the footer's — now name Noto
Naskh Arabic explicitly rather than leaving the choice to fontconfig. The
setup script also counts the Arabic fonts at the end and says so, because
the failure is silent otherwise: a PDF still generates, still downloads,
and is simply unreadable.

Proved by rendering on the server itself as the service user, with the
exact font stack the PDF uses, and looking at the picture: «كشف الحاويات
الواقفة في الساحة» reads as it should. Twelve Arabic fonts where there
were none.

## المرحلة 32 — بقية الترميز المقلوب — 2026-08-27

Stage 30 fixed the plate in the wage sheet, the one the owner pointed
at. A fan-out audit over ar.ts, every screen, every printed surface, the
PDF route and the global setup then found thirty more sites of the same
defect, each re-read and confirmed by a second agent before it was
believed.

Deduplicated, they were seven sentences and three composed titles:

- `moveDone`, `confirmMoveBody`, `correctMoveDone` — the destination
  address in the dialog that asks him to approve a move, and in the toast
  that reports it. The worst of the set: he reads the address at the
  moment of deciding, and it named a slot that does not exist.
- `toolsSeedDone` — the bay named after seeding.
- `doubtTruck` — the amber hint under the plate field, whose own example
  plate `60-12345` printed backwards while telling him what a plate
  should look like.
- The truck and bill register titles, built in ReportsScreen rather than
  in ar.ts, which flow into the screen heading AND the printed header AND
  the PDF footer.
- The search echo under a sheet's title, since what he searches for is
  usually a plate.

The helper moved to `src/shared/bidi.ts`, because the server needs its
other half. `plainCode` strips the isolates back out for a FILENAME —
the register title reaches `downloadBlob` and the PDF's
`content-disposition`, and a file called `كشف السيارة ⁦60-45165⁩.pdf`
carries two characters nobody can see or type. That is the trap the audit
was asked to look for and did.

Deliberately left alone, having been measured correct: card serials
(`0035/2026`), container numbers (`ASLU5008663`), bills and seals. A
slash is absorbed into the number run; a hyphen is not.

321 tests, gates green.

## المرحلة 33 — الرفض الذي لا يقول شيئاً — 2026-08-27

«عندما اريد التعديل مثلا على اسم السائق او حتى فقط التاريخ بصير في مشكلة
بقول المعلومات غير كاملة او غير صحيحة». Nothing he typed was wrong.

Six different rules on the correction route all refused with the one code
`VALIDATION`, so every one of them reached him as the same sentence about
missing or incorrect data, naming no cause and no remedy. His own records
were checked against every one of those rules on the live server: not one
violated any of them. So the failing payload was not describing the record
in the database.

It was describing an OLDER one. The card polls the server every ten
seconds — it has to, because a container can descend a tier when a
neighbour leaves from another device — but the card was DISPLAYING
`props.container`, the snapshot taken when it was opened, and the edit
form was built from that snapshot. Leave a card open, let the booth gate
that container out, then correct anything at all: the form sends a
payload with no exit paperwork against a row that has left, and the
server refuses. Correctly. Silently. About the wrong thing.

The card now reads the live row for everything, the form remounts if the
record changes what it IS (departed, or an exit taken back), and pressing
«تعديل» asks the server first rather than trusting a poll up to ten
seconds old.

And every refusal now says which rule it is: `EXIT_ON_STANDING`,
`EXIT_PAPERS_MISSING`, `TIME_IN_FUTURE`, `EXIT_BEFORE_ENTRY` — each with
a sentence naming the cause and the remedy, and the first two naming the
likely REAL cause, which is a card that has been open too long. A payload
the schema rejects now carries the offending field, so the sentence names
the box instead of the whole form.

That last part was not free: adding four codes broke the build until all
four had Arabic, which is the type system doing exactly what it is there
for.

Also settled this round, by measurement rather than opinion: the owner's
photos print in colour. All thirty stored on the server are colour JPEGs,
`print-color-adjust` resolves to `exact` under print, and a card rendered
through the real print path shows a full-colour photograph. Whatever is
turning his prints grey is between the print dialog and the paper.

327 tests, gates green.

## المرحلة 34 — الخطأ الذي كان يتّهم الكاتب — 2026-08-27

Stage 33 fixed the stale card. A deeper audit of the same route found the
reason the report could not be acted on at all, and three more beside it.

**The server's own faults wore the same sentence.** Every uncaught error
in the entire application — a crash inside a write transaction included —
was answered `500 { code: 'VALIDATION' }`, which the office reads as
«توجد بيانات ناقصة أو غير صحيحة. راجع الخانات». So a fault in the code
sent the owner hunting a field that had never been wrong. It has its own
code now, and its own sentence: the error is in the server, not in what
you typed.

**No box was capped.** The schema caps a driver's name at 60 characters,
a plate at 30, a bill at 40 — and not one input carried a `maxLength`, so
a name one clause too long left Save enabled and came back refused.
His longest stored driver name is already 34 characters and they carry
parentheticals like «صالح عبد الكريم (بهاء ابو الربع)»; 60 is one clause
away. Sixteen inputs across the card and the gate now stop where the
server stops.

**A future date was refused but never warned.** The form mirrored the
exit-after-entry rule and not the horizon, so a mistyped year passed the
screen. Both pickers now carry `max`, the guard mirrors the server, and
each date says which rule it broke rather than sharing one message.

**And the undo button in the log lied.** `correctMove` writes its «before»
as an ARRAY; `parseEditNote` accepted that, so «تراجع» appeared on a
corrected move, resolved every field to undefined, sent an unchanged
payload and reported success having done nothing. Latent — no move has
been corrected in his book yet — and live the moment one is.

328 tests, gates green.

## المرحلة 35 — الفئة تتبع الباي — 2026-08-27

«وكمان بدي القدرة عند التعديل على تغير فئة الحاوية … ممكن الشخص خربط ف
بطر انو يعدل بدل ما يحذفها من السجل كامللل». He reversed his own earlier
bar, and his reason is right: deleting a whole record is an absurd price
for a mistyped class.

But a dropdown would have been the wrong answer, and the yard says why.
The bay's parity IS the class — odd is a twenty, even is a forty lying
across the two odd bays around it — so a class written wrong is an
ADDRESS written wrong. The box is standing on ground the book has
misdescribed. So the correction is to name the bay it truly occupies,
and the class follows, exactly as it does at the gate where nobody is
asked for it either.

Nothing moves. Same zone, same stack, same tier, one bay sideways: the
whole choice is at most two slots, judged by `canPlace` with the
container excused, and the class and the address are written in one
transaction. No MOVE, no move card, no serial disturbed — a serial is a
function of the gate date, not of the class.

Three decisions worth recording:

**Buried refuses.** Changing what a box IS changes what the boxes above
it stand on, and no descent happened to justify a DROP row. Writing one
would say a container moved at a moment the yard stood still, which is
the exact lie the DROP type exists to prevent. Measured against his live
yard: 307 of 620 standing containers carry something. He was given the
figure and chose the refusal — «يرفض الآن» — over correcting a whole
column, on the reasoning that a mistyped class is normally caught minutes
after gate-in, when the box is by construction the top of its stack.

**The departed branch moves the exit slot with the class.** An OUT
movement remembers where the container stood, and «إلغاء الخروج» reads
that back. Without moving it, a corrected record remembers an odd bay for
a forty and can never be un-exited. There is a test that fails without
it.

**`SIZE_LOCKED` stays on the correction form, for ever.** That is what
makes the corrupt state — a forty addressed at an odd bay — unreachable
through the form, through the wire type, and through the log's undo
button. The class is not a field; it never was.

And the stamped permit stops reading the class off the live container:
pinned in its own line at v24, like the number, the serial, the entry
date and the weight already were. The licence for reading it live was the
lock, and the lock is gone.

Verified in a browser on the built bundle: a twenty at B-03 with bay 05
occupied is offered exactly ONE option, corrected to a forty at B-02, and
the ground strip shows why the other side was not offered. Then the same
box narrowed back to a twenty at B-01. The entry movement follows the
address; each correction leaves one EDIT carrying the previous class and
slot; no MOVE and no DROP anywhere. 337 tests, gates green.

## المرحلة 36 — الرقم يُعطى مرة واحدة — 2026-08-28

«في حال تم حذف حاوية من السجل كامل ما بدي حدا يوخذ مكانها خلص يضل يكمل …
لو كان عندي 1 2 3 وحذفت 3، الي بدي اجي اضيفها خلص لازم تيجي 4، مو توخذ
محل ال 3».

This reverses his own earlier instruction, which the code quoted back at
him in three places: «في حال حذف الحاوية او سجل خطأ يجب ان لا يتم القفز
عن الرقم التسلسلي». He was told so. He is also right the second time, and
the old rule's own cost is the argument: closing a hole re-seated every
live card after it, so a card already printed and handed to a driver
stopped matching the register it came from. A hole is visible and
harmless. A number that changes hands is neither.

So the count now reads over ALL records, struck-out included, and climbs
past a deletion instead of into its seat. And every renumbering was
removed — from the delete, the restore, the exit taken back, the
corrected gate date, the backup restore, the practice seed, the permit
void, and, most dangerous of all, **the repair that ran on every database
open**. That last one would have re-seated his whole register at the next
restart. The functions themselves are gone, not merely unused: a
renumbering pass left lying around is a rule violation waiting for a
caller.

Four books, one rule: entry cards, exit cards, move cards, permits.

**The one thing that could not simply be deleted.** A book kept under the
old rule is full of collisions — closing a hole moved a live card onto a
number a struck-out record was still holding. His database carries
thirteen of them, checked on the server: struck-out ABCD1234 holds entry
1 and live TIIU6303396 holds entry 1 as well. Restoring such a record
would put two live cards on one number. So a restore whose serial a live
record already carries gives **that record alone** a fresh number, and
moves nobody else. Its card was voided the day it was struck out, and its
old number is printed on somebody else's paper now.

Checked on the live server before any of this shipped: no two live
records share a serial in any of the four books, and 2026 has 778 entry
cards with the highest at 778 — no holes yet. So nothing already written
moves; the rule takes effect from the next deletion onward.

Nine tests asserted the old rule and were rewritten rather than deleted —
each now locks the reversal, and two of them carry his sentence. Four
more fell when the open-time repair went. 341 tests, gates green.

## المرحلة 37 — الأربعين شيء واحد على خانتين — 2026-08-28

«هناك مشكلة في النظام في موضوع النقل. كان النظام يضع 40 قدم كل خانتين.
الأن الخانات وضعها غريب. زبطها وما هي المشكلة.» With two screenshots of
the zone-A strip: today reading 6/24, 8/24, 6/24, 19/24, 19/24 — and an
older one reading 3/24, 3/24, 3/24, 18/24, 18/24, «وهذه الشيئ منطقي».

**The forensics came first, read-only against the live server.** Both
screenshots are THIS system running THE SAME arithmetic — the map's
counting has not changed since the first map commit on 10 August. The
data is clean: no forty at an odd bay, no twenty at an even one, no two
containers on one cell. Every tile number matched the database row by
row. What changed was the yard: zone A now holds 191 forties and only 4
twenties, and until this week every forty block sat on the tidy 04, 08,
12… grid. Then FCIU9356332 came in to C-02 on the 26th, was MOVED to
A-02 stack 5 the next morning, and CMAU7032792 was stacked on top of it
— the first block off the grid.

That exposed what the per-bay paint had been doing all along: a forty
covers ground in TWO odd bays, so it was painted as one TEU under each —
nineteen forties at bay 08 read «19» under 07 AND «19» under 09, the
same nineteen boxes twice. On the tidy grid the neighbours mirrored and
the doubling was invisible; one block at 02 and tiles 01/03/05 read
6/8/6 — true about the ground, unreadable as a count of boxes.

**The fix is the owner's own sentence.** Reading the yard, the odd bays
a forty lies across now WELD into one cell — «01–05», «07–09» — and
every container in the stretch is counted once. The welded cell's
denominator is what the block holds when completed as what it is: the
standing boxes plus the forty landings still open in it, by the same
lane-walk the fill calculator uses (`fortiesInZone` generalized to
`fortyRoom` over any stretch of bays). A pure pair therefore reads
exactly like his ledger: nineteen of the twenty-four the pair can carry.
A lone bay keeps the old arithmetic, stacks × 3. The zone header stops
speaking TEU too: «195 حاوية · متاح 340 خانة» — boxes counted once
(the figure he checks against his register), free ground in slots.

While PLACING, the strip falls back to one tile per odd bay — a landing
is chosen bay by bay, and the placement flow is untouched. Inside a
welded cell every bay still answers its own tap, so the sheet that opens
is the ground actually clicked.

Files: `rules.ts` (fortyRoom), `mapModel.ts` (zoneCells, summarizeZone
gains boxes), `YardMap.tsx` (RunCell; per-bay cells kept for placing),
`ar.ts` (fullAndFree reworded). Tests: zoneCells welding, once-counting,
capacity by hand (11 over a mixed stretch, 9/9 full pair), adjacency
alone welds nothing; the header counts a spanning forty once. 345 tests,
gates green.

## المرحلة 38 — الخلية زوج على الأكثر — 2026-08-28

«انظر الى هذه يوجد فيها مشكلة اصلحها. يجب ان يكون مفصل اكثر — مثلا 19-21،
23-25.» A screenshot of «19–25 · 42/59»: on live zone B a single stray
forty at bay 22 bridged the twenty-box blocks at 20 and 24, and stage
37's chain-weld faithfully fused all four bays into one coarse cell.
Geometrically true, unreadable — and he wants pairs.

So the cells anchor on the BLOCKS now, not on connectivity: each loaded
even bay claims its two odd neighbours, heaviest block first; what no
block claims stands alone. A cell is a pair at most. The stray forty
that bridges two claimed pairs counts ONCE, in the cell holding the
lower bay it covers — off by one bay at the seam, never double-counted,
and the sheet a tap opens tells the exact truth. A pair's ceiling still
comes from `fortyRoom`, now fed the pair's TOUCHERS rather than its
members, so a neighbour block's overhang blocks the lanes it actually
covers. A lone bay's ceiling is its remaining ground (its own boxes plus
free slots), which for an untouched bay is the same stacks × 3 as ever
— and ground covered only by an overhang no longer paints as empty.

His cell reads «19–21 · 21/…» beside «23–25 · 21/…» now. 347 tests,
gates green.

## المرحلة 39 — شكل واحد للقراءة والنقل — 2026-08-28

«I want you to edit transport of the container to match the look of the
map.» Stage 37 had deliberately dropped the strip back to one tile per
odd bay while placing, on the theory that a landing is chosen bay by
bay. His screenshots put the two views side by side: the reading map in
tidy pairs, and the move flow suddenly back to «19/24 · 19/24» double
counts. He wants one language.

So the placing fallback is gone and the paired cells serve both modes.
While a container hunts for its slot, a cell lights up whole when ANY of
its ground holds a legal landing (its per-bay tap already opens the
exact sheet, and the sheet is the authority on which slots take it);
everything that cannot take it dims as before. The old per-bay BayCell
component is deleted — one cell component, one look. 347 tests, gates
green.

## المرحلة 40 — الخانة الفارغة التي ترفض تسمّي شاغلَي شريكتها — 2026-08-28

«انا بحاول انقل من 23-25 الى A-5 رغم انها اربعين قدم الا انه يعطيني انه
لا يمكن نقلها. رجاءا تأكد من كل شي يخص الأرض بان امورها تمام.»

The ground checked out first, read-only: zone A bays 1–9 all carry
stacks 3–10 on the decoded plan (1–2 are the wall the sheet hatches),
and the refusal he hit was TRUE. He picked A-05 stack 5 tier A — a cell
that reads «فارغ» on bay 05's own sheet — but a forty needs a partner
cell on a neighbouring odd bay, and both partners at stack 5 were spent
under other blocks' overhangs: bay 03's half under FCIU9356332 (the
block at 02) and bay 07's half under CIPU5130473 (the block at 08).
Meanwhile stacks 06–10 stood genuinely open — the pair's own cell said
«6/21», fifteen landings free — and nothing on the sheet distinguished
them from the dead stack. Two failures, neither of them the ground's:
the refusal named no cause, and the grid gave no clue where to aim.

Both fixed in the sheet. While a container is being placed, the cells
that actually take it GLOW (computed by `bayLandings`, the same shared
rules the server runs), with a line under the grid saying so — or saying
plainly that no cell of this bay takes it. And a picked cell that fails
now refuses by name, one line per closed way: «عبر الباي 04: الخانة
الشريكة 2-A-03-05-A مشغولة بالحاوية FCIU9356332» — occupier, missing
support, or a stack the plan does not give the partner. The generic
«اختر خانة أخرى» remains only for the gate-in flow, where no size has
been declared yet. 348 tests, gates green.

## المرحلة 41 — المالك يعيد الشكل الأصلي — 2026-08-28

«bro I want the same as this one — this is the old one with the same
look with the same behave — return to the same as the old one.»

He lived a day with the paired cells (stages 37–39) and chose the
original strip back: one tile per odd bay, TEU numbers, «مشغول · متاح»
in slots. His call, cleanly honored — YardMap restored wholesale from
the pre-37 tree, `fullAndFree` back to slot wording, `zoneCells` and the
boxes roll-up deleted, the six pair-cell tests with them. SPEC records
the decision so the pairing is not re-invented uninvited.

Kept, deliberately: `fortyRoom` in the shared rules (a pure
generalization of `fortiesInZone`, still carrying the fill calculator),
and ALL of stage 40 — the bay sheet's glowing landing cells and refusals
that name the occupier. Those fixed his real stuck move (A-05 stack 5,
both partners spent under neighbouring overhangs) and touch nothing
about the map's look. 342 tests, gates green.

## المرحلة 42 — البوليصة تحكم الرصف، وطابور النقل — 2026-08-28

«بدي اخلي الخريطة افضل لحتى الواحد يقدر يتبع عليها لانو احيانا بقعد
الواحد يدور على مكان يحط فيه، وكمان احنا محكومين فيه الي هو البوليصة.»
Asked what the bill categories mean for placement, he named the real
rule: the merchant takes the whole bill out in ONE batch, so a big bill
must stand together — and he asked to be TOLD when a bill's boxes are
separated, and for colours that help. Mid-build he added a second
feature by message: «اذا ضغطت على حاوية ثانية بحط الحاوية الاولى
والثانية بقلي وين بدي احطها» — a move queue.

**Grounded in his live data first**: 331 bills standing — 248 singles,
49 of 2–5, and 34 big bills carrying 369 boxes (half the yard). The crew
already clusters (ZSN0840117: 15 boxes on one bay), but 13 bills sit in
more than one zone and AQJCB26000025A spans A and B from bay 08 to 24.

**البوليصة**: three pure helpers in mapModel (billBays, billSpread,
nearBillMates) drive everything. While a container of a bill is placed —
or the search names exactly one bill — the bays its group stands in wear
a GOLD COUNT (new --yard-bill, legend chip) and never dim, a line under
the moving banner names them, and the bill search row grew a second
line: «كلها في زون B» calm, «متفرقة: زون A: 8 · زون B: 17» amber — the
scatter notice he asked for. Confirming a move that lands away from the
group carries a warning sentence (never a refusal). The gate-in form:
arrives with the bill prefilled when the search named one (their own
flow — bill first, then place), and typing a bill with standing mates
shows green «بجانبها» or amber «بعيد عنها» against the picked slot.

**طابور النقل**: while placing, tapping a standing container in the bay
sheet QUEUES it instead of opening its card; each landed move promotes
the next, the banner lists who waits, cancel drops the line, and the
correction flow takes no queue. The toast after each landing says whose
turn is next.

345 tests (three new for the bill helpers), gates green.

## المرحلة 43 — كتاب البطاقات دفعة واحدة، والخريطة تتلون بالبوالص — 2026-08-31

Two owner requests, planned and approved. «بس اول شي بدي اياك تعمله تحت
صلاحية المالك بدي طريقة اطبع جميع بطاقات الدخول مره واحدة وجميع بطاقات
الخروج مره واحدة مهما كان عددها» — then he widened it to move cards and,
on photos, «دع لي الاختيار». And the map colouring he had asked about:
«فئات بالعدد».

**كتاب البطاقات.** The constraint that shaped it is CLAUDE.md's own rule:
Arabic lives in ar.ts alone, so the server could not author the cards.
The duties split: an owner-only `GET /api/reports/cards` hands the FACTS
of every card of a range (bulkGateCards/bulkMoveCards in the store —
serial order within year, struck-out records excluded, the slot by the
single card's own rule), and the client's new `cardsPrint.ts` writes the
Arabic book — a string twin of PrintCard: voucher strip, receipt
statement on entry cards, hero number, labelled grid, signature boxes,
drops on move cards — one section per page. An owner-only
`POST /api/reports/cards-pdf` presses it (its own route because the
register PDF's guard and 1MiB ceiling do not fit: bodyLimit 64MB,
portrait, 120s timeouts, same Arabic footer). Photos, when the owner
asks, are fetched with his session and folded in as data URIs — the
server's browser has neither session nor origin, so a relative URL
would print a broken square. Buttons: entry register (with/without
photos), exit register, and the operations log for move cards — each
printing exactly what the filter shows, «عرض الكل» making that the
whole book. Reprinting touches no serial: the number is issued once.

**تلوين البوالص.** A paint toggle above the map: «الامتلاء» as ever, or
«البوالص» — each bay wearing the size class of the biggest bill standing
on it (band 1 فوق 10, band 2 6–10, band 3 2–5, band 4 فردية), group size
counted yard-wide, a spanning forty carrying its bill onto both bays.
Four band colours in both themes, the legend follows the mode, and it is
a READING paint: placing brings the target colours back.

15 new tests: store queries (order, exclusions, range clip, exit
paperwork, move slots), the owner-only guards (a clerk with every
permission refused on both routes), the book builder (page per card,
escaping, drops, data-URI photos and never a session URL), and
billBands. 360 tests, gates green.

## المرحلة 44 — البلوك يُكمَل من فئته — 2026-08-31

«اريد شيئ واحد منك بالنسبة لحساب الأرض وكم باقي لأتساع الساحة: في حال تم
وضع 20 قدم في البلوك ف هذه يعني انه سوف يتم تعبئتها كاملا ب 20، اما
اربعين ف سوف يتم وضع اربعين قدم.»

The fill arithmetic now completes every committed block as its own kind.
A bay holding a twenty is a twenty block: no fresh forty pair plants a
foot on it, its empty stacks included (`fortyRoom` gained a
`noNewGround` set — climbing an EXISTING forty column there still
counts, the column being the forty's own). A bay under a forty — its
own or a neighbour's overhang — is forty ground: its free cells leave
the twenties figure entirely. And the twenties figure stopped counting
cells a twenty can never reach anyway: lanes a forty touches offered it
nothing even before practice was consulted (a twenty never stands on a
forty), yet they were counted — in his forty-heavy yard that alone
inflated «المتاح للعشرين» by hundreds. A mixed bay (a twenty beside an
overhang) stays a twenty bay, spending only its forty lanes. Empty
ground still counts for BOTH figures — they are two futures, each
completing it as its own kind.

The header chip stopped answering a different question: it read
`freeNow` (legal landings this minute) while the calculator read
`fillPlan` — two numbers, one word «المتاح». Both now read the same
block-rule fillPlan at three tiers.

On his live yard the honest figures came out: 596 free slots, but by
practice **174 twenties or 211 forties** — and zone D, all twenties,
reads forties: 0 exactly as the rule promises.

fillPlan tests rewritten to the rule, each expectation worked by hand —
including the case where my first arithmetic was wrong and the test
caught it. 361 tests, gates green.

## المرحلة 45 — لمسات الهاتف — 2026-08-31

«MAKE IT RESPONSIVE FOR THE MOBILE TOO.» Audited first: the app was
built responsive from the start — the viewport meta is set, the header
wraps with the search taking its own full-width row on phones, every
Sheet is a bottom sheet under lg, the registers scroll sideways inside
their own glass, and the map pans and pinch-zooms by touch in
usePanZoom's own hand-rolled pointer logic. What actually cramped on a
phone was the two-column input grids: the gate-in form squeezed paired
Arabic fields (and the new bill hints under them) into ~150px halves,
and the permissions grid clipped its labels. Those now collapse to one
column below `sm` and pair up from there. The bay sheet keeps its
deliberate sideways scroll on phones — the one thing the owner already
ruled on. 361 tests, gates green.

## المرحلة 46 — ترويسة الكشوفات تفسح للهاتف — 2026-08-31

«عند الدخول الى الكشوفات فأن الخيارات التي في الأعلى تأخذ حيزيا كبيرا.»
On a phone the register header piled three control rows into six or
seven: seven wrapping tabs, two date pickers, the fit and range toggles,
the search, the page size, four export buttons — half the screen before
the first row of the sheet. Now, below lg only: the tabs take ONE
sliding row (flex-nowrap in ReportsScreen, a w-full overflow-x wrapper
in SheetScreen), and every filter and tool row folds behind a single
«الخيارات» button beside the theme picker — off by default, so the
register owns the screen the moment it opens. The desktop never folds.
LogScreen inherits all of it through SheetScreen. 361 tests, gates
green.

## المرحلة 47 — الفردية لا تختبئ تحت لون البلوك، والبوابة تسأل — 2026-08-31

«في بعض الأحيان يتم وضع فردي مع عدد من البوليصات اريد ايضا حل» — meaning,
he clarified, in the bills paint: a stray single standing inside a
block vanishes under the block's colour. And to the question of how the
system could ever tell a single from the first box of a big manifest,
he chose: «أسأل الموظف عند الإدخال».

**الشارة**: billBands now returns, per bay, the band AND how many other
bills share its ground; in the bills paint a mixed bay wears a white
count badge («+1») at its far corner, with its own legend line. The
stray inside a block stops hiding.

**السؤال**: schema v25 adds `containers.bill_kind`
('SINGLE'|'MANIFEST', null for records from before the question). The
gate-in form insists on the answer — two chips under the bill box —
and the edit form corrects it. The wire stays lenient (old payloads
break nothing), and an edit that never mentions the field keeps what
the record says instead of wiping it. The paint uses the answer to
settle the ambiguous case: one standing box declared «على كشف» paints
as a small group (band 3), declared «فردية» or undeclared paints as
the single it is.

He then widened the road while I built: placement SUGGESTIONS — singles
beside singles, under-20-ton boxes allowed a third tier but only on
«الوجه» for the machines' reach, and a third tier advised on the last
and next-to-last رصة of an otherwise-full section. Definitions his to
give («الوجه»، الرصة, where the weight figure comes from) — asked, not
guessed. 362 tests, gates green.

## المرحلة 48 — مقترحات المكان، والبلاطة تقول كم بوليصة — 2026-08-31

He answered the advisor's three definitions and kept testing live.
«الوجه» is the outermost رصة — stack 10 and its like, the row the
machines reach — a third tier goes there for a light box, «تحت الـ20 او
الـ23 احيانا», weights being kilograms as the clerks type them, and
«خذ بعين الاعتبار البوليصة».

**مقترحات المكان** (suggestedCells in mapModel, worn by the bay sheet
while placing): among the LEGAL green cells, the yard's own habits glow
darker with «مقترَح» written on them — a single-bill container where
another single already stands; a container with standing mates beside
its own bill (the nearBillMates rule); and the third tier only light
(< 20,000 kg — no recorded weight reads heavy), only on the bay's last
stack (the face), and only on its own bill's column. Advice, never a
bar; a title on the cell says the reasons, and the hint line under the
grid grows a clause when suggestions exist.

**And the tile spoke TEU in the bills paint** — his live screenshots
showed «16/30» beside a «+10» badge and he asked plainly: «لو كان عدد
البوليصات في المكان لكانت افضل». So in the bills paint the tile's
second line now SAYS the bill count — «بوليصتان»، «7 بوالص»، «11
بوليصة» — the badge is gone, and billBands hands the full count
instead of an extras figure. His A-53 sheet (twenty forties across
eleven bills) reads «11 بوليصة» at a glance now.

His flow question — «عند الأدخال كيف يستطيع النظام الأقتراح اذا انه
يختار المكان اولا ثم يضع البوليصة؟» — is answered in the reply, not in
code: the bill-search-first habit feeds the gold and the prefill
today; cell-level advice at entry would need the form-first flow, his
to order. 365 tests, gates green.

## المرحلة 49 — الأربعين تلحم مربعيها، بطلبه هو — 2026-08-31

«بدي تعمل شغلة اخيرة تعدل فيها ع شكل الخريطة بحيث اذا ما كان فيها شي
تبين بلوك عادي مثل كأنه عشرين بس في حال وضعت فيها حاوية اربعين قدم
تدمج المربعين بحيث يصير اطول.»

The merge came back — asked for by name, which is exactly the explicit
request stage 41's SPEC clause reserved it for. He lived with both
drawings and chose: empty ground and twenties are single squares; where
a forty stands, its two squares are ONE longer block.

Restored from stage 38/39's history and adapted to everything built
since: zoneCells (pairs at most, heaviest block claims, the stray
counts once in the lower cell) and the unified RunCell — now carrying
the gold bill badge (the larger of its halves' counts), the bills paint
(a welded block wears its strongest member's band and the larger bill
count), the note dot, target lighting, and the per-bay tap that opens
the exact sheet clicked. The numbers stay the ones he reads today: a
full forty pair says «27/27» once instead of twice, and a lone twenty
bay is unchanged to the digit. Four pair tests returned from history
with the same hand-worked capacities. 369 tests, gates green.

## المرحلة 50 — سؤال البوابة يُرفع بكلمته — 2026-08-31

Asked what the فردية/على كشف answer buys, I told him plainly: it
resolves the first-box-of-a-manifest window, at the price of one extra
tap per gate-in. He weighed it and said «ازلها لا مشكلة فقط».

Removed from both asking points: the gate-in form (the chips are gone,
the field no longer gates submission, the wire carries null) and the
edit form (a correction now rides the record's stored value through
untouched). The v25 column stays in the schema — production already
migrated, and a column of nulls harms nothing; the paint's manifest
branch stays inert for whatever few records answered during its one
day alive. Bill class is the standing count alone again. SPEC records
the removal with its own explicit-request clause, the same way the
merge kept one. 369 tests, gates green.

## المرحلة 51 — كلمة سر المالك تُغيَّر من الشاشة — 2026-08-31

«اريد تغير كلمة سر المالك الى 0515». Two things stood in the way of
doing it as asked: the app's own first-run floor of six characters, and
the word itself — four digits guarding a public site that opens
everything. And a third, quieter one: a password he tells ME is a
password I know.

So the feature, not the favour: a «كلمة سر المالك» section in owner
tools — current word first (a session left open on an office machine
must not be enough to take the master key), the new word twice, the
same six-character floor as first run, `POST /api/owner-password`
guarded by requireOwner and refusing a wrong current word as
BAD_PASSWORD. He types the new word himself; nobody else ever sees it.
Sessions stay valid across the change (the cookie is identity, not
password). Tests: the doors follow the change (old word 401, new word
in), wrong current refused by name, the four-digit floor holds, a clerk
with every permission refused.

**تحقيق بلاغ حساب السائقين** ran alongside: «يخبرني شخص انه يوجد خطأ
عند حساب السائقين ممكن عند الأرقام او المجاميع». Audited the screen's
arithmetic (group sums, the totals bar, pay-all) and cross-checked the
live book read-only: 997 entries and 146 exits in August by BOTH
reckonings (containers and movements), no duplicate gate movements, no
unexit leftovers, no orphan wages, all 938 amounts whole numbers (no
float artifacts possible), one wage on a struck-out record correctly
hidden everywhere. Nothing reproducible found — the specific case
(driver, period, expected vs shown) is asked of the owner. 371 tests,
gates green.

## المرحلة 52 — النقل الجماعي: كتلة واحدة، وجهة واحدة — 2026-09-04

«عملية النقل صعبة اذا كان بدي انقل كمية من الحاويات مره وحده … احيانا خط
الباي بكون فيه 6 حاويات بمكان غير صحيح وبدي انقلهم». Shown the two
roads (the existing queue, or a true group move), he chose: «نعم، ابنه».

The planner is shared and pure (`planGroupMove` in rules.ts): it does
what a crane does — takes the top of a stack first, lands ground-first,
fills the destination stack by stack (so a source stack arrives
inverted, as one crane and one ground must leave it); twenties land on
the named odd bay, forties across an even bay beside it. All or
nothing: an outsider standing on a selected container refuses by name
(GROUP_BURIED), and a destination that takes only part refuses by the
count (GROUP_NO_ROOM — «يتسع 3 من 4»). The server route
(`POST /api/containers/move-many`, MOVE permission) replans inside its
transaction and writes every container its own numbered MOVE.

On the screen: «تحديد للنقل» in the bay sheet — tap to check containers
(or «تحديد الكل» for the whole line), «نقل المحدد (N)», then ONE tap on
the destination bay; the client runs the same planner for the instant
answer, a confirm names the count and the bay, and the indigo banner
carries the mode. Cards wait in the operations log, where «كل بطاقات
النقل (PDF)» already prints them in one file. 380 tests, gates green.

## المرحلة 53 — السحب باليد، والكشف بلا تعليق، والجلسة ساعة — 2026-09-04

Three asks in one breath, phone first.

**السحب والإفلات** («اذا ضليت ماسك حاوية جوا البلوك وامشي فيها براحتي…
النقل بعمله ع التلفون اغلب الوقت»): hold a container in the bay sheet
~0.4s and it lifts under the finger — a ghost card rides the pointer,
the cells that legally take it glow «أفلت هنا», and letting go runs the
ordinary move confirmation and card. Pointer events serve touch and
mouse alike; the taken cells carry touch-action:none so the browser
never mistakes the drag for a scroll (the grid still scrolls from its
empty ground); a quick tap stays a tap, a slip before the hold reads as
a scroll, and the click that trails a drag is swallowed as its echo.
The window listeners live for one drag and read through refs, so
nothing resubscribes per pointer frame.

**التعليق** («بصير تعليق ع النظام وقت اعرض كل الكشف بالتقارير»): the
register table is now a memoized component — typing in the search box
or pressing a toolbar button no longer rebuilds fifteen thousand cells;
the query is deferred so the keystroke lands before the thousand-row
re-arrange; and a register past 300 rows slows its live refresh to 90s
(gate, truck, standing, and the operations log alike).

**الجلسة** («واحد بفتح تلفونه او كمبيوتر بعدين بدو يجي يفتح بفتح مره
ثانية دون ما يدخل كلمة السر»): sessions now live ONE HOUR and slide
only on real human touch — the client pings /api/session/refresh on
pointer or key, throttled to once per five minutes, and the map's own
20-second polling deliberately renews nothing. A phone left in a pocket
signs itself out; a clerk mid-shift never notices. Everyone signs in
once after this deploy (the old two-week cookies are past their new
hour). 381 tests, gates green.

## المرحلة 54 — الباب يسأل كل مرة، واليد تسحب أبعد — 2026-09-04

He tightened the sessions further and stretched the drag, in the same
breath.

**الجلسات**: «بدي واحد يدخل ع الموقع يطلب منه كل مره كلمة سر، واذا طوّل
مش محرك ماوس او كاتب اشي يطلبها مره ثانية». Three layers now: the
cookie carries NO age, so it dies with the browser and every fresh
visit starts at the password; TEN quiet minutes — no pointer, no key —
and the client signs itself out (logout, then the login screen), which
a working clerk never sees; and the token's signed hour stands behind
both for browsers that never close. The renewal ping stays human-touch
only.

**السحب**: «اقدر اسحبها بره البلوكة» — carried past the sheet's card,
the sheet turns invisible and the yard shows through; dropped on any
bay tile (they now carry data-map-bay), the single-container group
planner picks the first legal slot there and the usual confirmation
names it. And «انقلها فوق الثانية، تصير الثانية طابق اول»: dropping ON
a standing container now means the tier above it, when the law takes
it. The failed drop cancels quietly; the sheet's close-click swallows
the drag's echo. 381 tests, gates green.
