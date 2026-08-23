import type { ErrorCode, Permission, Tier } from '../shared/types';
import { TIERS } from '../shared/types';

/**
 * Every sentence the user reads, in one file, in clear formal Arabic — on the
 * owner's instruction: «عربية رسمية واضحة». Formal, not stiff: the imperative
 * for what the user should do, «تم …» for what the system did, a full sentence
 * for every refusal that names the cause and then the remedy. Western digits
 * throughout, by the owner's standing rule.
 *
 * The place words stay the official plan's own: يارد، زون، باي، ستاك، طابق —
 * and the full code reads `1-A-03-01-A`.
 */

export const AR = {
  appName: 'ساحة العقبة',

  // ---- boot / auth ----
  loading: 'جارٍ التحميل…',
  loginTitle: 'تسجيل الدخول',
  loginHint: 'أدخل كلمة سر الموقع',
  loginWho: 'اختر اسمك',
  loginPinFor: (name: string): string => `${name} — أدخل الرمز السري`,
  loginAsOwner: 'دخول المالك',
  loginBack: 'العودة إلى قائمة الأسماء',
  password: 'كلمة السر',
  pin: 'الرمز السري',
  enter: 'دخول',
  logout: 'خروج',

  // ---- theme ----
  themeLabel: 'الإضاءة',
  themeLight: 'فاتح',
  themeDark: 'غامق',
  themeSystem: 'حسب الجهاز',

  // ---- carriers & trucks ----
  carriersTitle: 'الناقلون والسيارات',
  carriersButton: 'الناقلون',
  carriersHint:
    'سجّل كل ناقل وسياراته مرة واحدة: البوابة تتعرّف على رقم السيارة وتقترح اسم السائق، ' +
    'وكشف السيارات يُستخرج بحسب الناقل. حذف سيارة أو نقلها لا يغيّر أي سجل قديم.',
  carriersEmpty: 'لا يوجد ناقلون بعد. أضف أول ناقل من الأسفل.',
  carrierAdd: 'إضافة ناقل',
  carrierName: 'اسم الناقل',
  carrierRename: 'تعديل الاسم',
  carrierDelete: 'حذف الناقل',
  carrierTrucks: (count: number): string =>
    count === 0 ? 'لا سيارات مسجّلة' : count === 1 ? 'سيارة واحدة' : `${String(count)} سيارة`,
  confirmCarrierDeleteTitle: 'حذف ناقل',
  confirmCarrierDeleteBody: (name: string): string =>
    `هل تريد حذف الناقل ${name}؟ الكشوفات القديمة تبقى كما هي.`,
  carrierAdded: 'تم إضافة الناقل.',
  carrierRenamed: 'تم تعديل اسم الناقل.',
  carrierDeleted: 'تم حذف الناقل.',
  truckAdd: 'إضافة سيارة',
  truckCode: 'الترميز',
  truckCodeHint: 'مثل 60 — يُطبع قبل الرقم',
  truckDriverLabel: 'السائق المعتاد',
  truckMoveTo: 'نقل إلى ناقل آخر',
  truckEdit: 'تعديل السيارة',
  truckDelete: 'حذف السيارة',
  confirmTruckDeleteTitle: 'حذف سيارة',
  confirmTruckDeleteBody: (plate: string): string =>
    `هل تريد حذف السيارة ${plate} من سجل الناقل؟ الكشوفات القديمة تبقى كما هي.`,
  truckAdded: 'تم تسجيل السيارة.',
  truckSaved: 'تم حفظ بيانات السيارة.',
  truckMoved: (carrier: string): string => `تم نقل السيارة إلى الناقل ${carrier}.`,
  truckDeleted: 'تم حذف السيارة.',
  unassignedTitle: 'سيارات مرّت على البوابة ولم تُسنَد إلى ناقل',
  unassignedHint:
    'كل سطر رقم سيارة كتبته البوابة ولا يطابق أي سيارة مسجّلة. اختر الناقل ثم اضغط «إسناد» ' +
    'لتسجيلها عنده — وسيظهر اسم السائق الأخير الذي كُتب معها إن وُجد.',
  unassignedEmpty: 'كل السيارات التي مرّت على البوابة مسجّلة عند ناقليها.',
  unassignedTrips: (count: number): string =>
    count === 1 ? 'نقلة واحدة' : `${String(count)} نقلة`,
  assignAction: 'إسناد',
  registeredDriver: (name: string): string => `السائق المسجّل: ${name}`,

  // ---- employees ----
  usersTitle: 'الموظفون',
  usersButton: 'الموظفون',
  usersHint:
    'لكل موظف رمزه وصلاحياته. الرمز محفوظ مشفّراً — وعند نسيانه يُمنح الموظف رمزاً جديداً.',
  usersEmpty: 'لا يوجد موظفون. أضف أول موظف من الأسفل.',
  usersOwnerOnly: 'إدارة الموظفين للمالك وحده، ولا تُفتح لأحد مهما كانت صلاحياته.',
  userName: 'الاسم',
  userPin: 'الرمز السري',
  userNewPin: 'رمز جديد',
  userPinKeep: 'اتركه فارغاً إذا كان الرمز سيبقى كما هو',
  userPinRule: 'من 4 إلى 6 أرقام',
  userAdd: 'إضافة موظف',
  userAdded: 'تمت إضافة الموظف.',
  userSaved: 'تم حفظ التعديلات.',
  userRemove: 'حذف',
  userRemoveTitle: 'حذف موظف',
  userRemoveBody: (name: string): string =>
    `لن يتمكن ${name} من الدخول بعد الآن، ويبقى اسمه على كل كشف عمل عليه.`,
  userRemoved: 'تم حذف الموظف.',
  permissionsNone: 'بلا صلاحيات',
  permissionName: {
    GATE_IN: 'إدخال حاوية',
    MOVE: 'نقل حاوية',
    GATE_OUT: 'إخراج حاوية',
    EDIT: 'تعديل البيانات',
    DELETE: 'حذف سجل',
    REPORTS: 'الكشوفات والسجل',
  } satisfies Record<Permission, string>,

  // ---- first-run setup ----
  setupTitle: 'تهيئة النظام',
  setupOnce:
    'الساحة جاهزة من المخطط الرسمي — ساحة 2 بزوناتها الخمسة، 681 موقعاً أرضياً. ' +
    'المطلوب كلمة سر للمالك فقط.',
  setupPassword: 'كلمة سر الموقع',
  setupPasswordAgain: 'أعد إدخال كلمة السر',
  setupPasswordMismatch: 'كلمتا السر غير متطابقتين.',
  setupPasswordShort: 'كلمة السر يجب أن تكون 6 خانات على الأقل.',
  setupSubmit: 'فتح الساحة',
  setupWorking: 'جارٍ التجهيز…',

  // ---- the map screen ----
  searchPlaceholder: 'ابحث برقم الحاوية أو رقم البوليصة أو الموقع…',
  yardName: (yard: number): string => `ساحة ${String(yard)}`,
  /** How much room is left in a yard: legal landings for each size, right now. */
  freeOfYard: (yard: number, t20: number, t40: number): string =>
    `ساحة ${String(yard)} — المتاح للعشرين: ${String(t20)} · للأربعين: ${String(t40)}`,
  freeTitle: 'المتاح',
  /**
   * The fill calculator. «المتاح» in the header counts SLOTS one could set a
   * container down on this minute; these are the two answers to the question
   * the office actually asks — how many more containers until the yard is
   * full, all twenties or all forties.
   */
  fillTitle: 'كم باقٍ حتى تمتلئ الساحة',
  fillHeight: 'احسب على أساس',
  fillTiers: (n: number): string => (n === 2 ? 'طابقين' : `${String(n)} طوابق`),
  fillHeightHint:
    'هذا افتراض للحساب فقط: الساحة تقبل ثلاثة طوابق كما هي، لكن ليست كل الأماكن ' +
    'تُرصف ثلاثة فعلاً.',
  fillZone: 'الزون',
  fillTwenties: 'عشرين',
  fillForties: 'أربعين',
  fillUsed: 'المشغول',
  fillExplain:
    'العمودان جوابان منفصلان: كم حاوية عشرين تدخل حتى تمتلئ الساحة، أو كم أربعين. ' +
    'الأربعين ليست نصف العشرين: تشغل حيّزين وتحتاج بايين متجاورين حرّين على الستاك ' +
    'نفسه، ولا تقف إلا فوق أربعين — لذلك عددها أقل من نصف العشرينات دائماً.',
  inYardCount: (n: number): string => `${String(n)} حاوية في الساحة`,
  fit: 'ملء الشاشة',
  zoomIn: 'تكبير',
  zoomOut: 'تصغير',
  matches: (n: number): string => (n === 0 ? 'لا توجد نتائج' : `عدد النتائج: ${String(n)}`),
  clearSearch: 'مسح البحث',

  legendFree: 'باي فارغ',
  legendPartial: 'فيه متسع',
  legendFull: 'ممتلئ',
  legendTarget: 'صالح للوضع',
  legendNoted: 'عليه ملاحظة',

  // ---- zones and bays ----
  zoneTitle: (zone: string, yard: number): string => `زون ${zone} · ساحة ${String(yard)}`,
  /** `ستاكات حتى 10 × 3 طوابق` — how this zone's bays are built. */
  zoneBuild: (maxStack: number): string =>
    `ستاكات حتى ${String(maxStack)} × ${String(TIERS.length)} طوابق`,
  /** `مشغول 6 · متاح 10` — the split the owner reads at a glance (TEU). */
  fullAndFree: (full: number, free: number): string =>
    `مشغول ${String(full)} · متاح ${String(free)}`,
  bayHas: (used: number, total: number): string =>
    used === 0 ? 'الباي فارغ' : `مشغول ${String(used)} من ${String(total)}`,
  bayFull: 'ممتلئ',
  tierAName: 'طابق A — الأرضي',
  tierBName: 'طابق B — الثاني',
  tierCName: 'طابق C — الاحتياطي',
  tierShort: (tier: Tier): string => tier,
  stackShort: (stack: number): string => String(stack).padStart(2, '0'),
  /** A stack position the wall swallows — it does not exist on the plan. */
  slotWall: 'جدار',
  slotEmpty: 'فارغ',
  put20Here: 'إدخال حاوية 20 قدم هنا',
  put40With: (otherBay: string): string => `إدخال حاوية 40 قدم بالعرض مع ${otherBay}`,
  moveHere: 'النقل إلى هنا',
  move40With: (otherBay: string): string => `النقل بالعرض مع ${otherBay}`,
  fortySpans: 'حاوية الأربعين تشغل بايين، ويرمز لها بالرقم الزوجي بينهما.',
  noLandingHere: 'لا يمكن الوضع في هذه الخانة. اختر خانة أخرى.',
  size40Chip: '40',
  size20Chip: '20',
  /** «40 قدم» — the container's class, spelt the same everywhere it appears. */
  feet: (size: number): string => `${String(size)} قدم`,

  // ---- gate in ----
  gateInTitle: (size: number): string => `إدخال حاوية ${String(size)} قدم`,
  gateInAt: 'على الموقع',
  containerNumber: 'رقم الحاوية',
  /** The one accepted shape, on the owner's instruction: «4 احرف و7 ارقام». */
  numberForm: 'أربعة أحرف وسبعة أرقام — مثال: MSCU1234566',
  numberOk: 'الرقم مطابق للمواصفة الدولية.',
  numberBad: (digit: number | null): string =>
    digit === null
      ? 'الصيغة المعتمدة أربعة أحرف وسبعة أرقام. سيُحفظ الرقم مع تنبيه.'
      : `الرقم الأخير المتوقع هو ${String(digit)}. سيُحفظ مع تنبيه.`,
  truck: 'رقم السيارة',
  bill: 'رقم البوليصة',
  billHint: 'بوليصة الشحن التابعة لها الحاوية.',
  /** One seal per container, recorded at entry — the exit no longer asks. */
  seal: 'رقم الرصاصة',
  sealHint: 'الرصاصة الموضوعة على باب الحاوية',
  driver: 'اسم السائق',
  /** One weight only, on the owner's call: «الوزن القائم» became «الوزن». */
  weight: 'الوزن بالكغم',
  /**
   * What lifted the container off the truck. Recorded at the gate, printed on
   * the ENTRY CARD alone, and on no register — the owner's instruction.
   */
  handling: 'آلية المناولة',
  handlingHint: 'ما الذي أنزل الحاوية عن السيارة',
  /** The yard's own words for the two machines, on the owner's call. */
  handlingName: { CRANE: 'ونش', STRADDLE: 'عقرب' } as Record<string, string>,
  notes: 'ملاحظات (اختياري)',
  notesHint: 'حالة الحاوية وما يلزم ذكره: انبعاج، قفل مفتوح، حجز جمركي…',
  /**
   * The four fields the gate may leave empty: the notes, the driver's name and
   * the two weights. Everything else is mandatory, on the owner's rule.
   */
  optional: 'اختياري',
  confirmGateIn: 'تأكيد الإدخال',
  gateInDone: (number: string, slot: string): string =>
    `تم إدخال الحاوية ${number} في الموقع ${slot}`,

  // ---- container card ----
  slot: 'الموقع',
  enteredAt: 'تاريخ الدخول',
  exitedAt: 'تاريخ الخروج',
  dwell: (days: number): string =>
    days === 0 ? 'دخلت اليوم' : days === 1 ? 'مضى عليها يوم' : `مضى عليها ${String(days)} يوماً`,
  onTopOf: (number: string): string => `موضوعة فوق الحاوية ${number}`,
  underneath: (number: string): string => `فوقها الحاوية ${number}`,
  numberNotVerified: 'الرقم غير مطابق للمواصفة',
  outOfYard: 'خارج الساحة',
  actionMove: 'نقل',
  actionExit: 'إخراج',
  actionEdit: 'تعديل',
  actionDelete: 'حذف السجل',
  /**
   * The class is fixed for the life of the record — a 40 occupies two slots
   * and a 20 one, so a class corrected after the fact falsifies the ground.
   */
  sizeLockedForever:
    'الفئة لا تُعدَّل بعد التسجيل: الأربعين تشغل حيّزين والعشرين حيّزاً واحداً. ' +
    'إن كانت خطأً فاحذف السجل وأدخل الحاوية من جديد.',
  /** Taking an exit back: the container never left after all. */
  actionUnexit: 'إلغاء الخروج',
  confirmUnexitTitle: 'إلغاء خروج',
  confirmUnexitBody: (number: string, slot: string): string =>
    `هل تريد إلغاء خروج الحاوية ${number}؟ تعود إلى موقعها ${slot} وتُلغى بطاقة ` +
    'خروجها، ويعود رقمها إلى تسلسل السنة. استخدم هذا إذا سُجّل الخروج بالخطأ.',
  unexitDone: (number: string, slot: string): string =>
    `تم إلغاء خروج الحاوية ${number}، وعادت إلى الموقع ${slot}`,
  /** The reprint buttons and the edit stay open after a departure. */
  departedStillEditable: 'الحاوية خارج الساحة — يمكن تصحيح بياناتها أو إلغاء خروجها.',
  movementsTitle: 'الحركات',
  movementIn: 'إدخال',
  movementMove: 'نقل',
  movementDrop: 'نزول طابق',
  /** Gravity names its cause: this box came down when that one left. */
  droppedAfter: (number: string): string => `نزلت بعد خروج ${number}`,
  movementOut: 'إخراج',
  movementEdit: 'تعديل بيانات',
  movementDelete: 'حذف السجل',
  movementRestore: 'استرجاع السجل',
  editedFields: (note: string): string => {
    const names: Record<string, string> = {
      number: 'الرقم',
      bill: 'رقم البوليصة',
      size: 'الفئة',
      notes: 'الملاحظات',
      weight: 'الوزن',
      handling: 'آلية المناولة',
      truckIn: 'سيارة الدخول',
      driverIn: 'سائق الدخول',
      sealIn: 'رصاصة الدخول',
      truckOut: 'سيارة الخروج',
      driverOut: 'سائق الخروج',
      enteredAt: 'تاريخ الدخول',
      exitedAt: 'تاريخ الخروج',
    };
    // Newer notes are JSON {k: keys, b: before-values}; older ones plain CSV.
    let keys: string[];
    try {
      const parsed = JSON.parse(note) as { k?: string[] };
      keys = Array.isArray(parsed.k) ? parsed.k : note.split(',');
    } catch {
      keys = note.split(',');
    }
    const list = keys.map((key) => names[key] ?? key).join('، ');
    return `تم تعديل: ${list}`;
  },
  close: 'إغلاق',
  save: 'حفظ',
  cancel: 'إلغاء',
  /** Section headings inside the edit form, which now covers every field. */
  editEntrySection: 'بيانات الدخول',
  editExitSection: 'بيانات الخروج',
  badDate: 'التاريخ غير صحيح.',
  exitBeforeEntry: 'يجب أن يكون تاريخ الخروج بعد تاريخ الدخول.',

  // ---- moving ----
  movingBanner: (number: string): string =>
    `اختر موقع الحاوية ${number}: اضغط على الباي ثم على الخانة.`,
  movingCancel: 'إلغاء النقل',
  confirmMoveTitle: 'تأكيد النقل',
  confirmMoveBody: (number: string, to: string): string =>
    `هل تريد نقل الحاوية ${number} إلى الموقع ${to}؟`,
  moveDone: (number: string, to: string): string =>
    `تم نقل الحاوية ${number} إلى الموقع ${to}`,

  // ---- exit ----
  confirmExitTitle: 'تسجيل الخروج',
  confirmExitBody: (number: string): string =>
    `هل تريد إخراج الحاوية ${number} من الساحة؟ يُخلى الموقع ويبقى السجل محفوظاً.`,
  exitDone: (number: string): string => `تم إخراج الحاوية ${number} من الساحة`,

  // ---- the printed gate cards ----
  cardInTitle: 'بطاقة دخول',
  cardOutTitle: 'بطاقة خروج',
  cardNumber: 'الرقم',
  cardDay: 'اليوم',
  cardDate: 'التاريخ',
  cardDriver: 'اسم السائق',
  cardTruck: 'رقم السيارة',
  cardSize: 'فئة الحاوية',
  cardWeight: 'الوزن بالكغم',
  /** On the entry card only — never on a register. */
  cardHandling: 'آلية المناولة',
  cardSeal: 'رقم الرصاصة',
  /**
   * Where the container IS, not where it was first set down. A card reprinted
   * after a move has to send the driver to the right stack.
   */
  cardSlot: 'موقع الحاوية',
  cardStoredAt: 'تاريخ تخزين الحاوية',
  cardIssuedAt: 'تاريخ إصدار البطاقة',
  cardNotes: 'ملاحظات',
  /**
   * The receipt line the storage directorate and الحق sign under. The date is
   * left open on the paper so it is filled in by hand at the gate.
   */
  cardStatement:
    'تم استلام وتخزين الحاوية المبينة معلوماتها أدناه في الموقع المخصص ' +
    'بإشراف مندوب مديرية إدارة التخزين وشركة الحق تحت وضع الرصاص الجمركي:',
  cardWorkerSign: 'توقيع موظف مديرية إدارة التخزين',
  cardSupervisorSign: 'توقيع شركة الحق',
  printCardIn: 'طباعة بطاقة دخول',
  printCardOut: 'طباعة بطاقة خروج',

  /**
   * The move card: the paper the crane is handed. Its whole reason is the two
   * slots — «بدي يبين اذا بدي انقل من المكان الموجودة فيه الى المكان الجديد».
   * It is a working paper inside the yard: numbered like the gate cards, and
   * on no register at all.
   */
  cardMoveTitle: 'بطاقة نقل',
  cardMovedAt: 'تاريخ النقل',
  cardFrom: 'من الموقع',
  cardTo: 'إلى الموقع',
  /**
   * Lifting a container brings whatever stood on it down one tier. The card
   * says so, or the crane is holding a paper that describes a stack the yard
   * no longer has.
   */
  cardDrops: 'نزلت بسببها',
  /**
   * Each descent is its own line, and each address its own word: a slot code
   * broken across two lines by the wrap — «…من 2» / «-A-01-08-B إلى» — is not
   * an address any more, which is exactly what one long joined sentence did.
   */
  dropFrom: 'من',
  dropTo: 'إلى',
  printCardMove: 'طباعة بطاقة نقل',
  /** In the operations log, where the same fact is one short sentence. */
  movedDropped: (n: number): string =>
    n === 1 ? 'نزلت بسببها حاوية واحدة' : `نزلت بسببها ${String(n)} حاويات`,

  // ---- reports ----
  reports: 'التقارير',
  backToMap: 'العودة إلى الخريطة',
  reportIn: 'كشف حركة الدخول',
  reportOut: 'كشف حركة الخروج',
  reportDaily: 'كشف التقرير اليومي لحركة الساحة',
  reportStanding: 'كشف الحاويات في الساحة',
  standingNow: 'الوضع الحالي — غير مقيّد بفترة',
  standingCount: (n: number): string => `${String(n)} حاوية في الساحة`,
  rangeFrom: 'من',
  rangeTo: 'إلى',
  print: 'طباعة',
  /** A paginated register still prints whole unless the page alone is asked for. */
  printAll: 'طباعة الكشف كاملاً',
  printPage: 'طباعة الصفحة الحالية',
  colSeq: 'الرقم',
  colStatement: 'البيان',
  colDay: 'اليوم',
  colDate: 'التاريخ',
  colTime: 'الوقت',
  colTruck: 'رقم السيارة',
  colCardIn: 'رقم بطاقة دخول',
  colCardOut: 'رقم بطاقة خروج',
  colNumber: 'رقم الحاوية',
  colWeight: 'الوزن (كغم)',
  colSize: 'فئة الحاوية',
  /**
   * One column, one meaning, on every sheet and on the card: WHERE THE
   * CONTAINER IS. It used to name the slot of the gate moment, so a box
   * carried across the yard was still listed where it had first been set
   * down — «في حال تعديل على مكان الحاوية … لا يتم التعديل عليها». The old
   * slot is not lost: every move is a line in سجل العمليات, from and to.
   */
  colSlot: 'موقع الحاوية',
  colSeal: 'رقم الرصاصة',
  colNotes: 'ملاحظات',
  colUser: 'الموظف',
  /** In كشف سيارة: who drove this trip, for settling with him later. */
  colDriver: 'اسم السائق',
  colEnteredAt: 'تاريخ الدخول',
  colDwell: 'المدة',
  daysCount: (n: number): string =>
    n === 0 ? 'اليوم' : n === 1 ? 'يوم' : n === 2 ? 'يومين' : `${String(n)} يوم`,
  colIn: 'عدد الدخول',
  colOut: 'عدد الخروج',
  colStanding: 'القائم في الساحة',
  statementIn: 'دخول',
  statementOut: 'خروج',
  reportEmpty: 'لا توجد حركات في هذه الفترة.',
  pagePrev: 'السابق',
  pageNext: 'التالي',
  pageOf: (page: number, pages: number): string => `صفحة ${String(page)} من ${String(pages)}`,
  totalRow: 'المجموع',
  movementsCount: (n: number): string => `${String(n)} حركة`,
  /**
   * One box over every register, reading every column: the office does not
   * know which column holds what it is looking for. What the search leaves is
   * what the screen shows, what the printer prints and what the PDF and the
   * Excel file carry — so the paper always says what it was filtered by.
   */
  /**
   * Every heading is a control: press it to order the register by that
   * column. The owner's own words — «ترتيب تصاعدي او تنزالي بس اكبس على
   * العامود الخاص فيهم».
   */
  sortAsc: 'ترتيب تصاعدي',
  sortDesc: 'ترتيب تنازلي',
  /** The third press: the register goes back to its own order. */
  sortClear: 'إلغاء الترتيب',
  sortedBy: (column: string, dir: 'asc' | 'desc'): string =>
    `مرتّب حسب ${column} — ${dir === 'asc' ? 'تصاعدي' : 'تنازلي'}`,
  sheetSearch: 'ابحث في الكشف عن أي معلومة',
  sheetSearchLabel: 'بحث:',
  sheetSearchFound: (shown: number, total: number): string =>
    `${String(shown)} من ${String(total)}`,
  sheetSearchRow: 'نتيجة البحث',
  sheetSearchEmpty: 'لا توجد نتائج مطابقة للبحث في هذا الكشف.',
  exportExcel: 'تصدير Excel',
  exportPdf: 'تصدير PDF',
  pdfWorking: 'جارٍ تجهيز الـ PDF…',
  printedAt: 'تاريخ الطباعة:',
  reportLog: 'سجل العمليات',
  logButton: 'السجل',
  reportTruck: 'كشف سيارة',
  truckPrompt: 'أدخل رقم السيارة أو اختر ناقلاً لعرض جميع الحاويات المنقولة.',
  /** The truck tab's carrier filter: null option = by single plate. */
  carrierFilterAll: 'كل الناقلين — بحسب رقم السيارة',
  reportCarrier: (name: string): string => `كشف سيارات الناقل ${name}`,
  carrierChip: (name: string): string => `الناقل: ${name}`,
  colCarrier: 'الناقل',
  /** «عرض الكل»: the whole register, no period — the owner's own words. */
  showAll: 'عرض الكل',
  rangeAll: 'كامل السجل حتى تاريخه',
  reportBill: 'كشف بوليصة',
  billPrompt: 'أدخل رقم البوليصة لعرض جميع حاوياتها، القائم منها والذي خرج.',
  billOf: (bill: string): string => `بوليصة ${bill}`,
  billNow: 'جميع حاويات البوليصة — غير مقيّد بفترة',
  billTotals: (n: number, t20: number, t40: number): string =>
    `${String(n)} حاوية — ${String(t20)} عشرين · ${String(t40)} أربعين`,
  colBill: 'رقم البوليصة',
  cardBill: 'رقم البوليصة',
  colExitedAt: 'تاريخ الخروج',
  stillStanding: 'في الساحة',
  /** The search's doorway into one bill's own sheet. */
  searchBillRow: (bill: string, count: number): string =>
    `بوليصة ${bill} — ${String(count)} حاوية`,
  searchBillTitle: 'بوالص',
  /** Searching a location code: «2-E-18-01-A» opens the ground it names. */
  searchAddressRow: (count: number): string =>
    count === 0
      ? 'الموقع — فارغ، اضغط للانتقال إليه'
      : count === 1
        ? 'الموقع — فيه حاوية واحدة'
        : `الموقع — فيه ${String(count)} حاويات`,
  colOperation: 'العملية',
  colFrom: 'من',
  colTo: 'إلى',
  colNote: 'ملاحظة',
  deletedRecord: 'سجل محذوف',
  operationName: {
    IN: 'دخول',
    MOVE: 'نقل',
    DROP: 'نزول طابق',
    OUT: 'خروج',
    EDIT: 'تعديل',
    DELETE: 'حذف',
    RESTORE: 'استرجاع',
    RETURN: 'إلغاء خروج',
  } as Record<string, string>,
  actionColumn: 'إجراء',
  cardAction: 'بطاقة',
  restoreAction: 'استرجاع',
  revertAction: 'تراجع',
  restoredDone: 'تم استرجاع السجل.',
  revertedDone: 'تم التراجع عن التعديل.',
  perPage: 'في كل صفحة',

  // ---- owner training tools (temporary, for the training period) ----
  toolsButton: 'أدوات التدريب',
  toolsTitle: 'أدوات التدريب',
  toolsWarning:
    'هذه الأدوات للفترة التجريبية وللمالك وحده. تُحفظ نسخة احتياطية من الوضع ' +
    'الحالي قبل تنفيذ أي عملية منها.',
  systemVersion: 'إصدار النظام المُشغَّل:',
  versionDev: 'نسخة التطوير',
  toolsSeedTitle: 'بيانات تجريبية',
  toolsSeedBody:
    'تعبئة الساحة بحاويات تجريبية بتواريخ وأوقات مختلفة — منها القائم ومنها ما ' +
    'خرج، وفيها بوالص تجمع مجموعات — لعرض النظام على الآخرين.',
  toolsSeedAction: 'تعبئة بيانات تجريبية',
  toolsSeedConfirm: 'ستُضاف حاويات تجريبية إلى الموجود حالياً. هل تريد المتابعة؟',
  toolsSeedDone: (added: number, departed: number, fullBay: string | null): string =>
    `تمت إضافة ${String(added)} حاوية تجريبية، خرجت منها ${String(departed)}.` +
    (fullBay === null ? '' : ` والباي ${fullBay} ممتلئ بالكامل للتجربة.`),
  toolsBackupTitle: 'نسخة احتياطية',
  toolsBackupBody: 'تُحفظ نسخة كاملة على الخادم ويُنزَّل الملف نفسه على جهازك.',
  toolsRestoreTitle: 'استرجاع نسخة احتياطية',
  toolsRestoreBody:
    'اختر ملف نسخة احتياطية (‎.db) لإعادة الساحة إلى حالتها وقت النسخة. ' +
    'تنبيه: يعود كل شيء — الحاويات والحركات والموظفون وكلمات السر كما كانت حينها.',
  toolsPickFile: 'اختيار ملف النسخة',
  toolsNoFile: 'لم يُختر ملف',
  toolsRestoreAction: 'استرجاع النسخة',
  toolsRestoreConfirm: (name: string): string =>
    `سيعود كل شيء من «${name}»: الحاويات والحركات والموظفون وكلمات السر. ` +
    'وستُحفظ نسخة احتياطية من الوضع الحالي قبل ذلك. هل تريد المتابعة؟',
  toolsRestoreDone: (containers: number, users: number): string =>
    `تم الاسترجاع: ${String(containers)} حاوية و${String(users)} موظف.`,
  toolsWipeTitle: 'حذف كل البيانات',
  toolsWipeBody:
    'حذف جميع الحاويات والحركات وإعادة أرقام البطاقات إلى 1. يبقى الموظفون ' +
    'وكلمات السر كما هي.',
  toolsWipeWordSet: 'تعيين كلمة سر الحذف',
  toolsWipeWordChange: 'تغيير كلمة سر الحذف',
  toolsWipeWordHint: 'كلمة مستقلة عن كلمة سر دخولك — 4 خانات على الأقل.',
  toolsWipeWordSaved: 'تم حفظ كلمة سر الحذف.',
  toolsWipeConfirmWord: 'أدخل كلمة سر الحذف للتأكيد',
  toolsWipeAction: 'حذف كل البيانات',
  toolsWipeConfirm:
    'ستُحذف جميع الحاويات والحركات، وستُحفظ نسخة احتياطية من الوضع الحالي قبل ذلك. ' +
    'هل تريد المتابعة؟',
  /**
   * The count comes from the tables after the delete, so the screen states
   * what actually went instead of asserting that something did.
   */
  toolsWipeDone: (containers: number, movements: number): string =>
    containers === 0 && movements === 0
      ? 'لم تكن هناك بيانات لحذفها — الساحة فارغة أصلاً، والموظفون كما هم.'
      : `تم حذف ${String(containers)} حاوية و${String(movements)} حركة. الساحة فارغة الآن، والموظفون كما هم.`,
  /** The delete ran but the yard is not empty — the one answer that is a fault. */
  toolsWipeIncomplete: (left: number): string =>
    `تحذير: بقيت ${String(left)} حاوية بعد الحذف. راجع المطوّر قبل المتابعة.`,

  // ---- backup ----
  backup: 'نسخة احتياطية',
  backupWorking: 'جارٍ تجهيز النسخة…',
  backupDone: 'تم حفظ نسخة على الخادم وتنزيل نسخة على جهازك. احفظها في مكان آمن.',

  // ---- delete ----
  confirmDeleteTitle: 'حذف سجل',
  confirmDeleteBody: (number: string): string =>
    `هل تريد حذف سجل الحاوية ${number}؟ استخدم هذا الخيار فقط إذا كُتب السجل كله بالخطأ.`,
  deleteDone: 'تم حذف السجل.',

  // ---- search results ----
  searchInTitle: 'في الساحة حالياً',
  searchOutTitle: 'خرجت من الساحة',

  // ---- errors ----
  errors: {
    BAD_PASSWORD: 'كلمة السر أو الرمز غير صحيح.',
    UNAUTHORIZED: 'انتهت الجلسة. سجّل الدخول من جديد.',
    FORBIDDEN: 'لا تملك صلاحية هذه العملية. راجع المالك.',
    USER_EXISTS: 'يوجد موظف بالاسم نفسه. اختر اسماً آخر.',
    NOT_SETUP: 'النظام غير مهيّأ بعد.',
    ALREADY_SETUP: 'النظام مهيّأ من قبل. سجّل الدخول مباشرة.',
    VALIDATION: 'توجد بيانات ناقصة أو غير صحيحة. راجع الخانات.',
    NOT_FOUND: 'السجل غير موجود.',
    BAD_SLOT: 'هذه الخانة غير موجودة في المخطط الرسمي، أو الفئة لا تناسب الباي.',
    OCCUPIED: 'الخانة مشغولة.',
    NO_SUPPORT: 'لا توجد حاوية مسنِدة تحتها في الطابق الأدنى.',
    BLOCKED_DESCENT:
      'الحاوية التي فوقها لا تجد موقعاً تنزل إليه. انقلها إلى موقع آخر أولاً.',
    SAME_SLOT: 'هذا هو موقعها الحالي نفسه.',
    NUMBER_IN_YARD: 'هذا الرقم موجود في الساحة حالياً. راجع الأوراق.',
    ALREADY_OUT: 'هذه الحاوية خرجت من الساحة من قبل.',
    NAME_TAKEN: 'الاسم مستخدم. اختر اسماً آخر.',
    NOT_DELETED: 'هذا السجل غير محذوف أصلاً.',
    NOT_EXITED: 'هذه الحاوية واقفة في الساحة ولم تخرج، فلا خروج يُلغى.',
    SIZE_LOCKED:
      'لا تُغيَّر فئة الحاوية بعد تسجيلها: الأربعين تشغل حيّزين والعشرين حيّزاً ' +
      'واحداً. لتصحيحها احذف السجل وأدخل الحاوية من جديد.',
    BAD_BACKUP:
      'الملف ليس نسخة احتياطية صالحة. اختر ملف ‎.db مأخوذاً من زر النسخة الاحتياطية.',
    TRUCK_EXISTS: 'هذه السيارة مسجّلة من قبل بالرقم نفسه. راجع قائمة السيارات.',
    CARRIER_HAS_TRUCKS:
      'لهذا الناقل سيارات مسجّلة. انقل سياراته إلى ناقل آخر أو احذفها أولاً.',
  } satisfies Record<ErrorCode, string>,
  /** The refusals that involve another container name it in the sentence. */
  errorWith: (code: 'BLOCKED_DESCENT' | 'OCCUPIED', other: string): string =>
    code === 'BLOCKED_DESCENT'
      ? `الحاوية ${other} التي فوقها لا تجد موقعاً تنزل إليه. انقل الحاوية ${other} إلى موقع آخر أولاً.`
      : `الخانة مشغولة بالحاوية ${other}.`,
  networkError: 'تعذّر الاتصال بالخادم. تأكد من الاتصال وأعد المحاولة.',
} as const;
