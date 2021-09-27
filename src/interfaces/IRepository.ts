import { IRead } from './IRead';
import { IEntity } from './IEntity';
import { IWrite } from './IWrite';
import { EventEmitter } from 'events';
export interface IRepository<T extends IEntity> extends IRead<T>, IWrite<T> {
  readonly name: string;

  readonly changes: EventEmitter;
  on(event: 'add' | 'delete' | 'update', cb: (item: T) => void): void;
}


export interface IRepositoryWithCache<T extends IEntity> extends IRead<T>, IWrite<T> {
  get(id: string): T | undefined;
  cache(item: T): void;
  invalidateKey(id: string, localOnly: boolean): Promise<void>;
  invalidateAll(localOnly: boolean): Promise<void>;
}
