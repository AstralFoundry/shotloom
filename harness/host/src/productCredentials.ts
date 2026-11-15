import { CredentialProvider, type CredentialKey, type CredentialRecord, type CredentialRef } from '@deepseek-ai/dsh-credentials';

/** Product settings and the BFF own secrets; the Host retains only this run's injected values. */
export default class ProductCredentials extends CredentialProvider {
  private readonly values = new Map<CredentialRef, string>();
  private readonly records = new Map<CredentialKey, CredentialRecord>();
  private writes = Promise.resolve();
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writes.then(work);
    this.writes = next.then(() => {}, () => {});
    return next;
  }
  async resolve(ref: CredentialRef) {
    const value = this.values.get(ref);
    return value ? { value, source: 'shotloom' } : undefined;
  }
  async describe(ref: CredentialRef) { return { configured: this.values.has(ref), source: 'shotloom', writable: false }; }
  async set(ref: CredentialRef, value: string) {
    if (!value) throw new Error('Empty product credential');
    this.values.set(ref, value);
    this.notifyUpdated(ref);
  }
  async unset(ref: CredentialRef) { this.values.delete(ref); this.notifyUpdated(ref); }
  async readRecord(key: CredentialKey) { return structuredClone(this.records.get(key)); }
  async describeRecord(key: CredentialKey) {
    const record = this.records.get(key);
    return { configured: Boolean(record), writable: true, ...(record ? { kind: record.kind } : {}) };
  }
  async listRecords() { return [...this.records].map(([key, record]) => ({ key, kind: record.kind })); }
  async modifyRecord(key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    return this.enqueue(async () => {
      const current = await this.readRecord(key);
      const next = await mutate(current);
      if (next !== undefined) { this.records.set(key, structuredClone(next)); this.notifyRecordUpdated(key); }
      return this.readRecord(key);
    });
  }
  async deleteRecord(key: CredentialKey) {
    await this.enqueue(async () => { this.records.delete(key); this.notifyRecordUpdated(key); });
  }
}
