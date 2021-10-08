import { Filter, FindOneAndUpdateOptions, UpdateFilter, UpdateOptions } from 'mongodb';
import { IEntity } from './IEntity';
export interface IWrite<T extends IEntity> {
  add(item: T): Promise<T>;
  addMany(items: T[], ordered?: boolean): Promise<T[]>;
  patch(filter: Filter<T>, item: Partial<T>, upsert?: boolean): Promise<T | undefined>;
  update(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions): Promise<T | undefined>;
  delete(filter: Filter<T>): Promise<T | undefined>;
  findOneAndUpdate(filter: Filter<T>, update: UpdateFilter<T>, options?: FindOneAndUpdateOptions): Promise<T | undefined>;
}
