import { scoped, type Collections } from '@anomaly/core';

export const SEARCH_LIMIT = 20;
export const searchQuery = (value = '') => value.trim().slice(0, 100);

const NOISE = new Set(['id', 'hostel', 'hostels', 'request', 'order', 'code', 'no', 'the']);

/** The words of a search, whatever the format: "TGSWREIS (Boys) Kalwakurthy (36280901931)", "36280901931 kalwakurthy", "jc  kalwakurthy" ... */
export function searchTokens(value: string): string[] {
  return [...new Set(searchQuery(value).normalize('NFKC').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !NOISE.has(t)).map((t) => t.slice(0, 30)))].slice(0, 8);
}

/** A token matches a field when it appears in it as typed, or with any punctuation or spaces in between its letters ("kalwakurthygirls" finds "Kalwakurthy(girls)"). */
const tokenRegex = (t: string) => ({ $regex: t.length >= 4 && /[a-z]/.test(t) ? t.split('').join('[^A-Za-z0-9]*') : t, $options: 'i' });

/** Every word must be found in at least one of the fields; the order of the words does not matter. Never a user-written pattern: only letters and digits reach the database. */
export function searchFilter(value: string, fields: readonly string[] = ['hostelName', 'hostelCode', 'requestId', 'districtName']) {
  const tokens = searchTokens(value);
  if (!tokens.length) return null;
  return { $and: tokens.map((t) => ({ $or: fields.map((f) => ({ [f]: tokenRegex(t) })) })) };
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
