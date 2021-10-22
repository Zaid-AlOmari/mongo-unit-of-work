import { IPage, IPaging } from './IPage';
import { IEntity } from './IEntity';
import { Filter } from 'mongodb';

export interface IRead<T extends IEntity> {
  findOne(filter: Filter<T>, projection?: any): Promise<T | undefined>;
  findById(id: string, projection?: any): Promise<T | undefined>;
  findMany(filter: Filter<T>, projection?: any): Promise<T[]>;
  findManyPage(filter: Filter<T>, paging: IPaging, projection?: any): Promise<IPage<T>>;
}



