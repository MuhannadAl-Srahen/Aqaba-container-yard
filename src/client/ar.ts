import type {
  BatchRowStatus,
  ErrorCode,
  Handling,
  Permission,
  Size,
  TaskCloseNote,
  TaskKind,
  TaskStatus,
  Tier,
} from '../shared/types';
import { TIERS } from '../shared/types';
import type { SheetWarning } from '../shared/customsSheet';
import { ltrCode } from '../shared/bidi';

/**
 * Every sentence the user reads, in one file, in clear formal Arabic — on the
 * owner's instruction: «عربية رسمية واضحة». Formal, not stiff: the imperative
 * for what the user should do, «تم …» for what the system did, a full sentence
 * for every refusal that names the cause and then the remedy. Western digits
 * throughout, by the owner's standing rule.
 *
 * The place words stay the official plan's own: يارد، زون، باي، ستاك، طابق —
 * and the full code reads `1-A-03-01-A`.
 *
 * Any Latin code inside these sentences is wrapped with `ltrCode()` from
 * src/shared/bidi.ts, or it is read backwards. See that file for the
 * measurement that proved it.
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

  // ---- تصريح تحميل وخروج داخلي ----
  /** The company line the permit paper opens with — the owner's own words. */
  permitOrg: 'مؤسسة الحق',
  permitTitle: (yard: number): string =>
    `تصريح تحميل وخروج داخلي من الساحة (${String(yard)})`,
  permitSentence: (yard: number): string =>
    `يسمح بتحميل وإخراج الحاويات المبينة أدناه من ساحة رقم (${String(yard)}) ` +
    'إلى داخل موقع المقص فقط.',
  permitSerial: 'الرقم التسلسلي',
  permitDate: 'التاريخ',
  permitBill: 'رقم البوليصة',
  colEntryCard: 'رقم سند بطاقة الإدخال',
  colPermitTruck: 'رقم السيارة',
  permitSignature: 'توقيع وختم موظف مديرية التخزين',
  reportPermits: 'كشف خروج وتحميل داخلي',
  colPermitCount: 'عدد الحاويات',
  permitAction: 'التصريح',
  permitCreate: 'إصدار تصريح تحميل وخروج',
  permitCreateHint:
    'اختر الحاويات التي سيشملها التصريح، واكتب رقم السيارة التي ستُخرج كل واحدة — ' +
    'أو اترك الرقم فارغاً ليُكتب على الورقة يدوياً. الحاوية التي خرجت من البوابة ' +
    'تظهر هنا أيضاً ومعها سيارة خروجها.',
  permitNoContainers: 'لا توجد حاويات على هذه البوليصة.',
  /** Chip on a permit line whose container already left through the gate. */
  permitExited: 'خرجت',
  permitIssue: 'إصدار التصريح',
  permitDone: (serial: string): string => `تم إصدار التصريح رقم ${serial}.`,
  printPermit: 'طباعة التصريح',
  permitDelete: 'حذف التصريح',
  confirmPermitDeleteTitle: 'حذف تصريح',
  confirmPermitDeleteBody: (serial: string): string =>
    `هل تريد حذف التصريح رقم ${serial}؟ يبقى رقمه محجوزاً له فلا يأخذه تصريح آخر.`,
  permitDeleted: 'تم حذف التصريح.',
  permitsCount: (count: number): string => `عدد التصاريح: ${String(count)}`,

  // ---- الزونات والساحات ----
  zonesButton: 'الساحات',
  zonesTitle: 'الزونات والساحات',
  zonesHint:
    'عرّف زونات ساحاتك الأخرى هنا: رقم الساحة، حرف الزون، وعدد البايات والستاكات — ' +
    'والطوابق ثلاثة دائماً. المخطط الرسمي للساحة 2 ثابت لا يُعدَّل. ' +
    'الخانة التي تغلقها تمنع وضع الحاويات فيها كما تفعل حوائط الساحة 2.',
  zonesOfficialNote: 'الساحة 2 — المخطط الرسمي: زونات A حتى E ثابتة كما في المخطط المعتمد.',
  zonesEmpty: 'لم تعرّف أي زون بعد. أضف أول زون من الأسفل.',
  zonesLoadFailed: 'تعذّر تحميل الساحات المعرّفة، فقد تنقص الخريطة ساحات المالك.',
  zonesRetry: 'أعد المحاولة',
  zoneAdd: 'إضافة زون',
  zoneYard: 'رقم الساحة',
  zoneYardHint: 'رقم الساحة كما يُكتب في أول العنوان — 1 أو 3 مثلاً.',
  zoneName: 'حرف الزون',
  zoneNameHint: 'حرف لاتيني كبير (مثل F) لا يتكرر في كل الساحات.',
  zoneBays: 'عدد البايات',
  zoneBaysHint: 'بايات العشرينات: 1، 3، 5 … والأربعين تنام على بايين متجاورين.',
  zoneStacks: 'عدد الستاكات',
  zoneCreate: 'إنشاء الزون',
  zoneCreated: 'تم إنشاء الزون. اضغط أي خانة لإغلاقها ثم احفظ الشكل.',
  zoneSaved: 'تم حفظ شكل الزون.',
  zoneSave: 'حفظ الشكل',
  zoneDelete: 'حذف الزون',
  confirmZoneDeleteTitle: 'حذف زون',
  confirmZoneDeleteBody: (name: string): string =>
    `هل تريد حذف الزون ${name}؟ لا يُحذف زون فيه حاويات واقفة، وسجلات الحاويات القديمة تبقى كما هي.`,
  zoneDeleted: 'تم حذف الزون.',
  zoneClosedHint:
    'اضغط أي خانة لإغلاقها أو فتحها — الخانة المغلقة (المخططة) تمنع الوضع فيها — ثم احفظ الشكل.',
  zoneOpenSlots: (n: number): string => `${String(n)} خانة أرضية مفتوحة`,
  zoneMove: 'موقع الزون على المخطط:',
  zoneMoveAuto: 'ترتيب تلقائي',
  zoneMoveStart: 'تحريك إلى جهة البداية',
  zoneMoveEnd: 'تحريك إلى جهة النهاية',
  zoneMoveUp: 'تحريك إلى الأعلى',
  zoneMoveDown: 'تحريك إلى الأسفل',
  zoneMoved: 'تم تحريك الزون. افتح الخريطة لترى موقعه.',
  zoneDragHint: 'اسحب من هذا الشريط لتحريك الزون على المخطط',
  zoneTiersNote: 'كل خانة أرضية فوقها ثلاثة طوابق: A على الأرض ثم B ثم C.',
  zoneBayWord: 'باي',
  zoneStackWord: 'ستاك',
  zoneLabel: (yard: number, name: string): string => `الزون ${name} — ساحة ${String(yard)}`,
  yardTab: (yard: number): string => `ساحة ${String(yard)}`,

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
    `هل تريد حذف السيارة ${ltrCode(plate)} من سجل الناقل؟ الكشوفات القديمة تبقى كما هي.`,
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
    ACCOUNTING: 'محاسبة السائقين',
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
  searchPlaceholder: 'ابحث برقم الحاوية أو البوليصة أو الرصاصة أو الموقع…',
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
    'والحساب على قاعدة البلوك: الباي الذي فيه عشرين يُكمَل عشرينات، والباي الذي ' +
    'تحته أربعين يُكمَل أربعينات، والأرض الفارغة تُحسب لكل عمود على فئته. ' +
    'الأربعين ليست نصف العشرين: تشغل حيّزين وتحتاج بايين متجاورين حرّين على الستاك ' +
    'نفسه، ولا تقف إلا فوق أربعين.',
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
  legendBill: 'فيه نفس البوليصة',
  /** وضع تلوين البوالص — «تلون الخريطة بناءا على عدد البوليصات». */
  paintByFill: 'الامتلاء',
  paintByBills: 'البوالص',
  /** عرض المحتويات — «تعرض ما داخل البلوك دون ما اكبس على البلوك». */
  paintByDetail: 'المحتويات',
  legendBox20: 'حاوية 20 قدم',
  legendBox40: 'حاوية 40 قدم',
  legendSlotFree: 'خانة فارغة',
  legendBand1: 'بوليصة فوق 10',
  legendBand2: 'بوليصة 6–10',
  legendBand3: 'بوليصة 2–5',
  legendBand4: 'فردية',

  // ---- البوليصة تحكم الرصف — الإخراج يتم بالبوليصة دفعة واحدة ----
  /** Under the moving banner: where the bill already stands, so the crane aims there. */
  billStandsAt: (bill: string, places: string): string =>
    `بوليصتها ${ltrCode(bill)} واقفة في: ${places}`,
  /** One stop on that line: «2-B-13 (4)». */
  billPlace: (label: string, count: number): string => `${ltrCode(label)} (${String(count)})`,
  /**
   * The scatter warning, on the confirm and beside the gate-in form. A
   * warning only — the crane still goes where the yard needs it: «بنحاول
   * الي فيه بوليصة عدد كبير بنحطهم بمكان واحد لانو بنخرجها دفعة وحده».
   */
  billFarWarning: (bill: string, places: string): string =>
    `تنبيه: حاويات البوليصة ${ltrCode(bill)} واقفة في ${places} والموقع المختار بعيد عنها، ` +
    'والإخراج يتم بالبوليصة دفعة واحدة.',
  /** The bill search row's second line: where the group stands. */
  billSpreadOne: (zone: string, count: number): string =>
    `كلها في زون ${zone} (${String(count)})`,
  billSpreadMany: (places: string): string => `متفرقة: ${places}`,
  billSpreadStop: (zone: string, count: number): string => `زون ${zone}: ${String(count)}`,
  billSpreadNone: 'لا شيء منها واقف في الساحة',
  /** Under the gate-in form's bill box: beside the group, or away from it. */
  billNearHint: (places: string): string =>
    `حاويات هذه البوليصة واقفة في: ${places} — الموقع المختار بجانبها.`,
  billFarHint: (places: string): string =>
    `حاويات هذه البوليصة واقفة في: ${places} — الموقع المختار بعيد عنها، والإخراج يتم ` +
    'بالبوليصة دفعة واحدة.',

  // ---- الطباعة الكلية للبطاقات — للمالك وحده ----
  /** «بدي طريقة اطبع جميع بطاقات الدخول مره واحدة مهما كان عددها». */
  bulkCardsPlain: 'كل البطاقات (PDF)',
  bulkCardsNoPhotos: 'كل البطاقات بلا صور (PDF)',
  bulkCardsWithPhotos: 'كل البطاقات مع الصور (PDF)',
  bulkCardsMove: 'كل بطاقات النقل (PDF)',
  bulkCardsWorking: 'جارٍ تجهيز ملف البطاقات — قد يستغرق دقيقة لكشف طويل…',
  bulkCardsNone: 'لا توجد بطاقات في هذه الفترة.',
  bulkCardsDone: (count: number): string =>
    `تم تجهيز الملف وفيه ${String(count)} بطاقة، صفحة لكل بطاقة وبترتيب رقمها.`,
  bulkCardsTitle: (kind: 'in' | 'out' | 'move', period: string): string =>
    `${kind === 'in' ? 'بطاقات الدخول' : kind === 'out' ? 'بطاقات الخروج' : 'بطاقات النقل'} ${period}`,
  bulkCardsPeriod: (from: string, to: string): string =>
    `من ${ltrCode(from)} إلى ${ltrCode(to)}`,
  bulkCardsAllPeriod: 'كامل السجل',

  // ---- النقل الجماعي — «بدي انقل كمية من الحاويات مره وحده» ----
  selectForMove: 'تحديد للنقل',
  selectAllBay: 'تحديد الكل',
  selectCancel: 'إلغاء التحديد',
  moveSelected: (count: number): string => `نقل المحدد (${String(count)})`,
  groupBanner: (count: number): string =>
    `نقل جماعي لعدد ${String(count)}: اضغط باي الوجهة على الخريطة.`,
  confirmGroupTitle: 'تأكيد النقل الجماعي',
  confirmGroupBody: (count: number, label: string): string =>
    `هل تريد نقل ${String(count)} من الحاويات إلى ${ltrCode(label)}؟ تُرفع الأعلى أولاً ` +
    'وتُرصف في الوجهة من الأرض فصاعداً، ستاكاً ستاكاً، ولكل واحدة بطاقة نقل برقمها.',
  groupMoveDone: (count: number): string =>
    `تم النقل الجماعي لعدد ${String(count)} من الحاويات، وبطاقات النقل بأرقامها في سجل العمليات.`,
  groupBuried: (other: string): string =>
    `لا يمكن النقل الجماعي: الحاوية ${ltrCode(other)} واقفة فوق إحدى المحددات وليست ضمن ` +
    'التحديد. أنزلها أولاً أو أضفها إلى التحديد.',
  groupNoRoom: (fit: number, total: number): string =>
    `باي الوجهة لا يتسع للمجموعة كلها: يتسع ${String(fit)} من ${String(total)}. اختر باياً ` +
    'آخر أو قلّل التحديد.',

  // ---- طابور النقل — «اذا ضغطت على حاوية ثانية بحط الاولى والثانية» ----
  moveQueued: (number: string, waiting: number): string =>
    `تمت إضافة الحاوية ${ltrCode(number)} إلى النقل، وستُنقل بعد الحالية` +
    (waiting > 1 ? ` (في الانتظار ${String(waiting)})` : '') +
    '.',
  moveAlreadyQueued: (number: string): string =>
    `الحاوية ${ltrCode(number)} قيد النقل أصلاً.`,
  moveQueueLine: (count: number, names: string): string =>
    `وبانتظار النقل ${String(count)}: ${names}`,
  moveQueueNext: (number: string): string =>
    `والآن اختر مكان الحاوية ${ltrCode(number)}.`,

  // ---- zones and bays ----
  zoneTitle: (zone: string, yard: number): string => `زون ${zone} · ساحة ${String(yard)}`,
  /** `ستاكات حتى 10 × 3 طوابق` — how this zone's bays are built. */
  zoneBuild: (maxStack: number): string =>
    `ستاكات حتى ${String(maxStack)} × ${String(TIERS.length)} طوابق`,
  /**
   * `مشغول 6 · متاح 10` — the split the owner reads at a glance, in
   * twenty-foot slots (a forty counts as the two it fills). A boxes-first
   * header and paired cells were tried and the owner chose this original
   * reading back: «return to the same as the old one».
   */
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
  /**
   * Why a picked EMPTY slot takes no forty: the cell looks free on this
   * bay's sheet, but a forty needs a partner cell at the neighbouring odd
   * bay, and that cell lives on ANOTHER sheet — invisible from here. The
   * owner hit exactly this: «رغم انها اربعين قدم الا انه يعطيني انه لا
   * يمكن نقلها» over a green «فارغ». Every refusal names its cause.
   */
  noLanding40Occupied: (even: string, partnerCell: string, other: string): string =>
    `عبر الباي ${even}: الخانة الشريكة ${ltrCode(partnerCell)} مشغولة بالحاوية ${ltrCode(other)}.`,
  noLanding40NoSupport: (even: string): string =>
    `عبر الباي ${even}: لا يوجد سند كامل تحت الأربعين في هذا الطابق.`,
  noLanding40NoGround: (even: string, partnerBay: string): string =>
    `عبر الباي ${even}: المخطط لا يعطي هذا الستاك عند الباي ${partnerBay}.`,
  noLanding20NoSupport: 'لا يوجد سند تحت هذه الخانة — الطابق الذي تحتها فارغ.',
  /** While a container is being placed, the slots that accept it glow. */
  landingHint: 'الخانات التي تقبل هذه الحاوية مضيئة بالأخضر.',
  landingNoneInBay: 'لا توجد في هذا الباي خانة تقبل هذه الحاوية.',
  /** السحب والإفلات داخل ورقة الباي — «ضليت ماسك حاوية وامشي فيها براحتي». */
  dragHint:
    'اضغط مطولاً على حاوية واسحبها: إلى خانة تقبلها، أو فوق حاوية لتقف عليها، ' +
    'أو خارج الورقة إلى أي باي على الخريطة.',
  dropHere: 'أفلت هنا',
  /** مقترحات المكان — the yard's own habits, worn darker. Advice, not a bar. */
  slotSuggested: 'مقترَح',
  suggestedCellTitle:
    'خانة مقترحة: الفردية عند الفرديات، والحاوية قرب بوليصتها، والطابق الثالث للخفيفة في وجه الرصة.',
  suggestionHint: 'والأغمق منها مقترَح بحسب البوليصة والوزن.',
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
    `تم إدخال الحاوية ${ltrCode(number)} في الموقع ${ltrCode(slot)}`,

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
    `هل تريد إلغاء خروج الحاوية ${ltrCode(number)}؟ تعود إلى موقعها ${ltrCode(slot)} وتُلغى بطاقة ` +
    'خروجها، ويبقى رقمها محجوزاً لها فلا تأخذه حاوية أخرى. استخدم هذا إذا سُجّل ' +
    'الخروج بالخطأ.',
  unexitDone: (number: string, slot: string): string =>
    `تم إلغاء خروج الحاوية ${ltrCode(number)}، وعادت إلى الموقع ${ltrCode(slot)}`,
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
      moveTo: 'وجهة النقلة',
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

  // ---- مهام الآليات — بديل قروب الواتساب ----
  tasksButton: 'مهام الآليات',
  myTasksButton: 'المهام',
  /** أسماء الآليتين معرفةً؛ handlingName أعلاه يبقى مجرداً للبطاقات. */
  machineName: { CRANE: 'الونش', STRADDLE: 'العقرب' } satisfies Record<Handling, string>,
  machineNone: 'بلا آلية',
  userMachine: 'الآلية',
  userMachineHint: 'حساب سائق آلية يفتح على شاشة مهامه ويبقى داخلاً طوال الوردية.',
  tasksScreenTitle: (machine: string): string => `مهام ${machine}`,
  taskKindName: { IN: 'إدخال', OUT: 'تجهيز إخراج' } satisfies Record<TaskKind, string>,
  taskStatusName: { PENDING: 'معلّقة', DONE: 'منجزة' } satisfies Record<TaskStatus, string>,
  taskUrgentChip: 'مستعجل',
  taskMakeUrgent: 'مستعجل',
  taskClearUrgent: 'إلغاء الاستعجال',
  taskDoneAction: 'تم',
  taskDoneTitle: 'إنهاء المهمة',
  taskDoneBody: (number: string): string => `هل أُنجزت مهمة الحاوية ${ltrCode(number)}؟`,
  taskDoneToast: 'تم إنهاء المهمة.',
  taskUrgentToast: 'تم تحديث ترتيب المهمة.',
  taskShowSlot: 'عرض الموقع',
  /** «اظهار بطاقة الدخول عند المهام»: الورقة نفسها التي كانت تُصوَّر. */
  taskEntryCard: 'بطاقة الدخول',
  taskOutCard: 'البطاقة',
  /** «يطلعهم اشعار داخل التطبيق انو اجاه امر بالحاوية مشان ينتبه». */
  taskArrived: (count: number): string =>
    count === 1 ? 'وصل أمر جديد بحاوية.' : `وصلت ${String(count)} أوامر جديدة بحاويات.`,
  taskOpenQueue: 'فتح المهام',
  taskPendingTitle: 'المهام الحالية',
  taskDoneTodayTitle: 'المنجزة اليوم',
  taskEmpty: 'لا مهام حالياً.',
  taskCreatedBy: (name: string): string => `أرسلها ${name}`,
  taskDoneBy: (name: string): string => `أنهاها ${name}`,
  taskRerouteAction: 'تحويل إلى الآلية الأخرى',
  taskRerouteTitle: 'تحويل المهمة',
  taskRerouteBody: (number: string, machine: string): string =>
    `تحوّل مهمة الحاوية ${ltrCode(number)} إلى ${machine}. إن كانت مهمة إدخال ` +
    'تُصحَّح آلية المناولة في سجل الحاوية أيضاً.',
  taskRerouted: 'تم تحويل المهمة.',
  taskClosedNote: {
    AUTO_EXIT: 'أُغلقت بتسجيل الخروج',
    AUTO_RETURN: 'أُغلقت بإلغاء الخروج',
    AUTO_DELETE: 'أُغلقت بحذف السجل',
  } satisfies Record<TaskCloseNote, string>,
  prepareAction: 'تجهيز للإخراج',
  prepareTitle: 'إرسال مهمة تجهيز',
  prepareMachineLabel: 'إلى أي آلية؟',
  prepareByHandling: 'حسب آلية كل حاوية',
  prepareSent: 'أُرسلت مهمة التجهيز.',
  prepareBillAction: 'تجهيز البوليصة كاملة',
  prepareBillSent: (created: number, skipped: number): string =>
    skipped === 0
      ? `عدد مهام التجهيز المرسلة: ${String(created)}.`
      : `عدد المهام المرسلة: ${String(created)}، ولدى ${String(skipped)} منها مهمة معلّقة من قبل.`,
  tasksCount: (n: number): string => `عدد المهام: ${String(n)}`,
  taskTruckLine: (truck: string): string => `سيارة الخروج: ${ltrCode(truck)}`,

  // ---- دفعات كشف الجمارك — الكشف يُقرأ حرفياً أو لا يُقرأ ----
  batchesButton: 'الدفعات',
  batchesTitle: 'دفعات كشف الجمارك',
  batchesHint:
    'ارفع كشف الدفعة كما وصل (إكسل أو وورد أو ملف نصي) فيُقرأ حرفاً بحرف ويصير ' +
    'سجلاً حياً: ترى ما وصل وما بقي، وعند تسجيل دخول حاوية مذكورة فيه تُعبّأ ' +
    'الفئة والبوليصة من الكشف نفسه فلا يُعاد كتابة شيء باليد.',
  batchesEmpty: 'لا دفعات مرفوعة بعد.',
  batchUpload: 'رفع كشف دفعة',
  batchPickHint: 'الصيغ المقبولة: إكسل (xlsx) أو وورد (docx) أو نصي (csv).',
  batchName: 'اسم الدفعة',
  batchReviewTitle: 'مراجعة الكشف قبل الاعتماد',
  batchReviewHint:
    'قورن المجاميع أدناه بالورقة نفسها قبل الاعتماد. الأسطر المظللة تحمل ' +
    'ملاحظة تحتها — وهي تنبيه لا منع: يُسجَّل ما كتبه الكشف كما هو.',
  batchTotalsLine: (rows: number, of20: number, of40: number, other: number, bills: number): string =>
    `عدد الحاويات: ${String(rows)} — ${String(of40)} × أربعين و${String(of20)} × عشرين` +
    (other > 0 ? ` و${String(other)} بفئة أخرى` : '') +
    `، على ${String(bills)} بوليصة.`,
  batchApprove: 'اعتماد الدفعة',
  batchApproveBody: (name: string, rows: number): string =>
    `تُحفظ «${name}» بواقع ${String(rows)} حاوية كما قرأها الكشف، ويبدأ تتبع وصولها.`,
  batchApproved: (name: string): string => `تم اعتماد الدفعة «${name}».`,
  batchCreatedBy: (name: string): string => `رفعها ${name}`,
  batchArrivedOf: (arrived: number, total: number): string =>
    `وصل ${String(arrived)} من ${String(total)}`,
  batchDone: 'اكتملت',
  batchReceiveRow: 'تسجيل دخولها',
  /** الشريط المسلّح: الخريطة تبقى الباب — يُنقر الباي وتُختار الخانة كالمعتاد. */
  batchDraftBanner: (number: string): string =>
    `تسجيل دخول ${ltrCode(number)} — انقر الباي واختر الخانة كالمعتاد.`,
  batchDraftSize: (size: Size): string =>
    size === 40 ? 'فئتها 40 قدماً: اختر باياً زوجياً.' : 'فئتها 20 قدماً: اختر باياً فردياً.',
  batchDraftSizeUnknown: (raw: string): string =>
    `الكشف يكتب فئتها «${raw}» وهي خارج فئات الساحة — اختر الخانة على مسؤولية العين.`,
  /** تلميح نموذج الإدخال حين يطابق الرقم دفعة مفتوحة. */
  batchHint: (name: string): string => `مسجّلة في «${name}» — عُبّئت البوليصة من الكشف.`,
  batchSizeMismatch: (batchSize: Size, baySize: Size): string =>
    `الكشف يسجّلها فئة ${String(batchSize)} وهذه الخانة لفئة ${String(baySize)}. ` +
    'تأكد من الرقم أو اختر خانة تناسب فئتها.',
  batchDeleteAction: 'حذف الدفعة',
  confirmBatchDeleteTitle: 'حذف الدفعة',
  confirmBatchDeleteBody: (name: string): string =>
    `تُحذف «${name}» من سجل الدفعات ولا يتغير أي شيء في سجل الحاويات نفسه.`,
  batchDeleted: 'تم حذف الدفعة.',
  colSheetSeq: 'م',
  colLineOp: 'الخط الملاحي',
  colBatchStatus: 'الحالة',
  batchStatusName: {
    PENDING: 'لم تصل',
    STANDING: 'واصلة',
    EXITED: 'خرجت',
  } satisfies Record<BatchRowStatus, string>,
  /** تنبيهات القراءة — تنبيه لا منع، والكشف يُسجَّل كما كُتب. */
  sheetWarningName: {
    NUMBER_MALFORMED:
      'الرقم ليس على الصيغة المعتمدة (4 أحرف و7 أرقام) — سيُسجَّل كما كتبه الكشف.',
    NUMBER_CHECK: 'رقم التحقق العالمي لا يطابق — غالباً خطأ كتابة في الكشف نفسه. راجعه مع الورقة.',
    SIZE_UNKNOWN: 'الفئة ليست 20 ولا 40 — تُحفظ كما كُتبت ولا تُعبّأ تلقائياً.',
    BILL_MISSING: 'بلا رقم بوليصة في الكشف.',
    DUPLICATE_NUMBER: 'الرقم مكرر داخل هذا الكشف.',
    SEQ_GAP: 'التسلسل غير متصل قبل هذا السطر — تأكد أن الكشف كامل.',
  } satisfies Record<SheetWarning, string>,

  // ---- driver accounting ----
  driversButton: 'حساب السائقين',
  driversTitle: 'كشف حساب السائقين',
  driversHint:
    'كل نقلة بند مستقل: دخول الحاوية نقلة وخروجها نقلة أخرى ولو تكررت السيارة. ' +
    'اكتب أجر النقلة، وعندما يقبض السائق أكّد الاستلام. والنقلة التي لم يُكتب ' +
    'اسم سائقها تُدرج تحت رقم سيارتها، فلا تسقط نقلة من الحساب.',
  driversEmpty: 'لا نقلات في هذه الفترة.',
  /** دمج الأسماء المكررة: «حماد عودة» بثلاث صيغ = ثلاثة أسطر حتى تُدمج. */
  mergeTitle: 'دمج أسماء السائقين المكررة',
  mergeHint:
    'الاسم الواحد المكتوب بأكثر من صيغة يوزّع نقلات صاحبه على أكثر من سطر. ' +
    'اختر الصيغة الصحيحة ثم علّم الصيغ المكررة، فتُصحَّح في كل السجل وبطاقات السيارات.',
  mergeKeepLabel: 'الاسم الصحيح',
  mergeDropLabel: 'الصيغ المكررة التي ستُدمج فيه',
  mergeAction: 'دمج الأسماء',
  mergeConfirmTitle: 'دمج أسماء السائقين',
  mergeConfirmBody: (keep: string, count: number): string =>
    `تُستبدل ${String(count)} صيغة بالاسم «${keep}» في كل سجل الحاويات وبطاقات السيارات. ` +
    'هذا تصحيح إملائي شامل ولا يمكن فكّه إلا يدوياً.',
  mergeDone: (hauls: number, trucks: number): string =>
    trucks === 0
      ? `تم الدمج: صُحّح الاسم في ${String(hauls)} نقلة.`
      : `تم الدمج: صُحّح الاسم في ${String(hauls)} نقلة وفي ${String(trucks)} سيارة مسجلة.`,
  /** «ضعها تحت نفس رقم السيارة»: نقلة بلا اسم سائق تُنسب إلى لوحتها. */
  driverByTruck: (truck: string): string => `سيارة ${ltrCode(truck)} — بلا اسم سائق`,
  /** الصيغة داخل الجملة، حيث لا يستقيم عنوان المجموعة. */
  driverOfTruck: (truck: string): string => `سائق السيارة ${ltrCode(truck)}`,
  /** عنوان مجموعة السيارة حين يُعرف سائقها، أو حين تعدّد سائقوها في الفترة. */
  truckWithDriver: (truck: string, driver: string): string =>
    `سيارة ${ltrCode(truck)} — ${driver}`,
  truckManyDrivers: (truck: string, count: number): string =>
    count === 2
      ? `سيارة ${ltrCode(truck)} — سائقان`
      : `سيارة ${ltrCode(truck)} — ${String(count)} سائقين`,
  groupByDriver: 'حسب السائق',
  groupByTruck: 'حسب السيارة',
  driverUnknown: 'بلا اسم سائق ولا رقم سيارة',
  driverBlankWarning: 'بلا اسم سائق تُدرج النقلة تحت رقم السيارة في حساب السائقين. اكتب الاسم إن عرفته.',
  wageCleared: 'تم مسح أجر النقلة.',
  driversSearch: 'ابحث باسم السائق أو رقم السيارة…',
  driversNoMatch: 'لا نقلة تطابق البحث أو المرشحات في هذه الفترة.',
  dateFuture: 'هذا الوقت لم يأتِ بعد. اختر وقتاً مضى.',
  filterAll: 'الكل',
  /**
   * حين يرفض الخادم حقلاً بعينه، تُسمّى الخانة بدل الجملة العامة — «بقول
   * المعلومات غير كاملة او غير صحيحة» وهي لا تقول أيّها.
   */
  fieldName: {
    number: 'رقم الحاوية',
    bill: 'رقم البوليصة',
    size: 'فئة الحاوية',
    notes: 'الملاحظات',
    weight: 'الوزن',
    handling: 'آلية المناولة',
    truckIn: 'رقم سيارة الدخول',
    driverIn: 'اسم سائق الدخول',
    sealIn: 'رقم الرصاصة',
    truckOut: 'رقم سيارة الخروج',
    driverOut: 'اسم سائق الخروج',
    enteredAt: 'تاريخ الدخول',
    exitedAt: 'تاريخ الخروج',
    truck: 'رقم السيارة',
    driver: 'اسم السائق',
    seal: 'رقم الرصاصة',
    position: 'موقع الحاوية',
    amount: 'الأجر',
    machine: 'الآلية',
    status: 'حالة المهمة',
  } as Record<string, string | undefined>,
  validationField: (label: string): string =>
    `القيمة المكتوبة في «${label}» غير مقبولة: إمّا فارغة وهي لازمة، أو أطول مما يقبله الحقل. راجعها ثم أعد الحفظ.`,
  paidFilterYes: 'استلموا حسابهم',
  paidFilterNo: 'لم يستلموا',
  doubtTruck: `الرقم على غير النمط المعتاد (مثل ${ltrCode('60-12345')}). تأكد منه قبل المتابعة.`,
  doubtWeight: 'الوزن خارج المعتاد لحاوية — تأكد من عدم وجود صفر زائد أو ناقص.',
  colDirection: 'الاتجاه',
  colWage: 'الأجر',
  colReceipt: 'الاستلام',
  wageSaved: 'تم حفظ الأجر.',
  payAction: 'تأكيد الاستلام',
  payUndo: 'إلغاء الاستلام',
  paidMark: 'تم الاستلام',
  paidByLine: (name: string): string => `أكّده ${name}`,
  confirmPayTitle: 'تأكيد استلام الأجر',
  confirmPayBody: (driver: string, number: string): string =>
    `استلم السائق ${driver} أجر نقلة الحاوية ${number}؟ يُسجَّل التأكيد باسمك ووقته.`,
  confirmPayUndoTitle: 'إلغاء تأكيد الاستلام',
  confirmPayUndoBody: (driver: string, number: string): string =>
    `يُلغى تأكيد استلام السائق ${driver} لأجر نقلة الحاوية ${number} ويعود المبلغ قابلاً للتعديل.`,
  payDone: 'تم تأكيد الاستلام.',
  payUndone: 'تم إلغاء تأكيد الاستلام.',
  haulsCount: (n: number): string => `عدد النقلات: ${String(n)}`,
  unpricedCount: (n: number): string => `${String(n)} بلا أجر`,
  groupSettled: 'تمت المحاسبة',
  screenTotals: 'إجمالي المعروض',
  paySettleAll: 'تسديد الكل',
  confirmPayAllTitle: 'تسديد الحساب كاملاً',
  confirmPayAllBody: (who: string, count: number, sum: number): string =>
    `يُسجَّل استلام ${who} أجر ${String(count)} نقلة بمجموع ${String(sum)}. ` +
    'يُختم كل بند باسمك ووقته، ويمكن إلغاء أي بند وحده بعدها.',
  payAllDone: (count: number): string => `تم تسجيل استلام ${String(count)} نقلة.`,
  totalWages: 'مجموع الأجور',
  paidWages: 'المدفوع',
  dueWages: 'المتبقي',
  wageUnset: 'بلا أجر',
  driverSignature: 'توقيع السائق',
  driversPrintTitle: (driver: string): string => `كشف حساب السائق ${driver}`,
  driversPrintTitleTruck: (truck: string): string => `كشف حساب سيارة ${ltrCode(truck)}`,

  // ---- photos ----
  photosTitle: 'الصور',
  photoAdd: 'إضافة صور',
  photosPrint: 'طباعة الصور',
  photoDeleted: 'تم حذف الصورة.',
  confirmPhotoDeleteTitle: 'حذف الصورة',
  confirmPhotoDeleteBody: 'تُحذف هذه الصورة من سجل الحاوية. هل أنت متأكد؟',
  photoAdded: (n: number): string =>
    n === 1 ? 'تمت إضافة الصورة.' : `تمت إضافة ${String(n)} من الصور.`,
  photoBadFile: 'يُقبل ملف صورة فقط (JPG أو PNG أو WebP). الصور الكبيرة تُصغَّر تلقائياً قبل الرفع.',
  photoView: 'عرض الصورة',
  photosOnPaper: (number: string): string => `صور الحاوية ${number}`,
  gatePhotosLabel: 'صور الحاوية (اختيارية)',
  gatePhotosHint: 'تُرفع مع تأكيد الإدخال وتبقى في سجل الحاوية — ويمكن إضافتها لاحقاً من البطاقة.',
  photoRemovePick: 'إزالة الصورة',
  photoUploadFailed: 'تعذّر رفع بعض الصور — أضفها من بطاقة الحاوية.',
  printWithPhotos: 'طباعة بصور',
  printWithoutPhotos: 'طباعة بدون صور',

  // ---- correcting a move ----
  correctMoveAction: 'تصحيح النقلة',

  // ---- تصحيح الفئة ----
  actionReclass: 'تصحيح الفئة',
  sizeFollowsBay: 'الفئة يقرّرها الباي. لتصحيحها استعمل زر «تصحيح الفئة».',
  reclassTitle: (number: string): string => `تصحيح فئة الحاوية ${ltrCode(number)}`,
  reclassLead: (from: number, to: number): string =>
    `السجل يقول إنها ${String(from)} قدماً. اختر الباي الذي تقف عليه فعلاً، والفئة تتبعه: ` +
    `${String(to)} قدماً.`,
  reclassExplain:
    'الحاوية لا تتحرك ولا تُطبع لها بطاقة نقل، والزون والستاك والطابق لا تتغير. ' +
    'التصحيح يصحّح ما يقوله السجل عن الأرض التي تشغلها.',
  reclassOption: (at: string, size: number): string =>
    `الباي ${ltrCode(at)} — ${String(size)} قدماً`,
  /**
   * الواو تسبق كلمة عربية لا ترميزاً لاتينياً: «… و⁦2-B-03⁩» تلتصق بالرمز
   * فتُقرأ جزءاً منه. فالباي يُكرَّر لتستقر الواو على حرف عربي.
   */
  reclassCovers: (first: string, second: string): string =>
    `تشغل الباي ${ltrCode(first)} والباي ${ltrCode(second)}`,
  reclassFrees: (bay: string): string => `تخلي الباي ${ltrCode(bay)}`,
  reclassNeighbours: 'الأرض المجاورة الآن:',
  reclassEmptyCell: 'فارغة',
  reclassWallCell: 'خارج المخطط',
  reclassNoRoom:
    'لا يوجد باي يصلح لهذه الفئة بجانب موقعها الحالي: الباي المجاور مشغول أو مغلق أو ' +
    'غير موجود في المخطط. انقل ما يجاورها أو راجع المالك، ثم أعد المحاولة.',
  reclassGoneLead:
    'هذه الحاوية غادرت الساحة، فتصحيح فئتها لا يشغل أرضاً. اختر الباي الذي كانت تقف ' +
    'عليه فعلاً حتى يبقى سجل الخروج صحيحاً ويبقى إلغاء الخروج ممكناً.',
  reclassGoneNoSlot: 'سجل خروج هذه الحاوية لا يحمل موقعاً، فالتصحيح يمسّ الفئة وحدها.',
  confirmReclassTitle: 'تأكيد تصحيح الفئة',
  confirmReclassBody: (number: string, size: number, from: string, to: string): string =>
    `تصير الحاوية ${ltrCode(number)} من فئة ${String(size)} قدماً، وينتقل عنوانها من ` +
    `${ltrCode(from)} إلى ${ltrCode(to)}. الحاوية لا تتحرك من مكانها.`,
  reclassDone: (number: string, size: number, at: string): string =>
    `تم تصحيح فئة الحاوية ${ltrCode(number)} إلى ${String(size)} قدماً في الموقع ${ltrCode(at)}`,
  correctingBanner: (number: string): string =>
    `تصحيح نقلة الحاوية ${ltrCode(number)}: اضغط على الباي ثم على الخانة الصحيحة — يُصحَّح السجل وبطاقة النقل نفسها.`,
  correctMoveDone: (number: string, to: string): string =>
    `تم تصحيح نقلة الحاوية ${ltrCode(number)} إلى ${ltrCode(to)}، وبطاقة النقل تقرأ الموقع الصحيح.`,

  // ---- moving ----
  movingBanner: (number: string): string =>
    `اختر موقع الحاوية ${ltrCode(number)}: اضغط على الباي ثم على الخانة.`,
  movingCancel: 'إلغاء النقل',
  confirmMoveTitle: 'تأكيد النقل',
  confirmMoveBody: (number: string, to: string): string =>
    `هل تريد نقل الحاوية ${ltrCode(number)} إلى الموقع ${ltrCode(to)}؟`,
  moveDone: (number: string, to: string): string =>
    `تم نقل الحاوية ${ltrCode(number)} إلى الموقع ${ltrCode(to)}`,

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
  /** كشف إنتاجية الآليات — ثمرة سجل «تم»: من أنجز كم، وبأي سرعة. */
  reportMachines: 'كشف إنتاجية الآليات',
  colMachine: 'الآلية',
  colTaskDoer: 'المنفّذ',
  colTasksIn: 'مهام الإدخال',
  colTasksOut: 'مهام التجهيز',
  colTasksTotal: 'المجموع',
  colTaskSpeed: 'متوسط زمن الإنجاز',
  taskMinutes: (minutes: number): string => {
    if (minutes < 1) return 'أقل من دقيقة';
    if (minutes < 60) return `${String(minutes)} دقيقة`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${String(hours)} ساعة` : `${String(hours)} ساعة و${String(rest)} دقيقة`;
  },
  machinesReportEmpty: 'لا مهام منجزة في هذه الفترة.',
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
  /** The truck register opened plain: every gate movement of the period. */
  truckAllTitle: 'كشف السيارات — جميع الحركات',
  /** The truck tab's carrier filter: null option = by single plate. */
  carrierFilterAll: 'كل الناقلين — بحسب رقم السيارة',
  reportCarrier: (name: string): string => `كشف سيارات الناقل ${name}`,
  carrierChip: (name: string): string => `الناقل: ${name}`,
  colCarrier: 'الناقل',
  /** «عرض الكل»: the whole register, no period — the owner's own words. */
  showAll: 'عرض الكل',
  rangeAll: 'كامل السجل حتى تاريخه',
  reportBill: 'كشف بوليصة',
  /** The bill register opened plain: every container record there is. */
  billAllTitle: 'كشف البوالص — جميع الحاويات',
  billAllNow: 'جميع الحاويات على كل البوالص — غير مقيّد بفترة',
  billOf: (bill: string): string => `بوليصة ${bill}`,
  billNow: 'جميع حاويات البوليصة — غير مقيّد بفترة',
  billTotals: (n: number, t20: number, t40: number): string =>
    `${String(n)} ${n >= 3 && n <= 10 ? 'حاويات' : 'حاوية'} — ${String(t20)} عشرين · ${String(t40)} أربعين`,
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
  /**
   * The page-size list's last entry: the whole register on one screen. NOT
   * «عرض الكل» — that is the period button standing beside it in the same
   * toolbar, and two controls answering to one name in one row is a trap.
   */
  perPageAll: 'الكشف كامل',
  /**
   * «ما في سكرول يمين وشمال بس دون ما انقص البيانات»: shrink the whole
   * sheet until every column fits the screen's width, like the printed
   * page does — nothing dropped, nothing hidden.
   */
  fitWidth: 'ملاءمة العرض',
  /** The phone's one button hiding the register's filter and tool rows. */
  sheetTools: 'الخيارات',
  /** «أسأل الموظف عند الإدخال»: فردية أم على كشف. */
  billKindSingle: 'فردية',
  billKindManifest: 'على كشف',
  /** The bills-paint tile: how many bills stand on this bay. */
  billCountCell: (count: number): string =>
    count === 1 ? 'بوليصة واحدة' : count === 2 ? 'بوليصتان' : count <= 10 ? `${String(count)} بوالص` : `${String(count)} بوليصة`,

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
    (fullBay === null ? '' : ` والباي ${ltrCode(fullBay)} ممتلئ بالكامل للتجربة.`),
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
    `سيعود كل شيء من «${name}»: الحاويات والحركات والموظفون والناقلون وسياراتهم وكلمات السر. ` +
    'وستُحفظ نسخة احتياطية من الوضع الحالي قبل ذلك. هل تريد المتابعة؟',
  /** The whole count, so «رجع كل شي؟» is answered by numbers, not impressions. */
  toolsRestoreDone: (counts: {
    containers: number;
    movements: number;
    users: number;
    carriers: number;
    trucks: number;
    permits: number;
    zones: number;
  }): string =>
    `تم الاسترجاع كاملاً: ${String(counts.containers)} حاوية، ` +
    `${String(counts.movements)} حركة في السجل، ${String(counts.users)} موظف، ` +
    `${String(counts.carriers)} ناقل و${String(counts.trucks)} سيارة ` +
    `و${String(counts.permits)} تصريح تحميل وخروج و${String(counts.zones)} زون معرّف.`,
  toolsWipeTitle: 'حذف كل البيانات',
  toolsWipeBody:
    'حذف جميع الحاويات والحركات وإعادة أرقام البطاقات إلى 1. يبقى الموظفون ' +
    'وكلمات السر كما هي.',
  toolsWipeWordSet: 'تعيين كلمة سر الحذف',
  toolsWipeWordChange: 'تغيير كلمة سر الحذف',
  /** تغيير كلمة سر المالك — من الشاشة، بيده هو، بلا وسيط يراها. */
  toolsPasswordTitle: 'كلمة سر المالك',
  toolsPasswordBody:
    'تغيير كلمة السر التي تدخل بها إلى الموقع. اكتب الحالية أولاً ثم الجديدة ' +
    'مرتين — ستة أحرف أو أرقام على الأقل، لأن الموقع مكشوف على الإنترنت وهذه ' +
    'الكلمة تفتح كل شيء.',
  toolsPasswordCurrent: 'كلمة السر الحالية',
  toolsPasswordNew: 'كلمة السر الجديدة',
  toolsPasswordChange: 'تغيير كلمة السر',
  toolsPasswordDone: 'تم تغيير كلمة سر المالك. استعملها في دخولك القادم.',
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
    `هل تريد حذف سجل الحاوية ${ltrCode(number)}؟ استخدم هذا الخيار فقط إذا كُتب السجل كله بالخطأ.`,
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
    BAD_SLOT:
      'هذه الخانة غير موجودة في مخطط الساحة الآن — قد تكون خارج حدود الزون، أو ' +
      'مغلقة، أو الفئة لا تناسب الباي. تحقق من العنوان، وإن كانت خانة أغلقها ' +
      'المالك فافتحها من شاشة الساحات ثم أعد المحاولة.',
    OCCUPIED: 'الخانة مشغولة.',
    NO_SUPPORT: 'لا توجد حاوية مسنِدة تحتها في الطابق الأدنى.',
    BLOCKED_DESCENT:
      'الحاوية التي فوقها لا تجد موقعاً تنزل إليه. انقلها إلى موقع آخر أولاً.',
    SAME_SLOT: 'هذا هو موقعها الحالي نفسه.',
    RECLASS_BURIED:
      'فوق هذه الحاوية حاويات في السجل، وتصحيح فئتها يغيّر الأرض التي تقف هي ' +
      'عليها فتصير التي فوقها على أرض غير المسجّلة. انقل ما فوقها أولاً ثم صحّح فئتها.',
    NOT_ADJACENT_BAY:
      'تصحيح الفئة لا ينقل الحاوية: الزون والستاك والطابق لا تتغير، والباي ' +
      'يتحرك خانة واحدة. اختر أحد البايين المعروضين.',
    RETURN_SIZE_CHANGED:
      'فئة الحاوية صُحِّحت بعد خروجها، والموقع المسجّل في حركة الخروج لا يناسب ' +
      'الفئة الجديدة. صحّح الفئة إلى الباي الصحيح أولاً، ثم أعد المحاولة.',
    SERVER_FAULT:
      'حدث خطأ في الخادم، لا في البيانات التي كتبتها. أعد المحاولة، وإن تكرر ' +
      'فراجع المطوّر — السبب مسجّل في سجل الخادم.',
    EXIT_ON_STANDING:
      'سجل هذه الحاوية يقول إنها واقفة في الساحة، والنموذج يحمل بيانات خروج — ' +
      'وغالباً لأن خروجها أُلغي بعد أن فتحت البطاقة. أغلق البطاقة وافتحها من ' +
      'جديد لتقرأ السجل الحالي، ثم صحّح.',
    EXIT_PAPERS_MISSING:
      'سجل هذه الحاوية يقول إنها خرجت، وبيانات الخروج ناقصة في النموذج — ' +
      'وغالباً لأن خروجها سُجِّل بعد أن فتحت البطاقة. أغلق البطاقة وافتحها من ' +
      'جديد لتقرأ السجل الحالي، ثم صحّح.',
    TIME_IN_FUTURE:
      'التاريخ أو الوقت المكتوب لم يأتِ بعد، والكشف لا يحمل سطراً من يوم لم يحدث. ' +
      'صحّح التاريخ إلى وقت مضى ثم أعد الحفظ.',
    EXIT_BEFORE_ENTRY:
      'تاريخ الخروج أسبق من تاريخ الدخول، والحاوية لا تخرج قبل أن تدخل. ' +
      'صحّح أحد التاريخين ليصير الخروج بعد الدخول.',
    NUMBER_IN_YARD: 'هذا الرقم موجود في الساحة حالياً. راجع الأوراق.',
    ALREADY_OUT: 'هذه الحاوية خرجت من الساحة من قبل.',
    TASK_EXISTS: 'لهذه الحاوية مهمة تجهيز معلّقة من قبل، فلا حاجة لإرسال أخرى.',
    TASK_CLOSED: 'هذه المهمة أُنجزت أو أُغلقت من قبل. حدّث الشاشة لتقرأ حالتها الجديدة.',
    NAME_TAKEN:
      'هذا الحرف مستخدم لزون قائم أو محجوز لسجلات زون سابق. اختر حرفاً آخر.',
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
    ZONE_HAS_CONTAINERS:
      'في هذا الزون حاويات واقفة سيتركها التعديل أو الحذف بلا أرض. ' +
      'انقل الحاويات أولاً ثم أعد المحاولة.',
    NOT_LAST_MOVE:
      'هذه ليست آخر نقلة مسجلة للحاوية، والتصحيح لا يطال إلا الأخيرة. ' +
      'صحّح الموقع بنقلة جديدة من الخريطة.',
    MOVE_BURIED:
      'فوق هذه الحاوية حاويات في السجل، فلا يُصحَّح موقعها وهي تسند غيرها. ' +
      'انقل ما فوقها أولاً ثم أعد المحاولة.',
    GROUP_BURIED:
      'لا يمكن النقل الجماعي: حاوية من خارج التحديد واقفة فوق إحدى المحددات. ' +
      'أنزلها أولاً أو أضفها إلى التحديد.',
    GROUP_NO_ROOM: 'باي الوجهة لا يتسع للمجموعة كلها. اختر باياً آخر أو قلّل التحديد.',
    PHOTO_LIMIT: 'بلغت الحاوية حدّها من الصور (30 صورة). احذف صورة قديمة ثم أضف الجديدة.',
    WAGE_PAID:
      'هذه النقلة تمت المحاسبة عليها والمبلغ مقفل. ألغِ تأكيد الاستلام أولاً ثم عدّل الأجر.',
    WAGE_MISSING: 'لا أجر مكتوباً لهذه النقلة بعد. اكتب الأجر أولاً ثم أكّد الاستلام.',
    SHEET_SCANNED:
      'الملف صورة ممسوحة (PDF) لا نصاً يُقرأ حرفاً بحرف، والنقل عن صورة قد يخطئ بحرف ' +
      'واحد يكفي لمشكلة كبيرة. اطلب من الجهة المرسلة ملف الإكسل أو الوورد الأصلي ثم ارفعه.',
    SHEET_OLD_EXCEL:
      'الملف بصيغة إكسل قديمة (xls) لا تُقرأ حرفياً. افتحه في إكسل واحفظه بصيغة xlsx ثم أعد الرفع.',
    SHEET_UNREADABLE:
      'تعذّرت قراءة الملف حرفياً. الصيغ المقبولة: إكسل حديث (xlsx) أو جدول وورد (docx) أو ' +
      'ملف نصي (csv) بترميز UTF-8. أعد حفظ الكشف بإحداها ثم أعد الرفع.',
    SHEET_EMPTY:
      'قُرئ الملف ولم يُعثر فيه على عمود أرقام حاويات. تأكد أن الملف يحوي جدول الدفعة نفسه ثم أعد الرفع.',
    SHEET_TOO_BIG:
      'الملف يحمل أكثر من 2000 سطر وهذا أكبر من أي دفعة واحدة. قسّم الكشف على ملفات أصغر ثم ارفع كل جزء وحده.',
  } satisfies Record<ErrorCode, string>,
  /** The refusals that involve another container name it in the sentence. */
  errorWith: (code: 'BLOCKED_DESCENT' | 'OCCUPIED', other: string): string =>
    code === 'BLOCKED_DESCENT'
      ? `الحاوية ${other} التي فوقها لا تجد موقعاً تنزل إليه. انقل الحاوية ${other} إلى موقع آخر أولاً.`
      : `الخانة مشغولة بالحاوية ${other}.`,
  networkError: 'تعذّر الاتصال بالخادم. تأكد من الاتصال وأعد المحاولة.',
} as const;
