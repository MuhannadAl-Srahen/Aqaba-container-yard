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
