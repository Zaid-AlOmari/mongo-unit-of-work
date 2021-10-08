import { SortDirection } from 'mongodb';
import { IEntity } from './IEntity';
export interface IPage<T extends IEntity> extends IPaging {
  total: number;
  items: T[];
}


export interface IPaging {
  index: number;
  size: number;
  sorter?: { [field: string]: SortDirection };
}

export const defaultPaging: IPaging = { index: 0, size: 10 };