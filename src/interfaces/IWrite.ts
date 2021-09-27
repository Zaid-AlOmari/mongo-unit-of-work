import { IEntity } from './IEntity';
export interface IWrite<T extends IEntity> {
  add(item: T): Promise<T>;
  addMany(items: T[], ordered?: boolean): Promise<T[]>;
  patch(filter: any, item: Partial<T>, upsert?: boolean): Promise<T | undefined>;
  update(filter: any, update: any, options?: any): Promise<T>;
  delete(item: IEntity): Promise<T>;
  findOneAndUpdate(filter: any, update: any, options?: any): Promise<T | undefined>;
}
