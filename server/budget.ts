// A single named Durable Object serializes global and per-principal admission.
// Only SHA-256 credential fingerprints or verified Access subject hashes enter storage.
export interface DurableState {
  storage: {get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void>};
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}
export interface BudgetBinding {idFromName(name: string): unknown; get(id: unknown): {fetch(request: Request): Promise<Response>}}
interface Counter {minute: number; minuteCount: number; day: number; dayCount: number}
interface BudgetState {global: Counter; users: Record<string, Counter>; leases: Record<string, {key: string; until: number}>}
const fresh = (): Counter => ({minute: 0, minuteCount: 0, day: 0, dayCount: 0});
function roll(counter: Counter, now: number) {
  const minute = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000);
  if (counter.minute !== minute) {counter.minute = minute; counter.minuteCount = 0;}
  if (counter.day !== day) {counter.day = day; counter.dayCount = 0;}
}
export class ProviderBudget {
  constructor(private readonly state: DurableState) {}
  async fetch(request: Request): Promise<Response> {
    const input: unknown = await request.json();
    if (!input || typeof input !== 'object' || !('key' in input) || typeof input.key !== 'string' || !/^[a-f0-9]{64}$/.test(input.key)
      || !('lease' in input) || typeof input.lease !== 'string' || !/^[a-f0-9-]{36}$/.test(input.lease)
      || !('action' in input) || (input.action !== 'acquire' && input.action !== 'release')) return new Response(null, {status: 400});
    const {key, lease, action} = input;
    return this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const state = await this.state.storage.get<BudgetState>('budget') ?? {global: fresh(), users: {}, leases: {}};
      for (const [id, slot] of Object.entries(state.leases)) if (slot.until <= now) delete state.leases[id];
      roll(state.global, now);
      for (const [id, counter] of Object.entries(state.users)) if (counter.day !== state.global.day) delete state.users[id];
      if (action === 'release') {
        if (state.leases[lease]?.key === key) delete state.leases[lease];
      } else {
        const user = state.users[key] ?? fresh(); roll(user, now);
        if (state.global.minuteCount >= 12 || state.global.dayCount >= 100 || user.minuteCount >= 4 || user.dayCount >= 20
          || Object.keys(state.leases).length >= 2 || Object.values(state.leases).some(slot => slot.key === key)
          || Object.keys(state.users).length >= 1024) return new Response(null, {status: 429});
        user.minuteCount++; user.dayCount++; state.global.minuteCount++; state.global.dayCount++;
        state.users[key] = user; state.leases[lease] = {key, until: now + 35_000};
      }
      await this.state.storage.put('budget', state);
      return new Response(null, {status: 204});
    });
  }
}
