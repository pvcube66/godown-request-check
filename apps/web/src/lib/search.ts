import { scoped, type Collections } from '@anomaly/core';

export const SEARCH_LIMIT = 20;
export const searchQuery = (value = '') => value.trim().slice(0, 60);

/** User input is a literal substring, never a Mongo regular-expression program. */
export function searchFilter(value: string) {
  const q = searchQuery(value);
  if (!q) return null;
  const literal = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  return { $or: [{ hostelName: literal }, { hostelCode: literal }, { requestId: literal }] };
}

export interface HostelResult {
  godownId: number;
  hostelCode: string;
  hostelName: string;
  districtName: string;
  godownName: string;
}

export async function searchDashboard(c: Pick<Collections, 'requests' | 'orders'>, value: string, names: string[] | null) {
  const textFilter = searchFilter(value);
  if (!textFilter) return { hostels: [], orders: [], moreHostels: false, moreOrders: false };
  const filter = scoped(textFilter, names);
  const [hostels, orders] = await Promise.all([
    c.requests.aggregate<HostelResult>([
      { $match: filter },
      { $sort: { requestDate: -1, requestId: 1 } },
      { $group: {
        _id: { godownId: '$godownId', hostelCode: '$hostelCode' },
        godownId: { $first: '$godownId' }, hostelCode: { $first: '$hostelCode' },
        hostelName: { $first: '$hostelName' }, districtName: { $first: '$districtName' },
        godownName: { $first: '$godownName' },
      } },
      { $sort: { hostelName: 1, godownId: 1, hostelCode: 1 } },
      { $limit: SEARCH_LIMIT + 1 },
    ]).toArray(),
    c.orders.find(filter).sort({ placedOn: -1, requestId: 1 }).limit(SEARCH_LIMIT + 1).toArray(),
  ]);
  return {
    hostels: hostels.slice(0, SEARCH_LIMIT), orders: orders.slice(0, SEARCH_LIMIT),
    moreHostels: hostels.length > SEARCH_LIMIT, moreOrders: orders.length > SEARCH_LIMIT,
  };
}
