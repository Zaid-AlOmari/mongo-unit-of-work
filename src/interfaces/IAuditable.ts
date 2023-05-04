import { IEntity } from './IEntity';

export interface IAuditable extends IEntity {
  created?: {
    at: Date;
    by?: string;
  };
  updated?: {
    at: Date;
    by?: string;
  };
  deleted?: {
    at: Date;
    by?: string;
  };
}
