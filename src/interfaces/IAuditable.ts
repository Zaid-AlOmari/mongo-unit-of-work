import { IEntity } from './IEntity';

export interface IAuditable extends IEntity {
  createdAt?: Date;
  updatedAt?: Date;
}
