import type { SessionCrud } from './crud/sessionCrud.js';
import type { HostCrud } from './crud/hostCrud.js';
import type { DomainCrud } from './crud/domainCrud.js';

type AsyncCrud<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<R> : never };

/** A deployment owns storage and tenant scoping; the official runtime owns behavior. */
export interface PersistenceBackend {
  sessions: AsyncCrud<SessionCrud>;
  host: AsyncCrud<HostCrud>;
  domain: AsyncCrud<DomainCrud>;
}
