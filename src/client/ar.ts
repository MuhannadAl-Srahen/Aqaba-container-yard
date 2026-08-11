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
    'الساحة جاهزة من المخطط الرسمي — ساحة 1 وساحة 2، 681 موقعاً أرضياً. ' +
    'المطلوب كلمة سر للمالك فقط.',
  setupPassword: 'كلمة سر الموقع',
  setupPasswordAgain: 'أعد إدخال كلمة السر',
  setupPasswordMismatch: 'كلمتا السر غير متطابقتين.',
  setupPasswordShort: 'كلمة السر يجب أن تكون 6 خانات على الأقل.',
  setupSubmit: 'فتح الساحة',
  setupWorking: 'جارٍ التجهيز…',

  // ---- the map screen ----
  searchPlaceholder: 'ابحث برقم الحاوية أو البوليصة أو اسم المالك…',
  yardName: (yard: number): string => `ساحة ${String(yard)}`,
  /** How much room is left per yard: legal landings for each size, right now. */
  freeOfYard: (yard: number, t20: number, t40: number): string =>
    `ساحة ${String(yard)} — متاح للعشرين: ${String(t20)} · للأربعين: ${String(t40)}`,
  freeTitle: 'المتاح',
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
  legendHazmat: 'فيه مواد خطرة',

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
  numberOk: 'الرقم مطابق للمواصفة الدولية.',
  numberLocal: 'رقم بصيغة الساحة (4 أحرف و4 أرقام).',
  numberBad: (digit: number | null): string =>
    digit === null
      ? 'الرقم لا يطابق صيغة الساحة (4 أحرف و4 أرقام) ولا المواصفة الدولية. سيُحفظ مع تنبيه.'
      : `الرقم الأخير المتوقع هو ${String(digit)}. سيُحفظ مع تنبيه.`,
  truck: 'رقم السيارة',
  bill: 'رقم البوليصة',
  billHint: 'اختياري — بوليصة الشحن التابعة لها الحاوية. اتركه فارغاً إن لم توجد.',
  seal: 'رقم الرصاصة',
  sealOut: 'رصاصة الخروج',
  sealHint: 'الرصاصة الموضوعة على باب الحاوية',
  sealWas: (seal: string): string => `دخلت برصاصة ${seal}`,
  sealChanged: 'الرصاصة مختلفة عن رصاصة الدخول',
  driver: 'اسم السائق (اختياري)',
  weightGross: 'الوزن القائم بالكغم',
  weightNet: 'الوزن الصافي بالكغم',
  hazmat: 'مواد خطرة',
  hazmatHint: 'حدّد الخيار إذا كانت الحاوية تحمل مواد خطرة',
  hazmatYes: 'نعم — مواد خطرة',
  hazmatNo: 'لا — بضاعة عادية',
  hazmatWarning: 'تنبيه: هذه الحاوية تحمل مواد خطرة.',
  hazmatShort: 'خطرة',
  customer: 'اسم المالك',
  customerHint: 'مالك الحاوية — أدخل الاسم أو اختره من القائمة',
  notes: 'ملاحظات',
  notesHint: 'حالة الحاوية وكل ما يلزم ذكره: انبعاج، قفل مفتوح، حجز جمركي…',
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
  sizeLockedStanding:
    'لا تتغير الفئة والحاوية في موقعها — الباي الفردي للعشرين والزوجي للأربعين. ' +
    'انقلها أو أخرجها أولاً.',
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
  cardCompany: 'اسم المالك',
  cardWeightGross: 'الوزن القائم بالكغم',
  cardWeightNet: 'الوزن الصافي بالكغم',
  cardSeal: 'رقم الرصاصة',
  cardSlot: 'موقع الحاوية',
  cardStoredAt: 'تاريخ تخزين الحاوية',
  cardIssuedAt: 'تاريخ إصدار البطاقة',
  cardHazmat: 'مواد خطرة',
  cardNotes: 'ملاحظات',
  /**
   * The receipt line the storage directorate and الحق sign under. The date is
   * left open on the paper so it is filled in by hand at the gate.
   */
  cardStatementBefore: 'تم بتاريخ',
  cardStatementAfter:
    'استلام وتخزين الحاوية المبينة معلوماتها أدناه في الموقع المخصص ' +
    'بإشراف مندوب مديرية إدارة التخزين وشركة الحق تحت وضع الرصاص الجمركي:',
  cardWorkerSign: 'توقيع موظف مديرية إدارة التخزين',
  cardSupervisorSign: 'توقيع شركة الحق',
  printCardIn: 'طباعة بطاقة دخول',
  printCardOut: 'طباعة بطاقة خروج',

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
  colStanding: 'القائم في الساحة',
  statementIn: 'دخول',
  statementOut: 'خروج',
  reportEmpty: 'لا توجد حركات في هذه الفترة.',
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
  truckPrompt: 'أدخل رقم السيارة لعرض جميع الحاويات التي نقلتها.',
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
  restoredDone: 'تم استرجاع السجل.',
  revertedDone: 'تم التراجع عن التعديل.',
  perPage: 'في كل صفحة',

  // ---- owner training tools (temporary, for the training period) ----
  toolsButton: 'أدوات التدريب',
  toolsTitle: 'أدوات التدريب',
  toolsWarning:
    'هذه الأدوات للفترة التجريبية وللمالك وحده. تُحفظ نسخة احتياطية من الوضع ' +
    'الحالي قبل تنفيذ أي عملية منها.',
  toolsSeedTitle: 'بيانات تجريبية',
  toolsSeedBody:
    'تعبئة الساحة بحاويات تجريبية بتواريخ وأوقات مختلفة — منها القائم ومنها ما ' +
    'خرج، وفيها بوالص ومواد خطرة — لعرض النظام على الآخرين.',
  toolsSeedAction: 'تعبئة بيانات تجريبية',
  toolsSeedConfirm: 'ستُضاف حاويات تجريبية إلى الموجود حالياً. هل تريد المتابعة؟',
  toolsSeedDone: (added: number, departed: number): string =>
    `تمت إضافة ${String(added)} حاوية تجريبية، خرجت منها ${String(departed)}.`,
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
  toolsWipeDone: 'تم حذف البيانات، والموظفون كما هم.',

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
    BAD_BACKUP:
      'الملف ليس نسخة احتياطية صالحة. اختر ملف ‎.db مأخوذاً من زر النسخة الاحتياطية.',
  } satisfies Record<ErrorCode, string>,
  /** The refusals that involve another container name it in the sentence. */
  errorWith: (code: 'BLOCKED_DESCENT' | 'OCCUPIED', other: string): string =>
    code === 'BLOCKED_DESCENT'
      ? `الحاوية ${other} التي فوقها لا تجد موقعاً تنزل إليه. انقل الحاوية ${other} إلى موقع آخر أولاً.`
      : `الخانة مشغولة بالحاوية ${other}.`,
  networkError: 'تعذّر الاتصال بالخادم. تأكد من الاتصال وأعد المحاولة.',
} as const;
