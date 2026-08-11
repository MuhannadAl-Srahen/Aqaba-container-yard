import type { ErrorCode, Permission, Tier } from '../shared/types';
import { TIERS } from '../shared/types';

/**
 * Every sentence the user reads, in one file, in the yard's own Jordanian
 * register — the vocabulary the staff already use, not document Arabic.
 * Western digits throughout, by the owner's standing rule.
 *
 * The place words are the official plan's own: يارد، زون، باي، ستاك، طابق —
 * and the full code reads `1-A-03-01-A`.
 */

export const AR = {
  appName: 'ساحة العقبة',

  // ---- boot / auth ----
  loading: 'لحظة…',
  loginTitle: 'تسجيل الدخول',
  loginHint: 'اكتب كلمة سر الموقع',
  loginWho: 'مين بدو يفوت؟',
  loginPinFor: (name: string): string => `أهلًا ${name} — اكتب رمزك`,
  loginAsOwner: 'دخول المالك',
  loginBack: 'رجوع لقائمة الأسماء',
  password: 'كلمة السر',
  pin: 'الرمز السري',
  enter: 'دخول',
  logout: 'خروج',

  // ---- theme ----
  themeLabel: 'الإضاءة',
  themeLight: 'فاتح',
  themeDark: 'غامق',
  themeSystem: 'حسب الجهاز',

  // ---- employees ----
  usersTitle: 'الموظفين',
  usersButton: 'الموظفين',
  usersHint: 'كل موظف إله رمزه وصلاحياته. الرمز محفوظ مشفّر — إذا نساه بتعطيه رمز جديد.',
  usersEmpty: 'ما في موظفين بعد — ضيف أول واحد من تحت.',
  usersOwnerOnly: 'إدارة الموظفين للمالك بس — ما بتنفتح لحدا مهما كانت صلاحياته.',
  userName: 'الاسم',
  userPin: 'الرمز السري',
  userNewPin: 'رمز جديد',
  userPinKeep: 'اتركه فاضي إذا الرمز بيضل متل ما هو',
  userPinRule: 'من 4 لـ 6 أرقام',
  userAdd: 'ضيف موظف',
  userAdded: 'انضاف الموظف.',
  userSaved: 'انحفظت التعديلات.',
  userRemove: 'شيله',
  userRemoveTitle: 'شيل موظف',
  userRemoveBody: (name: string): string =>
    `${name} ما رح يقدر يفوت بعد هلأ. اسمه بيضل على كل كشف اشتغل عليه.`,
  userRemoved: 'انشال الموظف.',
  permissionsNone: 'ما إله صلاحيات',
  permissionName: {
    GATE_IN: 'إدخال حاوية',
    MOVE: 'نقل حاوية',
    GATE_OUT: 'إخراج حاوية',
    EDIT: 'تعديل البيانات',
    DELETE: 'حذف سجل',
    REPORTS: 'الكشوفات والسجل',
  } satisfies Record<Permission, string>,

  // ---- first-run setup ----
  setupTitle: 'أهلًا! كلمة سر وخلصنا',
  setupOnce:
    'الساحة نفسها جاهزة من المخطط الرسمي — ساحة 1 وساحة 2، 681 مكان أرضي. ' +
    'كل اللي بدنا ياه كلمة سر للمالك.',
  setupPassword: 'كلمة سر للموقع',
  setupPasswordAgain: 'أعدها كمان مرة',
  setupPasswordMismatch: 'الكلمتين مش متطابقتين.',
  setupPasswordShort: 'كلمة السر لازم تكون 6 خانات على الأقل.',
  setupSubmit: 'افتح الساحة',
  setupWorking: 'جارٍ التجهيز…',

  // ---- the map screen ----
  searchPlaceholder: 'دوّر: رقم حاوية، بوليصة، أو اسم المالك…',
  yardName: (yard: number): string => `ساحة ${String(yard)}`,
  /** «قديش باقي» per yard: legal landings for each size, right now. */
  freeOfYard: (yard: number, t20: number, t40: number): string =>
    `ساحة ${String(yard)} — فاضي لعشرين: ${String(t20)} · لأربعين: ${String(t40)}`,
  freeTitle: 'الفاضي',
  inYardCount: (n: number): string => `${String(n)} حاوية بالساحة`,
  fit: 'ملء الشاشة',
  zoomIn: 'تكبير',
  zoomOut: 'تصغير',
  matches: (n: number): string => (n === 0 ? 'ما في نتائج' : `النتائج: ${String(n)}`),
  clearSearch: 'مسح البحث',

  legendFree: 'باي فاضي',
  legendPartial: 'فيه محل',
  legendFull: 'ممتلئ',
  legendTarget: 'بينفع تنحط فيه',
  legendNoted: 'فيه ملاحظة',
  legendHazmat: 'فيه مواد خطرة',

  // ---- zones and bays ----
  zoneTitle: (zone: string, yard: number): string => `زون ${zone} · ساحة ${String(yard)}`,
  /** `ستاكات لحد 10 × 3 طوابق` — how this zone's bays are built. */
  zoneBuild: (maxStack: number): string =>
    `ستاكات لحد ${String(maxStack)} × ${String(TIERS.length)} طوابق`,
  /** `مليان 6 · فاضي 10` — the split the owner reads at a glance (TEU). */
  fullAndFree: (full: number, free: number): string =>
    `مليان ${String(full)} · فاضي ${String(free)}`,
  bayHas: (used: number, total: number): string =>
    used === 0 ? 'الباي فاضي' : `فيه ${String(used)} من ${String(total)}`,
  bayFull: 'ممتلئ',
  tierAName: 'طابق A — الأرض',
  tierBName: 'طابق B — فوقه',
  tierCName: 'طابق C — الاحتياط',
  tierShort: (tier: Tier): string => tier,
  stackShort: (stack: number): string => String(stack).padStart(2, '0'),
  /** A stack position the wall swallows — it does not exist on the plan. */
  slotWall: 'حيط',
  slotEmpty: 'فاضي',
  put20Here: 'حط 20 هون',
  put40With: (otherBay: string): string => `حط 40 بالعرض مع ${otherBay}`,
  moveHere: 'انقلها لهون',
  move40With: (otherBay: string): string => `انقلها بالعرض مع ${otherBay}`,
  fortySpans: 'الأربعين بتاخد البايين — بتنرمز بالرقم الزوجي بيناتهم.',
  noLandingHere: 'ما بينفع تنحط بهالخانة — شوف خانة ثانية.',
  size40Chip: '40',
  size20Chip: '20',

  // ---- gate in ----
  gateInTitle: (size: number): string => `إدخال حاوية ${String(size)} قدم`,
  gateInAt: 'على الموقع',
  containerNumber: 'رقم الحاوية',
  numberOk: 'الرقم صح حسب المواصفة.',
  numberLocal: 'رقم بصيغة الساحة (4 أحرف و4 أرقام).',
  numberBad: (digit: number | null): string =>
    digit === null
      ? 'الرقم مش بصيغة الساحة (4 أحرف و4 أرقام) ولا الدولية — رح ينحفظ مع تنبيه.'
      : `الرقم الأخير المتوقع ${String(digit)} — رح ينحفظ مع تنبيه.`,
  truck: 'رقم السيارة',
  bill: 'رقم البوليصة',
  billHint: 'اختياري — بوليصة الشحن اللي الحاوية تابعة إلها. إذا ما في، اتركها فاضية.',
  seal: 'رقم الرصاصة',
  sealOut: 'رصاصة الخروج',
  sealHint: 'الرصاصة اللي على باب الحاوية',
  sealWas: (seal: string): string => `دخلت برصاصة ${seal}`,
  sealChanged: 'الرصاصة تغيّرت',
  driver: 'اسم السائق (اختياري)',
  weightGross: 'الوزن القائم بالكغم',
  weightNet: 'الوزن الصافي بالكغم',
  hazmat: 'مواد خطرة',
  hazmatHint: 'علّم عليها إذا كانت الحاوية تحمل مواد خطرة',
  hazmatYes: 'نعم — مواد خطرة',
  hazmatNo: 'لا — بضاعة عادية',
  hazmatWarning: 'تحذير: هذه الحاوية تحمل مواد خطرة.',
  hazmatShort: 'خطرة',
  customer: 'اسم المالك',
  customerHint: 'صاحب الحاوية — اكتب الاسم أو اختار من القائمة',
  notes: 'ملاحظات',
  notesHint: 'حالة الحاوية وأي إشي لازم ينذكر: مبعوجة، قفلها مفتوح، عليها حجز…',
  confirmGateIn: 'تأكيد الإدخال',
  gateInDone: (number: string, slot: string): string => `دخلت ${number} على ${slot}`,

  // ---- container card ----
  slot: 'الموقع',
  enteredAt: 'دخلت بتاريخ',
  exitedAt: 'طلعت بتاريخ',
  dwell: (days: number): string =>
    days === 0 ? 'دخلت اليوم' : days === 1 ? 'صارلها يوم' : `صارلها ${String(days)} يوم`,
  onTopOf: (number: string): string => `واقفة فوق ${number}`,
  underneath: (number: string): string => `فوقها ${number} — بدها تنزل قبلها`,
  numberNotVerified: 'الرقم مش مطابق للمواصفة',
  outOfYard: 'برا الساحة',
  actionMove: 'نقل',
  actionExit: 'إخراج',
  actionEdit: 'تعديل',
  actionDelete: 'سجل غلط؟ احذفه',
  sizeLockedStanding:
    'المقاس ما بيتغير وهي واقفة — الفردي للعشرين والزوجي للأربعين. طلعها أو انقلها قبل.',
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
      customer: 'اسم المالك',
      bill: 'رقم البوليصة',
      size: 'الفئة',
      notes: 'الملاحظات',
      weight: 'الوزن القائم',
      weightNet: 'الوزن الصافي',
      hazmat: 'المواد الخطرة',
      truckIn: 'سيارة الدخول',
      driverIn: 'سائق الدخول',
      sealIn: 'رصاصة الدخول',
      truckOut: 'سيارة الخروج',
      driverOut: 'سائق الخروج',
      sealOut: 'رصاصة الخروج',
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
    return `تعدّل: ${list}`;
  },
  close: 'إغلاق',
  save: 'حفظ',
  cancel: 'إلغاء',
  /** Section headings inside the edit form, which now covers every field. */
  editEntrySection: 'بيانات الدخول',
  editExitSection: 'بيانات الخروج',
  badDate: 'التاريخ غير صحيح.',
  exitBeforeEntry: 'تاريخ الخروج لازم يكون بعد تاريخ الدخول.',

  // ---- moving ----
  movingBanner: (number: string): string => `وين بدك تحط ${number}؟ اكبس على الباي واختار الخانة.`,
  movingCancel: 'إلغاء النقل',
  confirmMoveTitle: 'تأكيد النقل',
  confirmMoveBody: (number: string, to: string): string => `نقل ${number} إلى ${to}؟`,
  moveDone: (number: string, to: string): string => `انتقلت ${number} إلى ${to}`,

  // ---- exit ----
  confirmExitTitle: 'تسجيل الخروج',
  confirmExitBody: (number: string): string =>
    `إخراج ${number} من الساحة؟ الموقع بيفضى والسجل بيضل محفوظ.`,
  exitDone: (number: string): string => `طلعت ${number} من الساحة`,

  // ---- the printed gate cards ----
  cardInTitle: 'بطاقة دخول',
  cardOutTitle: 'بطاقة خروج',
  cardNumber: 'الرقم',
  cardDay: 'اليوم',
  cardDate: 'التاريخ',
  cardDriver: 'اسم السائق',
  cardTruck: 'رقم السيارة',
  cardSize: 'فئة الحاوية',
  cardCompany: 'اسم المالك',
  cardWeightGross: 'الوزن القائم بالكغم',
  cardWeightNet: 'الوزن الصافي بالكغم',
  cardSeal: 'رقم الرصاصة',
  cardSlot: 'موقع الحاوية',
  cardStoredAt: 'تاريخ تخزين الحاوية',
  cardHazmat: 'مواد خطرة',
  cardNotes: 'ملاحظات',
  /**
   * The receipt line the storage directorate and الحق sign under. The date is
   * left open on the paper so it is filled in by hand at the gate.
   */
  cardStatement:
    'تم بتاريخ     /     /       استلام وتخزين الحاوية المبينة معلوماتها أدناه ' +
    'في الموقع المخصص بإشراف مندوب مديرية إدارة التخزين وشركة الحق ' +
    'تحت وضع الرصاص الجمركي:',
  cardWorkerSign: 'توقيع موظف مديرية إدارة التخزين',
  cardSupervisorSign: 'توقيع شركة الحق',
  printCardIn: 'طباعة بطاقة دخول',
  printCardOut: 'طباعة بطاقة خروج',

  // ---- reports ----
  reports: 'التقارير',
  backToMap: 'رجوع للخريطة',
  reportIn: 'كشف حركة الدخول',
  reportOut: 'كشف حركة الخروج',
  reportDaily: 'كشف التقرير اليومي لحركة الساحة',
  reportStanding: 'كشف الحاويات بالساحة',
  standingNow: 'الوضع هلأ — مش مربوط بفترة',
  standingCount: (n: number): string => `${String(n)} حاوية واقفة`,
  rangeFrom: 'من',
  rangeTo: 'إلى',
  print: 'طباعة',
  colSeq: 'الرقم',
  colStatement: 'البيان',
  colDay: 'اليوم',
  colDate: 'التاريخ',
  colTime: 'الوقت',
  colTruck: 'رقم السيارة',
  colCardIn: 'رقم بطاقة دخول',
  colCardOut: 'رقم بطاقة خروج',
  colNumber: 'رقم الحاوية',
  colWeight: 'الوزن القائم (كغم)',
  colWeightNet: 'الوزن الصافي (كغم)',
  colHazmat: 'مواد خطرة',
  colSize: 'فئة الحاوية',
  colSlot: 'موقع الحاوية',
  /**
   * A gate register records the slot of the gate MOMENT; the standing sheet
   * records where the container is now. Since a box can descend a tier when
   * a neighbour leaves, the two can differ — so each column says which it is.
   */
  colSlotIn: 'الموقع عند الدخول',
  colSlotOut: 'الموقع عند الخروج',
  colSlotNow: 'الموقع الحالي',
  colCompany: 'اسم المالك',
  colSeal: 'رقم الرصاصة',
  colNotes: 'ملاحظات',
  colUser: 'الموظف',
  colEnteredAt: 'تاريخ الدخول',
  colDwell: 'المدة',
  daysCount: (n: number): string =>
    n === 0 ? 'اليوم' : n === 1 ? 'يوم' : n === 2 ? 'يومين' : `${String(n)} يوم`,
  colIn: 'عدد الدخول',
  colOut: 'عدد الخروج',
  colStanding: 'الساحة',
  statementIn: 'دخول',
  statementOut: 'خروج',
  reportEmpty: 'ما في حركات بهالفترة.',
  pagePrev: 'السابق',
  pageNext: 'التالي',
  pageOf: (page: number, pages: number): string => `صفحة ${String(page)} من ${String(pages)}`,
  totalRow: 'المجموع',
  movementsCount: (n: number): string => `${String(n)} حركة`,
  exportExcel: 'تصدير Excel',
  exportPdf: 'تصدير PDF',
  pdfWorking: 'جارٍ تجهيز الـ PDF…',
  printedAt: 'تاريخ الطباعة:',
  reportLog: 'سجل العمليات',
  logButton: 'السجل',
  reportTruck: 'كشف سيارة',
  truckPrompt: 'اكتب رقم السيارة وبيطلعلك كل اللي نقلته.',
  reportBill: 'كشف بوليصة',
  billPrompt: 'اكتب رقم البوليصة وبيطلعلك كل حاوياتها — الواقف والطالع.',
  billOf: (bill: string): string => `بوليصة ${bill}`,
  billNow: 'كل حاويات البوليصة — مش مربوط بفترة',
  billTotals: (n: number, t20: number, t40: number): string =>
    `${String(n)} حاوية — ${String(t20)} عشرين · ${String(t40)} أربعين`,
  colBill: 'رقم البوليصة',
  cardBill: 'رقم البوليصة',
  colExitedAt: 'تاريخ الخروج',
  stillStanding: 'بالساحة',
  /** The search's doorway into one bill's own sheet. */
  searchBillRow: (bill: string, count: number): string =>
    `بوليصة ${bill} — ${String(count)} حاوية`,
  searchBillTitle: 'بوالص',
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
  } as Record<string, string>,
  actionColumn: 'إجراء',
  cardAction: 'بطاقة',
  restoreAction: 'استرجاع',
  revertAction: 'تراجع',
  restoredDone: 'رجع السجل.',
  revertedDone: 'انرجع التعديل.',
  perPage: 'بكل صفحة',

  // ---- backup ----
  backup: 'نسخة احتياطية',
  backupWorking: 'جارٍ تجهيز النسخة…',
  backupDone: 'انحفظت نسخة عند السيرفر وانتنزلت عليك — خزّنها بمكان أمين.',

  // ---- delete ----
  confirmDeleteTitle: 'حذف سجل غلط',
  confirmDeleteBody: (number: string): string =>
    `حذف سجل ${number}؟ استخدمه بس إذا السجل كله انكتب بالغلط.`,
  deleteDone: 'انحذف السجل.',

  // ---- search results ----
  searchInTitle: 'بالساحة هلأ',
  searchOutTitle: 'طلعت من الساحة',

  // ---- errors ----
  errors: {
    BAD_PASSWORD: 'كلمة السر أو الرمز غلط.',
    UNAUTHORIZED: 'انتهت الجلسة — سجّل دخول من جديد.',
    FORBIDDEN: 'ما إلك صلاحية على هالعملية — راجع المالك.',
    USER_EXISTS: 'في موظف بنفس الاسم — غيّر الاسم.',
    NOT_SETUP: 'الموقع مش مجهز بعد.',
    ALREADY_SETUP: 'الموقع مجهز من قبل — سجّل دخول عادي.',
    VALIDATION: 'في بيانات ناقصة أو غلط. راجع الخانات.',
    NOT_FOUND: 'السجل مش موجود.',
    BAD_SLOT: 'هالخانة مش موجودة بالمخطط — حيط، أو مقاس على باي غلط.',
    OCCUPIED: 'الخانة مشغولة.',
    NO_SUPPORT: 'ما في أرضية تحتها — الطابق الثاني بدو حاوية تحته من نفس المقاس.',
    BLOCKED_DESCENT:
      'الحاوية اللي فوقها ما بتلاقي مكان تنزل عليه — لازم تنقلها لموقع ثاني قبل.',
    SAME_SLOT: 'هذا نفس مكانها الحالي.',
    NUMBER_IN_YARD: 'هذا الرقم موجود بالساحة هلأ. راجع الأوراق.',
    ALREADY_OUT: 'هاي الحاوية طلعت من الساحة أصلًا.',
    NAME_TAKEN: 'الاسم مستخدم — غيّره.',
    NOT_DELETED: 'هذا السجل مش محذوف أصلًا.',
  } satisfies Record<ErrorCode, string>,
  /** The refusals that involve another container name it in the sentence. */
  errorWith: (code: 'BLOCKED_DESCENT' | 'OCCUPIED', other: string): string =>
    code === 'BLOCKED_DESCENT'
      ? `الحاوية ${other} اللي فوقها ما بتلاقي مكان تنزل عليه — انقل ${other} لموقع ثاني قبل.`
      : `الخانة مشغولة — واقفة فيها ${other}.`,
  networkError: 'ما قدرنا نوصل للخادم. تأكد من الإنترنت وجرّب كمان مرة.',
} as const;
