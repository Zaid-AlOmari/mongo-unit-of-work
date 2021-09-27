import { EventEmitter } from 'events';

export interface ICache<K, V> {
  get(key: K): V | undefined;
  set(key: string, value: V): void;
  invalidateKey(key: K, localOnly: boolean): Promise<void>;
  invalidateAll(localOnly: boolean): Promise<void>;

  getQuery(query: string): V[] | undefined;
  setQuery(query: string, values: { key: string; value: V }[]): void;

  changes(): EventEmitter;

  on(event: 'dispose', cb: (key: string) => void | Promise<void>): void;
  on(event: 'reset', cb: () => void | Promise<void>): void;
}