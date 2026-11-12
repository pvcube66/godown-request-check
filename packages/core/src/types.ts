import type { RequestItemSnapshot } from './itemMaster.js';

export interface ParsedRequest {
  godownId: number;
  requestId: string;
  societyId: string;
  hostelCode: string;      // e.g. "2611010007"
  hostelName: string;      // full portal name
  districtName: string;
  godownName: string;
  requestDate: string;     // ISO yyyy-mm-dd
  month: string;           // yyyy-mm (the month the goods are requested for)
  status: string;
  dcNumber: string | null;
  items: Record<string, number>;   // item name -> quantity (zeros kept)
  itemSnapshots?: RequestItemSnapshot[];
  itemSnapshotsIncomplete?: boolean;   // some item still has no unit or pack size; it is read again
  itemReadAttempts?: number;
  itemMetadataSyncedAt?: Date;
}
