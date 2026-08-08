import type { ContainerStatus, ErrorCode } from '../shared/types';

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
  password: 'كلمة السر',
  enter: 'دخول',
  logout: 'خروج',

  // ---- first-run setup ----
  setupTitle: 'أهلًا! خلينا نجهز ساحتك',
  setupOnce: 'هاي الخطوة مرة وحدة بس. بتقدر تكبّر الساحة بعدين وقت ما بدك.',
  setupPassword: 'كلمة سر للموقع',
  setupPasswordAgain: 'أعدها كمان مرة',
  setupPasswordMismatch: 'الكلمتين مش متطابقتين.',
  setupPasswordShort: 'كلمة السر لازم تكون 6 خانات على الأقل.',
  zone20Title: 'نص حاويات 20 قدم',
  zone40Title: 'نص حاويات 40 قدم',
  rowsLabel: 'عدد الصفوف',
  colsLabel: 'عدد المواقع بكل صف',
  setupPreview: 'هيك رح تبين ساحتك:',
  setupSubmit: 'جهّز الساحة',
  setupWorking: 'جارٍ التجهيز…',

  // ---- the map screen ----
  searchPlaceholder: 'دوّر: رقم حاوية أو اسم عميل…',
  tierGround: 'الأرضي',
  tierUpper: 'الأول',
  tierAll: 'الكل',
  zone20: 'منطقة 20 قدم',
  zone40: 'منطقة 40 قدم',
  freeOf: (free: number, total: number): string => `فاضي ${String(free)} من ${String(total)}`,
  blockNoSize: (size: number): string => `ما بتاخد مقاس ${String(size)}`,
  inYardCount: (n: number): string => `${String(n)} حاوية بالساحة`,
  fit: 'ملء الشاشة',
  zoomIn: 'تكبير',
  zoomOut: 'تصغير',
  matches: (n: number): string => (n === 0 ? 'ما في نتائج' : `النتائج: ${String(n)}`),
  clearSearch: 'مسح البحث',

  legendLaden: 'مليانة',
  legendEmpty: 'فاضية',
  legendStacked: 'فوقها حاوية',
  legendFree: 'موقع فاضي',
  legendTarget: 'موقع مسموح',

  // ---- the yard editor ----
  editYard: 'تعديل الساحة',
  editorHint: 'اسحب المنطقة لتحركها، واختارها لتعدلها. التغيير ما بينحفظ إلا لما تكبس حفظ.',
  editorSave: 'حفظ الساحة',
  editorCancel: 'إلغاء التعديل',
  editorAdd20: 'منطقة 20 جديدة',
  editorAdd40: 'منطقة 40 جديدة',
  editorAddMixed: 'منطقة مختلطة جديدة',
  sizeMixed: 'مختلط',
  sizeMixedBlocked: 'فيها حاويات ما بتناسب هالمقاس.',
  editorName: 'اسم المنطقة',
  editorRows: 'الصفوف',
  editorCols: 'المواقع',
  editorAngle: 'الزاوية',
  editorDelete: 'حذف المنطقة',
  editorDeleteBlocked: 'فيها حاويات — ما بتنحذف.',
  editorOverlap: 'في مناطق راكبة على بعض — زحزحها قبل الحفظ.',
  editorSaved: 'انحفظت الساحة.',
  editorNewName: (n: number): string => `منطقة جديدة ${String(n)}`,

  // ---- the stacked-slot chooser ----
  stackChooserTitle: 'حاويتين بهالموقع — أي وحدة بدك؟',
  stackUpperChoice: 'الفوقانية',
  stackGroundChoice: 'الأرضية (تحت)',
  stackOnTop: 'حط حاوية فوقها',

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
  driver: 'اسم السائق (اختياري)',
  weight: 'وزن الحاوية (اختياري)',
  customer: 'العميل',
  customerHint: 'اكتب الاسم أو اختار من القائمة',
  cargo: 'الحمولة',
  cargoLaden: 'مليانة',
  cargoEmpty: 'فاضية',
  notes: 'ملاحظات (اختياري)',
  confirmGateIn: 'تأكيد الإدخال',
  gateInDone: (number: string, slot: string): string => `دخلت ${number} على ${slot}`,

  // ---- container card ----
  slot: 'الموقع',
  enteredAt: 'دخلت بتاريخ',
  exitedAt: 'طلعت بتاريخ',
  dwell: (days: number): string =>
    days === 0 ? 'دخلت اليوم' : days === 1 ? 'صارلها يوم' : `صارلها ${String(days)} يوم`,
  stackedUnder: (number: string): string => `فوقها الحاوية ${number} — بتنشال هي الأول.`,
  stackedOver: (number: string): string => `واقفة فوق الحاوية ${number}.`,
  numberNotVerified: 'الرقم مش مطابق للمواصفة',
  outOfYard: 'برا الساحة',
  actionMove: 'نقل',
  actionExit: 'إخراج',
  actionEdit: 'تعديل',
  actionDelete: 'سجل غلط؟ احذفه',
  movementsTitle: 'الحركات',
  statusLabel: 'الحالة',
  statusSaved: 'انحفظت الحالة.',
  holdTag: 'حجز',
  containerStatusName: {
    NORMAL: 'عادية',
    DAMAGED: 'معطوبة',
    HOLD: 'محجوزة',
    REPAIR: 'قيد التصليح',
    INSPECT: 'بحاجة معاينة',
  } satisfies Record<ContainerStatus, string>,
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
      cargo: 'الحمولة',
      size: 'المقاس',
      notes: 'الملاحظات',
      status: 'الحالة',
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
  cardSlot: 'الموقع',
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
  colDwell: 'المدة',
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
  devReset: 'تصفير (تطوير)',
  devResetTitle: 'تصفير كامل — للتطوير فقط',
  devResetBody:
    'بيمسح كل الحاويات وكل الحركات وبيرجع أرقام البطاقات من 1. الساحة وكلمة السر بيضلوا. أكيد؟',
  devResetDone: 'انصفّر كل شي.',
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

  // ---- search results (out of yard) ----
  searchOutTitle: 'طلعت من الساحة',

  // ---- errors ----
  errors: {
    BAD_PASSWORD: 'كلمة السر غلط.',
    UNAUTHORIZED: 'انتهت الجلسة — سجّل دخول من جديد.',
    NOT_SETUP: 'الساحة مش مجهزة بعد.',
    ALREADY_SETUP: 'الموقع مجهز من قبل — سجّل دخول عادي.',
    VALIDATION: 'في بيانات ناقصة أو غلط. راجع الخانات.',
    NOT_FOUND: 'السجل مش موجود.',
    OUT_OF_BOUNDS: 'الموقع خارج حدود الساحة.',
    WRONG_ZONE: 'كل مقاس بمنطقته: حاوية 20 بمنطقة 20، وحاوية 40 بمنطقة 40.',
    SLOT_TAKEN: 'الموقع مشغول.',
    NO_SUPPORT: 'ما في حاوية تحت — ما بتنحط بالهوا.',
    BURIED: 'في حاوية فوقها — لازم تنشال هي الأول.',
    NUMBER_IN_YARD: 'هذا الرقم موجود بالساحة هلأ. راجع الأوراق.',
    ALREADY_OUT: 'هاي الحاوية طلعت من الساحة أصلًا.',
    SHRINK_OCCUPIED: 'ما بينفع التصغير — في حاويات واقفة برا الحدود الجديدة.',
    SAME_SLOT: 'هذا نفس موقعها الحالي.',
    BLOCK_OVERLAP: 'في مناطق راكبة على بعض — زحزحها شوي.',
    BLOCK_NOT_EMPTY: 'المنطقة مش فاضية — طلّع حاوياتها قبل ما تحذفها.',
    NAME_TAKEN: 'في منطقة بنفس الاسم — غيّر الاسم.',
    BAD_STACK: 'ما بتنحط حاوية 40 فوق حاوية 20 — بتطيح.',
    NOT_DELETED: 'هذا السجل مش محذوف أصلًا.',
    CONTAINER_HOLD: 'الحاوية محجوزة — ما بتتحرك ولا بتطلع لحد ما ينفك الحجز.',
  } satisfies Record<ErrorCode, string>,
  errorWithBy: (code: ErrorCode, by: string): string => {
    if (code === 'SLOT_TAKEN') return `الموقع مشغول — فيه ${by}.`;
    if (code === 'BURIED') return `فوقها الحاوية ${by} — لازم تنشال هي الأول.`;
    return AR.errors[code];
  },
  networkError: 'ما قدرنا نوصل للخادم. تأكد من الإنترنت وجرّب كمان مرة.',
} as const;
