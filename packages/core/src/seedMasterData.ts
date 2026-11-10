import type { Collections } from './db.js';
import { normalizedDistrictCode } from './sync.js';

/** Bootstrap catalog identities from stored records only; never contacts, credentials or invented assignments. */
export async function seedMasterData(c: Collections, actor: string): Promise<{ godowns: number; hostels: number; districts: number }> {
  if (!actor.trim()) throw new Error('Actor is required');
  return c.transaction(async (session) => {
    const accounts = await c.accounts.find({}, { session, projection: { username: 1, status: 1, godowns: 1 } }).toArray();
    const requests = await c.requests.aggregate<{ godownId: number; hostelCode: string; hostelName: string; districtName: string }>([
      { $sort: { requestDate: -1 } },
      { $group: { _id: { godownId: '$godownId', hostelCode: '$hostelCode' }, godownId: { $first: '$godownId' }, hostelCode: { $first: '$hostelCode' }, hostelName: { $first: '$hostelName' }, districtName: { $first: '$districtName' } } },
      { $project: { _id: 0 } },
    ], { session }).toArray();
    const now = new Date();
    const godowns = new Map<number, { godownId: number; portalLogin: string; name: string; status: 'active' | 'disabled'; createdAt: Date; updatedAt: Date }>();
    for (const account of accounts) for (const gd of account.godowns) {
      if (godowns.has(gd.id) && godowns.get(gd.id)!.portalLogin !== account.username) throw new Error(`Godown ${gd.id} has multiple stored logins; resolve the duplicate before bootstrapping`);
      godowns.set(gd.id, { godownId: gd.id, portalLogin: account.username, name: gd.name, status: account.status === 'disabled' ? 'disabled' : 'active', createdAt: now, updatedAt: now });
    }
    for (const godown of godowns.values()) await c.godowns.updateOne({ godownId: godown.godownId }, { $setOnInsert: godown }, { upsert: true, session });
    const districts = new Map<string, string>();
    let hostels = 0;
    for (const request of requests) {
      const districtCode = normalizedDistrictCode(request.districtName);
      if (districtCode) districts.set(districtCode, request.districtName.trim());
      if (!request.hostelCode) continue;
      await c.hostelsMaster.updateOne({ godownId: request.godownId, hostelCode: request.hostelCode }, {
        $setOnInsert: { ...request, districtCode, createdAt: now, updatedAt: now },
      }, { upsert: true, session });
      hostels++;
    }
    for (const [code, name] of districts) await c.districts.updateOne({ code }, { $setOnInsert: { code, name, createdAt: now, updatedAt: now } }, { upsert: true, session });
    const result = { godowns: godowns.size, hostels, districts: districts.size };
    await c.auditLog.insertOne({ actor, action: 'master.bootstrap', target: 'master', at: now, details: result }, { session });
    return result;
  });
}
