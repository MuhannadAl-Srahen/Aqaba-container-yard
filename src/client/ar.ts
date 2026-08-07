import type { ErrorCode } from '../shared/types';

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
  zone20: 'منطقة 20 قدم',
  zone40: 'منطقة 40 قدم',
  freeOf: (free: number, total: number): string => `فاضي ${String(free)} من ${String(total)}`,
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

  // ---- gate in ----
  gateInTitle: (size: number): string => `إدخال حاوية ${String(size)} قدم`,
  gateInAt: 'على الموقع',
  containerNumber: 'رقم الحاوية',
  numberOk: 'الرقم صح حسب المواصفة.',
  numberBad: (digit: number | null): string =>
    digit === null
      ? 'الرقم مش بالشكل المعروف (4 أحرف و7 أرقام) — رح ينحفظ مع تنبيه.'
      : `الرقم الأخير المتوقع ${String(digit)} — رح ينحفظ مع تنبيه.`,
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
  movementIn: 'إدخال',
  movementMove: 'نقل',
  movementOut: 'إخراج',
  movementEdit: 'تعديل بيانات',
  editedFields: (keys: string): string => {
    const names: Record<string, string> = {
      number: 'الرقم',
      customer: 'العميل',
      cargo: 'الحمولة',
      notes: 'الملاحظات',
    };
    const list = keys
      .split(',')
      .map((key) => names[key] ?? key)
      .join('، ');
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
  confirmExitTitle: 'تأكيد الإخراج',
  confirmExitBody: (number: string): string =>
    `إخراج ${number} من الساحة؟ الموقع بيفضى والسجل بيضل محفوظ.`,
  exitDone: (number: string): string => `طلعت ${number} من الساحة`,

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
    WRONG_ZONE: 'كل مقاس بنصه: 20 بمنطقة الـ20 و40 بمنطقة الـ40.',
    SLOT_TAKEN: 'الموقع مشغول.',
    NO_SUPPORT: 'ما في حاوية تحت — ما بتنحط بالهوا.',
    BURIED: 'في حاوية فوقها — لازم تنشال هي الأول.',
    NUMBER_IN_YARD: 'هذا الرقم موجود بالساحة هلأ. راجع الأوراق.',
    ALREADY_OUT: 'هاي الحاوية طلعت من الساحة أصلًا.',
    SHRINK_OCCUPIED: 'ما بينفع التصغير — في حاويات واقفة برا الحدود الجديدة.',
    SAME_SLOT: 'هذا نفس موقعها الحالي.',
  } satisfies Record<ErrorCode, string>,
  errorWithBy: (code: ErrorCode, by: string): string => {
    if (code === 'SLOT_TAKEN') return `الموقع مشغول — فيه ${by}.`;
    if (code === 'BURIED') return `فوقها الحاوية ${by} — لازم تنشال هي الأول.`;
    return AR.errors[code];
  },
  networkError: 'ما قدرنا نوصل للخادم. تأكد من الإنترنت وجرّب كمان مرة.',
} as const;
