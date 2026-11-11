import { normalizedDistrictCode, SUPPLIED_STAGES, type Collections } from '@anomaly/core';
import { godownLabels } from './dashboard';
import { BYS, loadPerfOrders, loadSupplierResolver, monthlyCheckpoint, performance, hostelService, type By, type PerfOrder } from './performance';

export interface PerfQuery { by?: string; month?: string; focus?: string }

/** Everything the supplier-performance page and its download need, for one person's districts. */
export async function loadPerformanceView(c: Collections, names: string[] | null, q: PerfQuery, now = new Date()) {
  const by = (BYS.find((b) => b.key === q.by)?.key ?? 'supplier') as By;
  const month = /^\d{4}-\d{2}$/.test(q.month ?? '') ? q.month : undefined;
  const [all, supplier, godown] = await Promise.all([loadPerfOrders(c, names, month), loadSupplierResolver(c), godownLabels(c)]);
  const naming = { supplier: supplier.resolve, godown };
  const keyOf = (o: PerfOrder) => by === 'supplier' ? supplier.resolve(o).key : by === 'godown' ? o.account : by === 'district' ? (normalizedDistrictCode(o.districtName) || '(none)') : o.hostelCode;
  const focus = q.focus && by !== 'hostel' ? q.focus : undefined;
  const scopeOrders = focus ? all.filter((o) => keyOf(o) === focus) : all;
  const main = performance(scopeOrders, by, now, naming);
  const sub = focus ? {
    districts: performance(scopeOrders, 'district', now, naming).rows,
    weakestHostels: performance(scopeOrders, 'hostel', now, naming).rows.slice(0, 15),
    service: hostelService(scopeOrders),
  } : null;
  const checkpoint = by === 'supplier' && !focus ? monthlyCheckpoint(all, now, supplier.resolve) : null;
  const withDc = all.filter((o) => SUPPLIED_STAGES.includes(o.stage));
  return {
    by, month, focus, main, sub, service: hostelService(scopeOrders), checkpoint, mapped: supplier.mapped,
    coverage: { withDc: withDc.length, read: withDc.filter((o) => o.fulfilment !== undefined).length },
    total: scopeOrders.length,
  };
}
