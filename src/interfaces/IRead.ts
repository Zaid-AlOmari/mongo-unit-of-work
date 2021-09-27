import { IPage, IPaging } from './IPage';
import { IEntity } from './IEntity';

export interface IRead<T extends IEntity> {
  findOne(filter: any, projection?: any): Promise<T | undefined>;
  findById(id: string, projection?: any): Promise<T | undefined>;
  findMany(filter: any, projection?: any): Promise<T[]>;
  findManyPage(filter: any, paging: IPaging, projection?: any): Promise<IPage<T>>;
}



