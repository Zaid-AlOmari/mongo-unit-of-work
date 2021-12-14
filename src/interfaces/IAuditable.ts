import { IEntity } from './IEntity';

export interface IAuditable extends IEntity {
  created?: {
    at: Date;
    by: string | undefined;
  };
  updated?: {
    at: Date;
    by: string | undefined;
  };
  deleted?: {
    at: Date;
    by: string | undefined;
  };
}
