// 82463 هو رقم سيارة محمد جمعه — بقرار المالك. السطر الحقيقي (الذي حمل 21
// نقلة) ينتقل من عادل إلى بهاء، وسطر 82462 المكتوب خطأً يُحذف حذفاً ناعماً.
import { openDatabase } from './src/server/db';
import * as store from './src/server/store';

const db = openDatabase('data/yard.db');
const carriers = store.listCarriers(db);
const bahaa = carriers.find((c) => c.name.includes('بهاء'));
if (bahaa === undefined) throw new Error('لا يوجد ناقل بهاء');
const trucks = store.listTrucks(db);

const real = trucks.find((t) => t.number === '82463');
const typo = trucks.find((t) => t.number === '82462');
if (real === undefined) throw new Error('لا توجد سيارة 82463');

if (real.carrierId !== bahaa.id) {
  store.updateTruck(db, real.id, {
    carrierId: bahaa.id,
    code: real.code,
    number: real.number,
    driver: real.driver === '' ? 'محمد جمعه' : real.driver,
  });
  console.log(`نُقلت 60-82463 (${real.driver}) إلى «${bahaa.name}»`);
} else console.log('60-82463 عند بهاء أصلاً');

if (typo !== undefined) {
  store.softDeleteTruck(db, typo.id, new Date().toISOString());
  console.log('حُذف السطر الخاطئ 60-82462');
} else console.log('لا يوجد سطر 82462 — محذوف من قبل');

const after = store.listTrucks(db);
for (const c of store.listCarriers(db)) {
  console.log(`${c.name}: ${String(after.filter((t) => t.carrierId === c.id).length)} سيارة`);
}
db.close();
