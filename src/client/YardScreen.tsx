import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContainerDto, Permission, PermitDto, Position, Zone } from '../shared/types';
import { composeLayout, yardSlice, yardsOf } from '../shared/layout';
import { bayLabel, positionLabel, yardOf } from '../shared/address';
import { ltrCode } from '../shared/bidi';
import { fillPlan, planGroupMove, zoneOf } from '../shared/rules';
import { TIERS } from '../shared/types';
import { ApiFailure, api } from './api';
import { AR } from './ar';
import { YardMap } from './YardMap';
import { ReportsScreen } from './ReportsScreen';
import { LogScreen } from './LogScreen';
import { PrintCard, type CardJob } from './PrintCard';
import { PrintVoidCard } from './PrintVoidCard';
import { PrintPermit } from './PrintPermit';
import { PermitSheet } from './PermitSheet';
import { FillSheet } from './FillSheet';
import {
  addressMatch,
  bayKey,
  billBands,
  billBays,
  billMatches,
  billSpread,
  buildBayLoads,
  computeLayout,
  detailLayout,
  nearBillMates,
  searchMatches,
  targetBays,
  toStanding,
} from './mapModel';
import { downloadBlob } from './sheetKit';
import { usePanZoom } from './usePanZoom';
import { GateInSheet } from './GateInSheet';
import { BatchesScreen, type BatchDraft } from './BatchesScreen';
import { ContainerCard } from './ContainerCard';
import { ReclassSheet } from './ReclassSheet';
import { DriversScreen } from './DriversScreen';
import { TasksScreen } from './TasksScreen';
import { TaskMonitorScreen } from './TaskMonitorScreen';
import { chime } from './chime';
import { BaySheet } from './BaySheet';
import { OwnerToolsScreen } from './OwnerToolsScreen';
import { UsersScreen } from './UsersScreen';
import { CarriersScreen } from './CarriersScreen';
import { ZonesScreen } from './ZonesScreen';
import { ThemePicker } from './ThemePicker';
import { Button, Confirm, Toast } from './ui';

/** Below this zoom a cell is a few pixels — hover feedback means nothing. */
const HOVER_MIN_SCALE = 0.5;

/** How much closer the camera steps when the contents paint switches on. */
const DETAIL_ZOOM = 1.5;

const EMPTY_LOAD: readonly ContainerDto[] = [];

/**
 * The one screen. The yard drawing is the interface: receiving, moving and
 * releasing all start with a tap on the ground itself — a bay opens flat as
 * a grid of stacks and tiers, and the exact slot is picked there.
 */
