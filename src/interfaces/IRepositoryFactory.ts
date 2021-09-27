import { MongoClient, ClientSession } from 'mongodb';
import { IEntity } from './IEntity';
import { IRepository } from './IRepository';
export type IRepositoryFactory = (
  name: string,
  client: MongoClient,
  session?: ClientSession
) => IRepository<IEntity>;
