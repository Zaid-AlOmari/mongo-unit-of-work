import { Document, Filter, FindOneAndUpdateOptions, UpdateFilter, UpdateOptions, UpdateResult } from 'mongodb';
import { IEntity } from './IEntity';
export interface IWrite<T extends IEntity> {
  add(item: T): Promise<T>;
  addMany(items: T[], ordered?: boolean): Promise<T[]>;
  patch(filter: Filter<T>, item: Partial<T>, upsert?: boolean): Promise<T | undefined>;
  update(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions): Promise<UpdateResult | Document>;
  deleteOne(filter: Filter<T>): Promise<T | undefined>;
  deleteMany(filter: Filter<T>): Promise<number>;
  findOneAndUpdate(filter: Filter<T>, update: UpdateFilter<T>, options?: FindOneAndUpdateOptions): Promise<T | undefined>;
}