export function YardScreen(props: { onUnauthorized: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ContainerDto | null>(null);
  const [openBay, setOpenBay] = useState<{ zone: Zone; bay: number } | null>(null);
  const [gateInAt, setGateInAt] = useState<Position | null>(null);
  const [moving, setMoving] = useState<ContainerDto | null>(null);
  /**
   * طابور النقل — «اذا ضغطت على حاوية ثانية بحط الحاوية الاولى والثانية
   * بقلي وين بدي احطها»: while a move is placing, tapping other standing
   * containers lines them up here; as each move lands, the next steps up
   * and the map lights its own places. Cancel drops the whole line.
   */
  const [moveQueue, setMoveQueue] = useState<readonly ContainerDto[]>([]);
  /**
   * النقل الجماعي — «بدي انقل كمية من الحاويات مره وحده»: the checked group
   * waiting for ONE destination bay. While set, tapping a bay asks the
   * planner instead of opening the sheet.
   */
  const [groupMove, setGroupMove] = useState<readonly ContainerDto[] | null>(null);
  const [confirmGroup, setConfirmGroup] = useState<{ zone: Zone; bay: number } | null>(null);
  /** When set, the placing flow CORRECTS this movement instead of moving. */
  const [correcting, setCorrecting] = useState<number | null>(null);
  /**
   * تصحيح الفئة: its own sheet, NOT the placing flow. A reclass moves no
   * steel and may not offer the whole yard — the choice is the bay beside
   * the one it already stands on, and nothing else.
   */
  const [reclassing, setReclassing] = useState<ContainerDto | null>(null);
  /** The container whose card should open on its edit form — the register's
   * pencil sets it, the card's close clears it. */
  const [editContainer, setEditContainer] = useState<number | null>(null);
  const [confirmMove, setConfirmMove] = useState<{ container: ContainerDto; to: Position } | null>(
    null,
  );
  // false = closed; true = open on the default tab; a string = open on that
  // bill's own sheet — the search's doorway into كشف البوليصة.
  const [reporting, setReporting] = useState<boolean | string>(false);
  const [logView, setLogView] = useState(false);
  /**
   * The paper on screen: the entry card the moment a container is received,
   * the exit card as it leaves, the move card as it is carried across the
   * yard. A move card names the movement it prints, since one container is
   * moved many times.
   */
  const [printCard, setPrintCard] = useState<CardJob | null>(null);
  /** بطاقة ملغاة: the empty stub of a voided serial, printable like any card. */
  const [voidCard, setVoidCard] = useState<{ serial: number; serialYear: number | null } | null>(
    null,
  );
  /** تصريح تحميل وخروج داخلي: the paper on screen, and the issue form. */
  const [permitPrint, setPermitPrint] = useState<PermitDto | null>(null);
  const [permitCreate, setPermitCreate] = useState<{
    bill: string;
    containers: readonly ContainerDto[];
  } | null>(null);
  /** «كم باقٍ حتى تمتلئ الساحة» — opened from the room chip in the header. */
  const [fillView, setFillView] = useState(false);
  const [usersView, setUsersView] = useState(false);
  /** سجل الناقلين وسياراتهم، وفيه «توزيع السيارات» — للمالك وحده. */
  const [carriersView, setCarriersView] = useState(false);
  /** الزونات والساحات التي يعرّفها المالك بنفسه — للمالك وحده. */
  const [zonesView, setZonesView] = useState(false);
  const [driversView, setDriversView] = useState(false);
  /** أي ساحة تعرضها الخريطة الآن؛ الساحة 2 هي المخطط الرسمي. */
  const [yardView, setYardView] = useState(2);
  /** Temporary: the owner's training tools, removed with OwnerToolsScreen. */
  const [toolsView, setToolsView] = useState(false);
  /** مهام الآليات: شاشة السائق نفسه، وشاشة المراقبة عند المكتب. */
  const [tasksView, setTasksView] = useState(false);
  const [monitorView, setMonitorView] = useState(false);
  /** «عرض الموقع» من مهمة: the container the bay sheet should ring. */
  const [bayHighlight, setBayHighlight] = useState<number | null>(null);
  /** دفعات كشف الجمارك: سجل الكشوف المرفوعة. */
  const [batchesView, setBatchesView] = useState(false);
  /**
   * «تسجيل دخولها» from a دفعة row arms a DRAFT, never a form: the map is
   * the application, so the clerk still taps the bay and picks the slot —
   * the gate-in sheet then opens carrying the sheet's number and bill.
   */
  const [batchDraft, setBatchDraft] = useState<BatchDraft | null>(null);

  /**
   * Selecting a container in another yard swings the map to that yard —
   * a search answer must never light a cell on a drawing that is off
   * screen. Deleting the yard's last zone falls back to the plan's own.
   */
  const followSelection = (zone: string | undefined): void => {
    if (zone !== undefined) setYardView(yardOf(zone));
  };
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  // Who is working: the header, the sheets and the card only offer what this
  // person is allowed to do. The server is still the one that refuses.
  const meQuery = useQuery({ queryKey: ['me'], queryFn: api.me });
  const me = meQuery.data ?? null;
  /**
   * The owner does not stop being the owner while `me` is being re-read.
   * Without this latch, any moment when that answer is briefly absent drops
   * `isOwner` to false and tears an owner-only screen off the page in the
   * middle of what he is doing — which is how a wipe came to run, say nothing,
   * and leave him looking at the map wondering whether it had.
   *
   * It only decides what the SCREEN offers. Every route still refuses on its
   * own authority, so a stale latch can permit nothing.
   */
  const knownOwner = useRef(false);
  useEffect(() => {
    if (meQuery.data !== undefined) knownOwner.current = meQuery.data.owner;
  }, [meQuery.data]);
  const isOwner = meQuery.data?.owner ?? knownOwner.current;
  const may = (permission: Permission): boolean =>
    isOwner || (me?.permissions.includes(permission) ?? false);

  /**
   * سائق الآلية يهبط على مهامه — the tablet opens ON the queue, once per
   * sign-in: leaving for the map afterwards is the driver's own choice and
   * must not be fought by a re-render.
   */
  const landedOnTasks = useRef(false);
  useEffect(() => {
    if (landedOnTasks.current || me === null) return;
    landedOnTasks.current = true;
    if (me.machine !== '') setTasksView(true);
  }, [me]);

  /**
   * إشعار داخل التطبيق — «بس يجيهم مهمة يطلعهم اشعار داخل التطبيق انو
   * اجاه امر بالحاوية مشان ينتبه ويكون في صوت»: the driver's pending
   * queue is polled from HERE, whatever screen is up, so the ring, the
   * buzz and the arrival banner reach him on the map as surely as on the
   * queue itself. The same query key the queue screen uses — one cache.
   */
  const driverMachine = me !== null && me.machine !== '' ? me.machine : null;
  const driverQueue = useQuery({
    queryKey: ['tasks', 'PENDING', driverMachine ?? 'CRANE'],
    queryFn: () => api.tasks('PENDING', driverMachine ?? 'CRANE'),
    enabled: driverMachine !== null,
    refetchInterval: 10_000,
  });
  const pendingCount = driverMachine === null ? 0 : (driverQueue.data?.tasks.length ?? 0);
  const knownPending = useRef<number | null>(null);
  const [taskAlert, setTaskAlert] = useState<number | null>(null);
  useEffect(() => {
    if (driverMachine === null || driverQueue.data === undefined) {
      knownPending.current = null;
      return;
    }
    const count = driverQueue.data.tasks.length;
    const before = knownPending.current;
    knownPending.current = count;
    // More work than a moment ago = the gate acted. First answer stays
    // quiet — signing in to a full queue is not news.
    if (before !== null && count > before) {
      chime();
      if (!tasksView) setTaskAlert(count - before);
    }
  }, [driverQueue.data, driverMachine, tasksView]);
  useEffect(() => {
    if (taskAlert === null) return;
    const timer = window.setTimeout(() => {
      setTaskAlert(null);
    }, 15_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [taskAlert]);

  /**
   * Is the map itself the thing on screen? This component owns every screen —
   * the register, the log, the staff list, the owner's tools are all values it
   * renders — so it stays mounted behind all of them, and its poll went on
   * running underneath.
   *
   * That poll is not cheap: each answer rebuilds the whole yard model — the
   * load of every one of 681 ground slots, the free-space arithmetic, the
   * search index — and then re-renders whatever screen is actually in front.
   * Every eight seconds, while somebody is typing an employee's name. It is
   * paid for gladly when the map is on screen, since that IS the map, and it
   * is pure waste when it is not.
   */
  const mapShown =
    !usersView &&
    !toolsView &&
    !carriersView &&
    reporting === false &&
    !logView &&
    !zonesView &&
    !driversView &&
    !tasksView &&
    !monitorView &&
    !batchesView;

  // The map is the shared picture of the ground, so it is the fastest poll:
  // whatever the gate does has to reach the office within a few seconds.
  const state = useQuery({
    queryKey: ['state'],
    queryFn: api.state,
    refetchInterval: mapShown ? 8_000 : false,
    // Nor on coming back to the window while another screen is in front.
    refetchOnWindowFocus: mapShown,
  });

  // A dead session sends us back to the door exactly once. The latch matters:
  // the bounce clears the cache, which re-renders this screen, and without it
  // a lingering 401 would fire the bounce again on every render.
  const { onUnauthorized } = props;
  const bounced = useRef(false);
  useEffect(() => {
    if (bounced.current) return;
    if (state.error instanceof ApiFailure && state.error.code === 'UNAUTHORIZED') {
      bounced.current = true;
      onUnauthorized();
    }
  }, [state.error, onUnauthorized]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  const containers = useMemo(() => state.data?.containers ?? [], [state.data]);
  const loads = useMemo(() => buildBayLoads(containers), [containers]);
  /** Everything on the ground, as the shared rules want to see it. */
  const standingNow = useMemo(
    () =>
      containers
        .filter((row): row is ContainerDto & { position: Position } => row.position !== null)
        .map((row) => ({ id: row.id, number: row.number, size: row.size, position: row.position })),
    [containers],
  );

  /**
   * The whole ground as it stands: the official plan plus the zones the
   * owner has defined — one composed layout for the rules, and one slice of
   * it per yard for the drawing. The zones change only from the editor, so
   * the query rests until it is invalidated there.
   */
  const zonesQuery = useQuery({ queryKey: ['zones'], queryFn: api.zones, staleTime: 60_000 });
  const yardLayout = useMemo(
    () => composeLayout(zonesQuery.data?.zones ?? [], zonesQuery.data?.retired ?? []),
    [zonesQuery.data],
  );
  const yards = useMemo(() => yardsOf(yardLayout), [yardLayout]);
  // Deleting a yard's last zone must not leave the map on an empty page.
  useEffect(() => {
    if (!yards.includes(yardView)) setYardView(2);
  }, [yards, yardView]);
  /**
   * تلوين الخريطة: بالامتلاء كما كانت دائماً، أو بفئات البوالص — «تلون
   * الخريطة بناءا على انو عدد البوليصات يعني فوق ال 5 او فوق ال 10» — أو
   * عرض المحتويات: «تعرض ما داخل البلوك دون ما اكبس على البلوك». The choice
   * is remembered on this device so the map opens the way he left it; the
   * old look stays the first button and the default, untouched.
   */
  const [paint, setPaint] = useState<'fill' | 'bills' | 'detail'>(() => {
    try {
      const saved = localStorage.getItem('yard-paint');
      return saved === 'bills' || saved === 'detail' ? saved : 'fill';
    } catch {
      return 'fill';
    }
  });
  const choosePaint = (value: 'fill' | 'bills' | 'detail'): void => {
    setPaint(value);
    try {
      localStorage.setItem('yard-paint', value);
    } catch {
      // A browser that blocks storage keeps the choice for the session only.
    }
  };

  /**
   * «حتى لو عنى ذلك تكبير الزون فقط في شكل خريطة المحتويات … باقي الخرائط
   * مثل البوالص والامتلاء لا تتغير»: the contents paint redraws the plan
   * its own way — every bay as wide as its stacks' lanes, so a twenty is
   * one square of one width everywhere, and every panel cut to hug its
   * taller tiles — while the fill and bills maps keep the drawing exactly
   * as it always was, no added whiteness anywhere.
   */
  const layout = useMemo(() => {
    const slice = yardSlice(yardLayout, yardView);
    return paint === 'detail' ? detailLayout(slice) : computeLayout(slice);
  }, [yardLayout, yardView, paint]);

  /**
   * A typed address is a search too: «2-E-18-01-A» asks where that is, and
   * the answer is the bay itself — this is a map, so the search opens it.
   */
  const addressHit = useMemo(
    () => addressMatch(yardLayout, containers, search),
    [yardLayout, containers, search],
  );

  const matches = useMemo(() => {
    const found = searchMatches(containers, search);
    // An address lights whatever is standing on it, so the map answers
    // «وين هي» before the dropdown is even touched.
    for (const container of addressHit?.containers ?? []) found.add(container.id);
    return found;
  }, [containers, search, addressHit]);
  const searchActive = search.trim() !== '';
  /** The bills the query touches — each row a doorway to its own sheet. */
  const billRows = useMemo(() => billMatches(containers, search), [containers, search]);

  // While a move is placing: the bays holding at least one legal landing.
  const targets = useMemo(() => {
    if (moving === null) return null;
    return targetBays(yardLayout, containers, moving.size, moving.id);
  }, [yardLayout, containers, moving]);

  /**
   * The bill in play — «احنا محكومين فيه الي هو البوليصة»: the bill of the
   * container being placed, or the one bill the search query names (their
   * own flow: the bill is searched BEFORE the box is put down). Its bays
   * wear a gold count on the map so the newcomer lands beside its group.
   */
  const activeBill = useMemo((): string | null => {
    if (moving !== null) return moving.bill === '' ? null : moving.bill;
    return billRows.length === 1 ? (billRows[0]?.bill ?? null) : null;
  }, [moving, billRows]);
  const billMap = useMemo(
    () => (activeBill === null ? null : billBays(containers, activeBill, moving?.id)),
    [activeBill, containers, moving],
  );
  /** «بوليصتها واقفة في: …» — the gold, told in words under the banner. */
  const billPlaces = useMemo(() => {
    if (billMap === null || billMap.size === 0) return '';
    return [...billMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([key, count]) => {
        const [zone, bay] = key.split('|');
        return AR.billPlace(bayLabel((zone ?? 'A') as Zone, Number(bay ?? 0)), count);
      })
      .join(' · ');
  }, [billMap]);
  /** Zone-level spread for the scatter warning: «زون A: 8 · زون B: 17». */
  const billZoneLine = (bill: string, excludeId?: number): string =>
    billSpread(containers, bill, excludeId)
      .map((stop) => AR.billSpreadStop(stop.zone, stop.count))
      .join(' · ');

  const billPaint = useMemo(
    () => (paint === 'bills' ? billBands(containers) : null),
    [paint, containers],
  );

  /**
   * «قديش باقي» — بقاعدة البلوك: «في حال تم وضع 20 قدم في البلوك سوف يتم
   * تعبئتها كاملا ب 20، اما اربعين ف أربعين». The header chip and the fill
   * calculator answer with the same arithmetic: each figure completes every
   * committed block as its own kind, and empty ground as the figure's kind.
   */
  const free = useMemo(() => {
    const { zones } = fillPlan(yardLayout, toStanding(containers), TIERS.length);
    const byYard = new Map<number, { t20: number; t40: number }>();
    for (const zone of zones) {
      const room = byYard.get(zone.yard) ?? { t20: 0, t40: 0 };
      room.t20 += zone.twenties;
      room.t40 += zone.forties;
      byYard.set(zone.yard, room);
    }
    return [...byYard.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([yard, room]) => ({ yard, ...room }));
  }, [yardLayout, containers]);

  // Out-of-yard hits come from the server: the map query only carries who is standing.
  const remote = useQuery({
    queryKey: ['search', search.trim()],
    queryFn: () => api.search(search.trim()),
    enabled: search.trim().length >= 2,
  });
  const departedResults = useMemo(
    () => (remote.data?.results ?? []).filter((c) => c.position === null),
    [remote.data],
  );
  /** The standing hits, so the search can say WHERE each one is. */
  const standingResults = useMemo(
    () => containers.filter((container) => matches.has(container.id)),
    [containers, matches],
  );

  const pz = usePanZoom(layout.width, layout.height);
  const { wasDrag } = pz;

  /**
   * «تجعل شكل خريطة المحتويات اكبر من باقي الخرائط»: entering the contents
   * paint steps the camera closer so the miniatures read at a glance. The
   * layout swap between the modes already refits the whole yard each way —
   * the step-in lands on top of that fresh fit, and leaving needs nothing.
   * Seeded as 'fill' so a session that OPENS on the saved contents view
   * gets its step-in too.
   */
  const paintBefore = useRef<'fill' | 'bills' | 'detail'>('fill');
  const { zoomCenter } = pz;
  useEffect(() => {
    const before = paintBefore.current;
    paintBefore.current = paint;
    if (before === paint) return;
    if (paint === 'detail') zoomCenter(DETAIL_ZOOM);
  }, [paint, zoomCenter]);

  const refresh = (message: string): void => {
    void queryClient.invalidateQueries({ queryKey: ['state'] });
    void queryClient.invalidateQueries({ queryKey: ['container'] });
    void queryClient.invalidateQueries({ queryKey: ['search'] });
    // The gate acted — every machine queue on every tablet must hear it.
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    // And the دفعة registry recomputes وصل/باقٍ off the book that just moved.
    void queryClient.invalidateQueries({ queryKey: ['batches'] });
    void queryClient.invalidateQueries({ queryKey: ['batch'] });
    void queryClient.invalidateQueries({ queryKey: ['batch-lookup'] });
    // A register open on this same device must not go stale behind the
    // operation that just happened in front of it.
    for (const key of ['report-gate', 'report-standing', 'report-daily', 'report-machines', 'report-truck', 'report-bill', 'report-log', 'report-permits']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    setToast(message);
    setSelected(null);
    setOpenBay(null);
    setGateInAt(null);
    setMoving(null);
    setMoveQueue([]);
    setGroupMove(null);
    setConfirmGroup(null);
    setCorrecting(null);
    setConfirmMove(null);
    // A completed operation retires the armed دفعة draft with everything else.
    setBatchDraft(null);
    setBusy(false);
  };

  const handleBay = (zone: Zone, bay: number): void => {
    // النقل الجماعي: while a group waits, a bay tap NAMES THE DESTINATION —
    // the planner answers on the spot, and only a workable bay confirms.
    if (groupMove !== null) {
      const plan = planGroupMove(
        yardLayout,
        toStanding(containers),
        groupMove.map((container) => container.id),
        { zone, bay },
      );
      if (!plan.ok) {
        setToast(
          plan.code === 'GROUP_BURIED' && plan.other !== undefined && plan.other !== ''
            ? AR.groupBuried(plan.other)
            : plan.code === 'GROUP_NO_ROOM'
              ? AR.groupNoRoom(plan.fit ?? 0, plan.total ?? groupMove.length)
              : (AR.errors[plan.code] ?? AR.networkError),
        );
        return;
      }
      setConfirmGroup({ zone, bay });
      return;
    }
    // One overlay at a time: tapping a bay closes whatever was open. While a
    // move is placing, the sheet opens in placing mode and the exact slot is
    // picked inside it — the map only says WHICH bay.
    setSelected(null);
    setGateInAt(null);
    setOpenBay({ zone, bay });
  };

  const commitMove = (): void => {
    if (confirmMove === null) return;
    setBusy(true);
    // The same picking flow serves two ends: moving the box, or correcting
    // where the LAST move said it landed — paper only, no second card.
    if (correcting !== null) {
      api
        .correctMove(correcting, confirmMove.to)
        .then(({ container: fixed, move }) => {
          refresh(AR.correctMoveDone(fixed.number, positionLabel(confirmMove.to)));
          setPrintCard({ kind: 'move', container: fixed, move });
        })
        .catch((failure: unknown) => {
          setBusy(false);
          setConfirmMove(null);
          setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        });
      return;
    }
    // Whoever is lined up steps up the moment this move lands: the flow
    // stays open, and the map lights the next container's own places.
    const next = moveQueue[0];
    const rest = moveQueue.slice(1);
    api
      .move(confirmMove.container.id, confirmMove.to)
      .then((moved) => {
        refresh(
          AR.moveDone(confirmMove.container.number, positionLabel(confirmMove.to)) +
            (next === undefined ? '' : ` ${AR.moveQueueNext(next.number)}`),
        );
        if (next !== undefined) {
          setMoving(next);
          setMoveQueue(rest);
        }
        // The paper the crane is handed, without anybody asking for it: it
        // names the slot it left and the slot it is going to.
        setPrintCard({ kind: 'move', container: moved.container, move: moved.move });
      })
      .catch((failure: unknown) => {
        setBusy(false);
        setConfirmMove(null);
        setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
      });
  };

  // The map is memoized against pan/zoom frames; its props must hold still.
  // The click handler reads fresh state through a ref so it never changes.
  const handleBayRef = useRef(handleBay);
  handleBayRef.current = handleBay;
  const onBayClick = useCallback(
    (zone: Zone, bay: number) => {
      if (wasDrag()) return;
      handleBayRef.current(zone, bay);
    },
    [wasDrag],
  );

  /**
   * The OWNER drags a zone he defined by its title bar and it parks where
   * he drops it — «تغيير الموقع عن طريق السحب، وهذه الصلاحية فقط لدى
   * المالك». The official zones are not in the set, so they never move.
   */
  const zoneRows = zonesQuery.data?.zones;
  const dragZones = useMemo(() => {
    if (!isOwner || zoneRows === undefined || zoneRows.length === 0) return null;
    // The contents paint draws the plan scaled — a drop there would save the
    // scaled coordinates as real ones. Zones are rearranged in the fill map.
    if (paint === 'detail') return null;
    return {
      names: new Set(zoneRows.map((zone) => zone.zone)),
      onDrop: (name: string, x: number, y: number): void => {
        const dropped = zoneRows.find((zone) => zone.zone === name);
        if (dropped === undefined) return;
        api
          .editZone(dropped.id, { x: Math.round(x), y: Math.round(y) })
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: ['zones'] });
            setToast(AR.zoneMoved);
          })
          .catch((failure: unknown) => {
            setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
          });
      },
    };
  }, [isOwner, zoneRows, paint, queryClient]);

  const mapProps = useMemo(
    () => ({
      loads,
      selectedId: selected?.id ?? null,
      matches,
      searchActive,
      targets,
      billBays: billMap !== null && billMap.size > 0 ? billMap : null,
      billPaint,
      detail: paint === 'detail',
      movingId: moving?.id ?? null,
      onBayClick,
      dragZones,
    }),
    [loads, selected, matches, searchActive, targets, billMap, billPaint, paint, moving, onBayClick, dragZones],
  );

  const openZone = openBay === null ? null : zoneOf(yardLayout, openBay.zone);

  /**
   * The screen the app is on. It is a VALUE, not an early return, because the
   * overlays below have to outlive it: the gate card is opened from inside a
   * register, and while a register owned the whole render the card had
   * nothing to mount into — it appeared only once the register was closed.
   */
  let screen: ReactElement;
  if (usersView && isOwner) {
    screen = (
      <UsersScreen
        onBack={() => {
          setUsersView(false);
        }}
      />
    );
  } else if (carriersView && isOwner) {
    screen = (
      <CarriersScreen
        onBack={() => {
          setCarriersView(false);
        }}
      />
    );
  } else if (driversView && may('ACCOUNTING')) {
    screen = (
      <DriversScreen
        isOwner={isOwner}
        onBack={() => {
          setDriversView(false);
        }}
      />
    );
  } else if (tasksView && me !== null && me.machine !== '') {
    screen = (
      <TasksScreen
        machine={me.machine}
        onShowSlot={(task) => {
          if (task.position === null) return;
          followSelection(task.position.zone);
          // The sheet is always an odd bay's; a forty's even address is read
          // through the odd bay under its lower half.
          const sheetBay = task.position.bay % 2 === 1 ? task.position.bay : task.position.bay - 1;
          setOpenBay({ zone: task.position.zone, bay: sheetBay });
          setBayHighlight(task.containerId);
          setTasksView(false);
        }}
        onShowCard={(task) => {
          // «اظهار بطاقة الدخول عند المهام»: the printed paper itself, over
          // the queue — an exit already recorded shows its exit card, and
          // everything else the entry card the photo used to carry.
          api
            .detail(task.containerId)
            .then(({ container }) => {
              setPrintCard({
                kind: task.kind === 'OUT' && container.exitedAt !== null ? 'out' : 'in',
                container,
              });
            })
            .catch((failure: unknown) => {
              setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
            });
        }}
        onBack={() => {
          setTasksView(false);
        }}
      />
    );
  } else if (monitorView && (isOwner || may('GATE_IN') || may('GATE_OUT'))) {
    screen = (
      <TaskMonitorScreen
        onBack={() => {
          setMonitorView(false);
        }}
      />
    );
  } else if (batchesView && (isOwner || may('GATE_IN') || may('REPORTS'))) {
    screen = (
      <BatchesScreen
        canUpload={isOwner || may('GATE_IN')}
        isOwner={isOwner}
        onBack={() => {
          setBatchesView(false);
        }}
        onReceive={(draft) => {
          // Back to the map, armed: the banner names the box and its bay
          // parity, and the clerk walks the ground as always.
          setBatchesView(false);
          setBatchDraft(draft);
        }}
      />
    );
  } else if (zonesView && isOwner) {
    screen = (
      <ZonesScreen
        onBack={() => {
          setZonesView(false);
        }}
      />
    );
  } else if (toolsView && isOwner) {
    screen = (
      <OwnerToolsScreen
        onBack={() => {
          setToolsView(false);
        }}
      />
    );
  } else if (reporting !== false) {
    screen = (
      <ReportsScreen
        initialBill={typeof reporting === 'string' ? reporting : undefined}
        onCard={(kind, containerId) => {
          // Straight from the register row to the paper — no hunting the
          // exact number down in the search box first.
          void api.detail(containerId).then(({ container }) => {
            setPrintCard({ kind, container });
          });
        }}
        onVoidCard={(serial, serialYear) => {
          // The stub's own paper: nothing to fetch, the number IS the paper.
          setVoidCard({ serial, serialYear });
        }}
        onEdit={(containerId) => {
          // «تعديل بيانات الصف … دون الرجوع الى مكان وجود الحاوية»: the
          // card opens over the register with its edit form already out.
          api
            .detail(containerId)
            .then(({ container }) => {
              setEditContainer(container.id);
              setSelected(container);
            })
            .catch((failure: unknown) => {
              setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
            });
        }}
        onPermit={(permitId) => {
          // The row may be stale — the owner can void a permit from another
          // device — so a refusal is told in a sentence, not swallowed.
          api.permit(permitId).then(setPermitPrint).catch((failure: unknown) => {
            setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
          });
        }}
        onCreatePermit={(bill, billContainers) => {
          setPermitCreate({ bill, containers: billContainers });
        }}
        canPermit={may('GATE_OUT')}
        canEdit={may('EDIT')}
        isOwner={isOwner}
        onBack={() => {
          setReporting(false);
        }}
      />
    );
  } else if (logView) {
    screen = (
      <LogScreen
        // Undoing what the log already records is the owner's alone; the
        // server refuses either way, this keeps the promise off the screen.
        isOwner={isOwner}
        onBack={() => {
          setLogView(false);
        }}
      />
    );
  } else {
    screen = (
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="z-10 border-b border-line bg-surface px-3 py-2 shadow-sm lg:px-5">
        <div className="flex flex-wrap items-center gap-2 lg:gap-4">
          <h1 className="text-base font-extrabold text-ink lg:text-lg">{AR.appName}</h1>
          <span className="hidden text-xs font-medium text-faint lg:block">
            {AR.inYardCount(containers.length)}
          </span>

          <div className="order-3 flex w-full items-center gap-2 lg:order-none lg:w-auto lg:flex-1 lg:justify-center">
            <div className="relative w-full max-w-md">
              <input
                className={
                  'w-full rounded-xl border border-line-strong bg-sunken px-3.5 py-2 text-sm ' +
                  'outline-none focus:border-blue-500 focus:bg-surface focus:ring-2 focus:ring-blue-200'
                }
                placeholder={AR.searchPlaceholder}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
              {searchActive && (
                <button
                  type="button"
                  aria-label={AR.clearSearch}
                  onClick={() => {
                    setSearch('');
                  }}
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 text-faint hover:text-ink"
                >
                  ✕
                </button>
              )}
              {/* A search must answer «وين هي» in words, not only by lighting
                  a cell somewhere off screen: the standing hits come first,
                  each with its full official code. */}
              {searchActive &&
                (standingResults.length > 0 ||
                  departedResults.length > 0 ||
                  billRows.length > 0 ||
                  addressHit !== null) && (
                <div className="absolute top-full z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
                  {/* An address row goes to the ground it names — the bay
                      sheet, open, with whatever is standing there. */}
                  {addressHit !== null && (
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2.5 text-sm hover:bg-sunken"
                      onClick={() => {
                        followSelection(addressHit.zone);
                        setOpenBay({ zone: addressHit.zone, bay: addressHit.bay });
                        setSearch('');
                      }}
                    >
                      <span className="font-semibold text-blue-800 dark:text-blue-300">
                        {AR.searchAddressRow(addressHit.containers.length)}
                      </span>
                      <span
                        className="shrink-0 rounded-md bg-blue-700 px-1.5 py-0.5 font-mono text-xs font-bold text-white"
                        dir="ltr"
                      >
                        {addressHit.position === null
                          ? bayLabel(addressHit.zone, addressHit.bay)
                          : positionLabel(addressHit.position)}
                      </span>
                    </button>
                  )}
                  {/* A bill row is a doorway: the whole group, on its own sheet. */}
                  {billRows.length > 0 && may('REPORTS') && (
                    <p className="bg-sunken px-3 py-1.5 text-xs font-bold text-muted">
                      {AR.searchBillTitle}
                    </p>
                  )}
                  {may('REPORTS') &&
                    billRows.map((row) => {
                      // «بدي تحكيلي اذا في حاويات بنفس البوليصة منفصلات»:
                      // one zone reads calm, more than one reads amber.
                      const spread = billSpread(containers, row.bill);
                      const spreadLine =
                        spread.length === 0
                          ? AR.billSpreadNone
                          : spread.length === 1
                            ? AR.billSpreadOne(spread[0]?.zone ?? '', spread[0]?.count ?? 0)
                            : AR.billSpreadMany(
                                spread
                                  .map((stop) => AR.billSpreadStop(stop.zone, stop.count))
                                  .join(' · '),
                              );
                      return (
                        <button
                          key={row.bill}
                          type="button"
                          className="flex w-full flex-col gap-0.5 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-sunken dark:text-blue-300"
                          onClick={() => {
                            setReporting(row.bill);
                          }}
                        >
                          <span className="flex w-full items-center justify-between gap-2">
                            <span>{AR.searchBillRow(row.bill, row.count)}</span>
                            <span className="text-xs text-faint">←</span>
                          </span>
                          <span
                            className={
                              'text-xs font-semibold ' +
                              (spread.length > 1
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-faint')
                            }
                          >
                            {spreadLine}
                          </span>
                        </button>
                      );
                    })}
                  {standingResults.length > 0 && (
                    <p className="bg-sunken px-3 py-1.5 text-xs font-bold text-muted">
                      {AR.searchInTitle}
                    </p>
                  )}
                  {standingResults.slice(0, 8).map((container) => (
                    <button
                      key={container.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-sunken"
                      onClick={() => {
                        followSelection(container.position?.zone);
                        setSelected(container);
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="font-mono font-semibold text-ink" dir="ltr">
                          {container.number}
                        </span>
                        <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-bold text-muted">
                          {AR.feet(container.size)}
                        </span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        {container.bill !== '' && (
                          <span className="truncate font-mono text-xs text-muted" dir="ltr">
                            {container.bill}
                          </span>
                        )}
                        <span
                          className="shrink-0 rounded-md bg-blue-700 px-1.5 py-0.5 font-mono text-xs font-bold text-white"
                          dir="ltr"
                        >
                          {container.position === null ? '—' : positionLabel(container.position)}
                        </span>
                      </span>
                    </button>
                  ))}
                  {departedResults.length > 0 && (
                    <p className="bg-sunken px-3 py-1.5 text-xs font-bold text-muted">
                      {AR.searchOutTitle}
                    </p>
                  )}
                  {departedResults.slice(0, 6).map((container) => (
                    <button
                      key={container.id}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-sunken"
                      onClick={() => {
                        setSelected(container);
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="font-mono font-semibold text-ink" dir="ltr">
                          {container.number}
                        </span>
                        <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-bold text-muted">
                          {AR.feet(container.size)}
                        </span>
                      </span>
                      <span className="font-mono text-xs text-muted" dir="ltr">
                        {container.bill === '' ? '—' : container.bill}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {searchActive && (
              <span className="whitespace-nowrap text-xs font-semibold text-amber-600">
                {AR.matches(matches.size + departedResults.length)}
              </span>
            )}
          </div>

          {/* Only what this person may actually do reaches the header. The
              server refuses the rest regardless — this is just courtesy. */}
          <div className="ms-auto flex items-center gap-1.5">
            <ThemePicker />
            {me !== null && me.machine !== '' && (
              <Button
                kind="quiet"
                onClick={() => {
                  setTasksView(true);
                }}
              >
                {pendingCount > 0 ? `${AR.myTasksButton} (${String(pendingCount)})` : AR.myTasksButton}
              </Button>
            )}
            {(isOwner || may('GATE_IN') || may('GATE_OUT')) && (
              <Button
                kind="quiet"
                onClick={() => {
                  setMonitorView(true);
                }}
              >
                {AR.tasksButton}
              </Button>
            )}
            {(isOwner || may('GATE_IN') || may('REPORTS')) && (
              <Button
                kind="quiet"
                onClick={() => {
                  setBatchesView(true);
                }}
              >
                {AR.batchesButton}
              </Button>
            )}
            {may('ACCOUNTING') && (
              <Button
                kind="quiet"
                onClick={() => {
                  setDriversView(true);
                }}
              >
                {AR.driversButton}
              </Button>
            )}
            {may('REPORTS') && (
              <>
                <Button
                  kind="quiet"
                  onClick={() => {
                    setReporting(true);
                  }}
                >
                  {AR.reports}
                </Button>
                <Button
                  kind="quiet"
                  onClick={() => {
                    setLogView(true);
                  }}
                >
                  {AR.logButton}
                </Button>
              </>
            )}
            {isOwner && (
              <>
                <Button
                  kind="quiet"
                  onClick={() => {
                    setUsersView(true);
                  }}
                >
                  {AR.usersButton}
                </Button>
                <Button
                  kind="quiet"
                  onClick={() => {
                    setCarriersView(true);
                  }}
                >
                  {AR.carriersButton}
                </Button>
                <Button
                  kind="quiet"
                  onClick={() => {
                    setZonesView(true);
                  }}
                >
                  {AR.zonesButton}
                </Button>
                <Button
                  kind="quiet"
                  disabled={backingUp}
                  onClick={() => {
                    setBackingUp(true);
                    api
                      .backup()
                      .then(({ blob, filename }) => {
                        // Two copies from one tap: the server kept its own,
                        // and this one lands in the browser's downloads.
                        downloadBlob(blob, filename);
                        setToast(AR.backupDone);
                        setBackingUp(false);
                      })
                      .catch((failure: unknown) => {
                        setToast(
                          failure instanceof ApiFailure ? failure.arabic : AR.networkError,
                        );
                        setBackingUp(false);
                      });
                  }}
                >
                  {backingUp ? AR.backupWorking : AR.backup}
                </Button>
                {/* Temporary, for the training period — see OwnerToolsScreen. */}
                <Button
                  kind="quiet"
                  onClick={() => {
                    setToolsView(true);
                  }}
                >
                  {AR.toolsButton}
                </Button>
              </>
            )}
            <span className="hidden text-xs font-bold text-muted lg:block">{me?.name}</span>
            <Button
              kind="quiet"
              onClick={() => {
                void api.logout().then(props.onUnauthorized);
              }}
            >
              {AR.logout}
            </Button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {/* One map, three paints: fullness as always, the size class of
              each bay's biggest bill — «تلون الخريطة بناءا على عدد
              البوليصات» — or the contents in miniature: «تعرض ما داخل البلوك
              دون ما اكبس على البلوك». The legend follows whichever is on. */}
          <div className="flex gap-1 rounded-xl border border-line bg-sunken p-0.5">
            {(
              [
                ['fill', AR.paintByFill],
                ['bills', AR.paintByBills],
                ['detail', AR.paintByDetail],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  choosePaint(value);
                }}
                className={
                  'rounded-lg px-2 py-0.5 text-xs font-bold transition-colors ' +
                  (paint === value
                    ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                    : 'text-muted hover:bg-line')
                }
              >
                {label}
              </button>
            ))}
          </div>
          {paint === 'bills' ? (
            <>
              <LegendChip color="var(--yard-band-1)" label={AR.legendBand1} />
              <LegendChip color="var(--yard-band-2)" label={AR.legendBand2} />
              <LegendChip color="var(--yard-band-3)" label={AR.legendBand3} />
              <LegendChip color="var(--yard-band-4)" label={AR.legendBand4} />
            </>
          ) : paint === 'detail' ? (
            <>
              <LegendChip color="var(--yard-box20)" label={AR.legendBox20} />
              <LegendChip color="var(--yard-box40)" label={AR.legendBox40} />
              <LegendChip color="var(--yard-slot)" label={AR.legendSlotFree} />
            </>
          ) : (
            <>
              <LegendChip color="var(--yard-free)" label={AR.legendFree} dashed />
              <LegendChip
                color="var(--yard-partial)"
                label={AR.legendPartial}
                border="var(--yard-partial-border)"
              />
              <LegendChip color="var(--yard-full)" label={AR.legendFull} />
            </>
          )}
          {moving !== null && (
            <LegendChip
              color="var(--yard-target)"
              label={AR.legendTarget}
              border="var(--yard-target-border)"
            />
          )}
          {containers.some((c) => c.notes !== '') && (
            <LegendChip color="var(--yard-match)" label={AR.legendNoted} dot />
          )}
          {billMap !== null && billMap.size > 0 && (
            <LegendChip color="var(--yard-bill)" label={AR.legendBill} dot />
          )}

          {/* How much room is left, per yard the plan actually holds: one
              chip today, since the whole drawing is one yard. It counts the
              slots a container could be set down on this minute — press it
              for the other question, how many more until the yard is full. */}
          <span className="ms-auto flex flex-wrap items-center gap-1.5">
            {free.map((room) => (
              <FreeChip
                key={room.yard}
                label={AR.freeOfYard(room.yard, room.t20, room.t40)}
                onClick={() => {
                  setFillView(true);
                }}
              />
            ))}
          </span>
        </div>
      </header>

      {groupMove !== null && (
        <div className="z-10 flex items-center justify-between gap-3 bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white">
          <span>{AR.groupBanner(groupMove.length)}</span>
          <button
            type="button"
            className="rounded-lg bg-indigo-800 px-3 py-1 hover:bg-indigo-900"
            onClick={() => {
              setGroupMove(null);
              setConfirmGroup(null);
            }}
          >
            {AR.movingCancel}
          </button>
        </div>
      )}
      {moving !== null && (
        <div className="z-10 flex items-center justify-between gap-3 bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
          <span className="min-w-0">
            <span className="block">
              {correcting !== null
                ? AR.correctingBanner(moving.number)
                : AR.movingBanner(moving.number)}
            </span>
            {/* Where the bill already stands — the crane aims beside it,
                because the whole bill leaves in one batch. */}
            {moving.bill !== '' && billPlaces !== '' && (
              <span className="mt-0.5 block truncate text-xs font-semibold text-amber-200">
                {AR.billStandsAt(moving.bill, billPlaces)}
              </span>
            )}
            {/* Who is lined up behind this one — the queue in words. */}
            {moveQueue.length > 0 && (
              <span className="mt-0.5 block truncate text-xs font-semibold text-emerald-100">
                {AR.moveQueueLine(
                  moveQueue.length,
                  moveQueue
                    .slice(0, 3)
                    .map((queued) => ltrCode(queued.number))
                    .join('، ') + (moveQueue.length > 3 ? ' …' : ''),
                )}
              </span>
            )}
          </span>
          <button
            type="button"
            className="rounded-lg bg-emerald-800 px-3 py-1 hover:bg-emerald-900"
            onClick={() => {
              setMoving(null);
              setMoveQueue([]);
              setCorrecting(null);
            }}
          >
            {AR.movingCancel}
          </button>
        </div>
      )}
      {/* تسجيل من الدفعة: the armed draft walks the map like a move does —
          the banner carries the number and which bay parity fits it. */}
      {batchDraft !== null && moving === null && (
        <div className="z-10 flex items-center justify-between gap-3 bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
          <span className="min-w-0">
            <span className="block">{AR.batchDraftBanner(batchDraft.number)}</span>
            <span className="mt-0.5 block text-xs font-semibold text-emerald-100">
              {batchDraft.size !== null
                ? AR.batchDraftSize(batchDraft.size)
                : AR.batchDraftSizeUnknown(batchDraft.sizeRaw)}
            </span>
          </span>
          <button
            type="button"
            className="rounded-lg bg-emerald-800 px-3 py-1 hover:bg-emerald-900"
            onClick={() => {
              setBatchDraft(null);
            }}
          >
            {AR.movingCancel}
          </button>
        </div>
      )}

      <main className="relative flex-1 overflow-hidden">
        <div
          ref={pz.attachContainer}
          {...pz.handlers}
          className="absolute inset-0 touch-none overflow-hidden"
          style={{ contain: 'layout paint' }}
        >
          <div
            className={pz.view.scale >= HOVER_MIN_SCALE ? 'map-hover' : undefined}
            style={{
              // Pinned physically top-left: pan/zoom math works in client
              // coordinates, and RTL would otherwise right-align this box
              // and shift the whole coordinate system.
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate(${String(pz.view.x)}px, ${String(pz.view.y)}px) scale(${String(pz.view.scale)})`,
              transformOrigin: '0 0',
              // Its own compositor layer: panning must never repaint the
              // thousands of SVG nodes behind it.
              willChange: 'transform',
              width: layout.width,
              height: layout.height,
            }}
          >
            <YardMap layout={layout} map={mapProps} />
          </div>
        </div>

        {/* More than one yard: the drawings sit behind tabs, one ground at
            a time, and the search swings to the yard its answer stands in. */}
        {yards.length > 1 && (
          <div className="absolute start-3 top-3 z-10 flex gap-1 rounded-xl border border-line bg-surface/95 p-1 shadow-md">
            {yards.map((yard) => (
              <button
                key={yard}
                type="button"
                onClick={() => {
                  setYardView(yard);
                }}
                className={
                  'rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ' +
                  (yardView === yard
                    ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                    : 'text-muted hover:bg-sunken')
                }
              >
                {AR.yardTab(yard)}
              </button>
            ))}
          </div>
        )}

        {/* A failed zones fetch must not pass for «no owner yards exist»:
            the map would quietly drop grounds 1 and 3 and every box on
            them. Say it, and offer the retry. */}
        {zonesQuery.isError && (
          <div className="absolute inset-x-0 top-3 z-10 mx-auto flex w-fit items-center gap-2 rounded-xl border border-amber-400 bg-surface/95 px-3 py-1.5 shadow-md">
            <span className="text-xs font-semibold text-ink">{AR.zonesLoadFailed}</span>
            <button
              type="button"
              onClick={() => {
                void zonesQuery.refetch();
              }}
              className="rounded-lg border border-line-strong px-2 py-0.5 text-xs font-bold text-ink hover:bg-sunken"
            >
              {AR.zonesRetry}
            </button>
          </div>
        )}

        <div className="absolute bottom-4 end-4 flex flex-col gap-1.5">
          {(
            [
              ['+', AR.zoomIn, pz.zoomButtons.zoomIn],
              ['−', AR.zoomOut, pz.zoomButtons.zoomOut],
              ['◻', AR.fit, pz.zoomButtons.fit],
            ] as const
          ).map(([glyph, label_, action]) => (
            <button
              key={label_}
              type="button"
              aria-label={label_}
              onClick={action}
              className="h-10 w-10 rounded-xl border border-line bg-surface text-lg font-bold text-ink shadow-sm hover:bg-sunken"
            >
              {glyph}
            </button>
          ))}
        </div>
      </main>

      {openBay !== null && openZone !== null && (
        <BaySheet
          layout={yardLayout}
          zone={openZone}
          bay={openBay.bay}
          containers={containers}
          load={loads.get(bayKey(openBay.zone, openBay.bay)) ?? EMPTY_LOAD}
          canGateIn={may('GATE_IN')}
          canMove={may('MOVE')}
          highlightId={bayHighlight ?? undefined}
          placing={moving}
          onAddToMove={
            moving !== null && correcting === null
              ? (container): void => {
                  if (
                    container.id === moving.id ||
                    moveQueue.some((queued) => queued.id === container.id)
                  ) {
                    setToast(AR.moveAlreadyQueued(container.number));
                    return;
                  }
                  setMoveQueue([...moveQueue, container]);
                  setToast(AR.moveQueued(container.number, moveQueue.length + 1));
                }
              : undefined
          }
          onGroupMove={(group) => {
            setOpenBay(null);
            setGroupMove(group);
          }}
          onDragMove={
            may('MOVE')
              ? (container, to) => {
                  setConfirmMove({ container, to });
                }
              : undefined
          }
          onDragOut={
            may('MOVE')
              ? (container, target) => {
                  // «اقدر اسحبها بره البلوكة»: dropped on a map bay, the
                  // planner picks its first legal slot there and the usual
                  // confirmation names it.
                  const plan = planGroupMove(yardLayout, toStanding(containers), [container.id], target);
                  const step = plan.ok ? plan.steps[0] : undefined;
                  if (!plan.ok || step === undefined) {
                    setToast(
                      !plan.ok && plan.code === 'GROUP_NO_ROOM'
                        ? AR.landingNoneInBay
                        : ((!plan.ok ? AR.errors[plan.code] : undefined) ?? AR.networkError),
                    );
                    return;
                  }
                  setOpenBay(null);
                  setConfirmMove({ container, to: step.to });
                }
              : undefined
          }
          onPick={(container) => {
            setOpenBay(null);
            setSelected(container);
          }}
          onGateIn={(position) => {
            setOpenBay(null);
            setGateInAt(position);
          }}
          onMoveTo={(position) => {
            if (moving === null) return;
            setOpenBay(null);
            setConfirmMove({ container: moving, to: position });
          }}
          onClose={() => {
            setOpenBay(null);
            setBayHighlight(null);
          }}
        />
      )}

      {gateInAt !== null && state.data !== undefined && (
        <GateInSheet
          position={gateInAt}
          // Their own flow: the bill is searched BEFORE the box is put
          // down — so a search naming exactly one bill fills the form's
          // bill box by itself. The clerk still sees it and can change it.
          // An armed دفعة draft outranks both: the sheet's own word arrives
          // written in, number and bill together.
          initialNumber={batchDraft !== null ? batchDraft.number : ''}
          initialBill={
            batchDraft !== null ? batchDraft.bill : moving === null ? (activeBill ?? '') : ''
          }
          containers={containers}
          // The entry card is what the gate is doing this for, so it comes up
          // by itself — no hunting the container down to press a button.
          onDone={(container, message) => {
            refresh(message);
            setPrintCard({ kind: 'in', container });
          }}
          onClose={() => {
            setGateInAt(null);
          }}
        />
      )}

      {confirmGroup !== null && groupMove !== null && (
        <Confirm
          title={AR.confirmGroupTitle}
          body={AR.confirmGroupBody(groupMove.length, bayLabel(confirmGroup.zone, confirmGroup.bay))}
          confirmLabel={AR.actionMove}
          busy={busy}
          onConfirm={() => {
            setBusy(true);
            api
              .moveMany(
                groupMove.map((container) => container.id),
                confirmGroup,
              )
              .then(({ moved }) => {
                refresh(AR.groupMoveDone(moved));
              })
              .catch((failure: unknown) => {
                setBusy(false);
                setConfirmGroup(null);
                setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
              });
          }}
          onCancel={() => {
            setConfirmGroup(null);
          }}
        />
      )}

      {confirmMove !== null && (
        <Confirm
          title={AR.confirmMoveTitle}
          body={
            AR.confirmMoveBody(confirmMove.container.number, positionLabel(confirmMove.to)) +
            // Landing away from the bill's own block gets a warning, never a
            // refusal — the batch exits by bill, but the crane decides.
            (correcting === null &&
            confirmMove.container.bill !== '' &&
            nearBillMates(
              containers,
              confirmMove.container.bill,
              confirmMove.to,
              confirmMove.container.id,
            ) === false
              ? ` ${AR.billFarWarning(confirmMove.container.bill, billZoneLine(confirmMove.container.bill, confirmMove.container.id))}`
              : '')
          }
          confirmLabel={correcting !== null ? AR.correctMoveAction : AR.actionMove}
          busy={busy}
          onConfirm={commitMove}
          onCancel={() => {
            setConfirmMove(null);
          }}
        />
      )}
    </div>
    );
  }

  // The overlays sit OUTSIDE the screen choice, so a gate card opened from a
  // register appears over the register instead of waiting for it to close.
  return (
    <>
      {screen}
      {fillView && (
        <FillSheet
          layout={yardLayout}
          containers={containers}
          onClose={() => {
            setFillView(false);
          }}
        />
      )}
      {permitCreate !== null && (
        <PermitSheet
          // Keyed by bill: pressing «إصدار تصريح» for another bill while the
          // sheet is open must start a fresh sheet, not reuse this one's
          // checkboxes against the other bill's containers.
          key={permitCreate.bill}
          bill={permitCreate.bill}
          containers={permitCreate.containers}
          onDone={(permit, message) => {
            // The paper is the point: it opens by itself, and the register
            // behind refreshes to show the new serial.
            setPermitCreate(null);
            setToast(message);
            void queryClient.invalidateQueries({ queryKey: ['report-permits'] });
            setPermitPrint(permit);
          }}
          onClose={() => {
            setPermitCreate(null);
          }}
        />
      )}
      {permitPrint !== null && (
        <PrintPermit
          permit={permitPrint}
          onClose={() => {
            setPermitPrint(null);
          }}
        />
      )}
      {/* The container's card lives HERE, above every screen: a register's
          pencil opens it over the register itself — «دون الرجوع الى مكان
          وجود الحاوية». */}
      {selected !== null && (
        <ContainerCard
          container={selected}
          startEditing={editContainer === selected.id}
          may={may}
          onStartMove={(container) => {
            setSelected(null);
            // The move is picked on the map — a register in front steps aside.
            setReporting(false);
            setLogView(false);
            setMoving(container);
          }}
          onStartCorrect={(container, movementId) => {
            setSelected(null);
            setReporting(false);
            setLogView(false);
            setMoving(container);
            setCorrecting(movementId);
          }}
          onStartReclass={(container) => {
            setSelected(null);
            setReclassing(container);
          }}
          onPrint={setPrintCard}
          onExited={(departed, message) => {
            refresh(message);
            setPrintCard({ kind: 'out', container: departed });
          }}
          onChanged={refresh}
          onClose={() => {
            setSelected(null);
            setEditContainer(null);
          }}
        />
      )}
      {reclassing !== null && (
        <ReclassSheet
          container={reclassing}
          layout={yardLayout}
          standing={standingNow}
          onDone={(corrected, message) => {
            setReclassing(null);
            refresh(message);
            setSelected(corrected);
          }}
          onClose={() => {
            setReclassing(null);
          }}
        />
      )}
      {printCard !== null && (
        <PrintCard
          {...printCard}
          onClose={() => {
            setPrintCard(null);
          }}
        />
      )}
      {voidCard !== null && (
        <PrintVoidCard
          serial={voidCard.serial}
          serialYear={voidCard.serialYear}
          onClose={() => {
            setVoidCard(null);
          }}
        />
      )}
      {/* لافتة وصول مهمة — تعلو أي شاشة كان عليها السائق، وتُفتح منها
          القائمة مباشرة؛ الرنة والاهتزاز انطلقا لحظةَ رصد الوصول. */}
      {taskAlert !== null && driverMachine !== null && !tasksView && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="flex w-full max-w-md flex-wrap items-center gap-3 rounded-2xl border-2 border-amber-400 bg-surface p-3 shadow-2xl">
            <span className="text-sm font-bold text-ink">{AR.taskArrived(taskAlert)}</span>
            <span className="ms-auto flex gap-2">
              <Button
                onClick={() => {
                  setTaskAlert(null);
                  setTasksView(true);
                }}
              >
                {AR.taskOpenQueue}
              </Button>
              <Button
                kind="quiet"
                onClick={() => {
                  setTaskAlert(null);
                }}
              >
                {AR.close}
              </Button>
            </span>
          </div>
        </div>
      )}
      {toast !== null && <Toast message={toast} />}
    </>
  );
}

/** One yard's remaining room, sized to be read across the office. */
function FreeChip(props: { label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={AR.fillTitle}
      className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-800 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-200"
    >
      {props.label}
    </button>
  );
}

function LegendChip(props: {
  color: string;
  label: string;
  dashed?: boolean;
  dot?: boolean;
  border?: string;
}): ReactElement {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={props.dot === true ? 'inline-block h-2.5 w-2.5 rounded-full' : 'inline-block h-3 w-4 rounded-sm'}
        style={{
          backgroundColor: props.color,
          border:
            props.border !== undefined
              ? `1.5px solid ${props.border}`
              : props.dashed === true
                ? '1.5px dashed #cbd5e1'
                : undefined,
        }}
      />
      {props.label}
    </span>
  );
}
