import type { ErrorCode, Permission } from '../shared/types';

/**
 * Every sentence the user reads, in one file, in the yard's own Jordanian
 * register — the vocabulary the staff already use, not document Arabic.
 * Western digits throughout, by the owner's standing rule.
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
  usersOwnerOnly:
    'تعديل الساحة وإدارة الموظفين والتصفير للمالك بس — ما بينفتحوا لحدا مهما كانت صلاحياته.',
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
  setupTitle: 'أهلًا! خلينا نجهز ساحتك',
  setupOnce: 'هاي الخطوة مرة وحدة بس. بتقدر تكبّر الساحة بعدين وقت ما بدك.',
  setupPassword: 'كلمة سر للموقع',
  setupPasswordAgain: 'أعدها كمان مرة',
  setupPasswordMismatch: 'الكلمتين مش متطابقتين.',
  setupPasswordShort: 'كلمة السر لازم تكون 6 خانات على الأقل.',
  zone20Title: 'عمود حاويات 20 قدم',
  zone40Title: 'عمود حاويات 40 قدم',
  rowsLabel: 'عدد المواقع بالعمود',
  setupPreview: 'هيك رح تبين ساحتك:',
  setupSubmit: 'جهّز الساحة',
  setupWorking: 'جارٍ التجهيز…',

  // ---- the map screen ----
  searchPlaceholder: 'دوّر: رقم حاوية أو اسم عميل…',
  zone20: 'منطقة 20 قدم',
  zone40: 'منطقة 40 قدم',
  /** The yard's remaining room, kept apart by the size that can take it. */
  freeTitle: 'الفاضي بالساحة',
  freeForty: (n: number): string => `40 قدم: ${String(n)}`,
  freeTwenty: (n: number): string => `20 قدم: ${String(n)}`,
  freeMixed: (n: number): string => `مختلط: ${String(n)} مكان`,
  blockNoSize: (size: number): string => `ما بتاخد مقاس ${String(size)}`,
  inYardCount: (n: number): string => `${String(n)} حاوية بالساحة`,
  fit: 'ملء الشاشة',
  zoomIn: 'تكبير',
  zoomOut: 'تصغير',
  matches: (n: number): string => (n === 0 ? 'ما في نتائج' : `النتائج: ${String(n)}`),
  clearSearch: 'مسح البحث',

  legendFree: 'موقع فاضي',
  legendPartial: 'فيه محل',
  legendFull: 'ممتلئ',
  legendTarget: 'موقع مسموح',
  legendNoted: 'فيه ملاحظة',

  // ---- locations ----
  /** `2 حاوية بكل طابق × 2 طابق` — how a column's locations are built. */
  blockShape: (perTier: number, tiers: number, inPlaces: boolean): string =>
    `${String(perTier)} ${inPlaces ? 'مكان' : 'حاوية'} بكل طابق × ${String(tiers)} طابق`,
  /** The same fact short enough to sit inside a panel: `2 طابق × 4 حاوية`. */
  blockBuild: (perTier: number, tiers: number, inPlaces: boolean): string =>
    `${String(tiers)} طابق × ${String(perTier)} ${inPlaces ? 'مكان' : 'حاوية'}`,
  /** What the column takes: the size beside its letter on the map. */
  blockSizeName: (size: number): string => (size === 0 ? 'مختلط' : `${String(size)} قدم`),
  /** `مليان 6 · فاضي 10` — the split the owner reads at a glance. */
  fullAndFree: (full: number, free: number): string =>
    `مليان ${String(full)} · فاضي ${String(free)}`,
  locationHas: (used: number, total: number): string =>
    used === 0 ? 'الموقع فاضي' : `فيه ${String(used)} من ${String(total)}`,
  locationFull: 'ممتلئ',
  locationAdd: 'أدخل حاوية هون',
  locationAddBlocked: 'الموقع ممتلئ — ما في محل.',
  freePlaces: (n: number): string =>
    n === 0 ? 'ما في محل' : n === 1 ? 'باقي مكان واحد' : `باقي ${String(n)} أماكن`,

  // ---- the yard editor ----
  editYard: 'تعديل الساحة',
  editorHint: 'اسحب المنطقة لتحركها، واختارها لتعدلها. التغيير ما بينحفظ إلا لما تكبس حفظ.',
  editorSave: 'حفظ الساحة',
  editorCancel: 'إلغاء التعديل',
  editorAdd20: 'عمود 20 جديد',
  editorAdd40: 'عمود 40 جديد',
  editorAddMixed: 'عمود مختلط جديد',
  sizeMixed: 'مختلط',
  sizeMixedBlocked: 'فيه حاويات ما بتناسب هالمقاس.',
  editorName: 'حرف العمود',
  editorRows: 'المواقع',
  editorTiers: 'الطوابق',
  /** The capacity stepper, worded in the column's own language. */
  editorCapacity: (size: number): string =>
    size === 0 ? 'أماكن 20 بكل طابق' : `حاويات ${String(size)} بكل طابق`,
  editorCapacityLocked: 'في مواقع فيها أكتر من هيك — فضيها قبل ما تصغّر.',
  editorAngle: 'الزاوية',
  editorDelete: 'حذف العمود',
  editorDeleteBlocked: 'فيه حاويات — ما بينحذف.',
  editorOverlap: 'في أعمدة راكبة على بعض — زحزحها قبل الحفظ.',
  editorSaved: 'انحفظت الساحة.',
  editorNewName: (n: number): string => `عمود ${String(n)}`,

  // ---- gate in ----
  gateInTitle: (size: number): string => `إدخال حاوية ${String(size)} قدم`,
  gateInTitleMixed: 'إدخال حاوية',
  gateInAt: 'على الموقع',
  containerNumber: 'رقم الحاوية',
  numberOk: 'الرقم صح حسب المواصفة.',
  numberLocal: 'رقم بصيغة الساحة (4 أحرف و4 أرقام).',
  numberBad: (digit: number | null): string =>
    digit === null
      ? 'الرقم مش بصيغة الساحة (4 أحرف و4 أرقام) ولا الدولية — رح ينحفظ مع تنبيه.'
      : `الرقم الأخير المتوقع ${String(digit)} — رح ينحفظ مع تنبيه.`,
  truck: 'رقم السيارة',
  seal: 'رقم الرصاصة',
  sealOut: 'رصاصة الخروج',
  sealHint: 'الرصاصة اللي على باب الحاوية',
  sealWas: (seal: string): string => `دخلت برصاصة ${seal}`,
  sealChanged: 'الرصاصة تغيّرت',
  driver: 'اسم السائق (اختياري)',
  weight: 'وزن الحاوية (اختياري)',
  customer: 'العميل',
  customerHint: 'اكتب الاسم أو اختار من القائمة',
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
  sharingLocation: (n: number): string =>
    n === 1 ? 'معها حاوية ثانية بنفس الموقع.' : `معها ${String(n)} حاويات بنفس الموقع.`,
  addToLocation: 'أدخل حاوية بنفس الموقع',
  numberNotVerified: 'الرقم مش مطابق للمواصفة',
  outOfYard: 'برا الساحة',
  actionMove: 'نقل',
  actionExit: 'إخراج',
  actionEdit: 'تعديل',
  actionDelete: 'سجل غلط؟ احذفه',
  movementsTitle: 'الحركات',
  movementIn: 'إدخال',
  movementMove: 'نقل',
  movementOut: 'إخراج',
  movementEdit: 'تعديل بيانات',
  movementDelete: 'حذف السجل',
  movementRestore: 'استرجاع السجل',
  editedFields: (note: string): string => {
    const names: Record<string, string> = {
      number: 'الرقم',
      customer: 'العميل',
      size: 'المقاس',
      notes: 'الملاحظات',
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

  // ---- moving ----
  movingBanner: (number: string): string => `وين بدك تنقل ${number}؟ اكبس على موقع أخضر.`,
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
  cardSize: 'نوع الحاوية',
  cardCompany: 'اسم الشركة',
  cardWeight: 'وزن',
  cardSeal: 'رقم الرصاصة',
  cardSlot: 'الموقع',
  cardNotes: 'ملاحظات',
  cardWorkerSign: 'توقيع العامل',
  cardSupervisorSign: 'توقيع المشرف',
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
  colWeight: 'وزن الحاوية',
  colSize: 'نوع الحاوية',
  colSlot: 'موقع الحاوية',
  colCompany: 'اسم الشركة',
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
  colOperation: 'العملية',
  colFrom: 'من',
  colTo: 'إلى',
  colNote: 'ملاحظة',
  deletedRecord: 'سجل محذوف',
  operationName: {
    IN: 'دخول',
    MOVE: 'نقل',
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
    NOT_SETUP: 'الساحة مش مجهزة بعد.',
    ALREADY_SETUP: 'الموقع مجهز من قبل — سجّل دخول عادي.',
    VALIDATION: 'في بيانات ناقصة أو غلط. راجع الخانات.',
    NOT_FOUND: 'السجل مش موجود.',
    OUT_OF_BOUNDS: 'الموقع خارج حدود الساحة.',
    WRONG_ZONE: 'كل مقاس بمنطقته: حاوية 20 بمنطقة 20، وحاوية 40 بمنطقة 40.',
    LOCATION_FULL: 'الموقع ممتلئ — ما في محل.',
    NUMBER_IN_YARD: 'هذا الرقم موجود بالساحة هلأ. راجع الأوراق.',
    ALREADY_OUT: 'هاي الحاوية طلعت من الساحة أصلًا.',
    SHRINK_OCCUPIED: 'ما بينفع التصغير — في حاويات واقفة برا الحدود الجديدة.',
    CAPACITY_OCCUPIED: 'ما بينفع تصغير السعة — في مواقع فيها أكتر من هيك.',
    SAME_SLOT: 'هذا نفس موقعها الحالي.',
    BLOCK_OVERLAP: 'في أعمدة راكبة على بعض — زحزحها شوي.',
    BLOCK_NOT_EMPTY: 'العمود مش فاضي — طلّع حاوياته قبل ما تحذفه.',
    NAME_TAKEN: 'في عمود بنفس الاسم — غيّر الاسم.',
    NOT_DELETED: 'هذا السجل مش محذوف أصلًا.',
  } satisfies Record<ErrorCode, string>,
  /** LOCATION_FULL says exactly how short the location is. */
  errorFull: (free: number, need: number): string =>
    free === 0
      ? 'الموقع ممتلئ — ما في محل.'
      : `الموقع ما فيه غير ${String(free)} مكان، والحاوية بدها ${String(need)}.`,
  networkError: 'ما قدرنا نوصل للخادم. تأكد من الإنترنت وجرّب كمان مرة.',
} as const;
