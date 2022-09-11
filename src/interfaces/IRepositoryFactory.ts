import { MongoClient, ClientSession } from 'mongodb';
import { IEntity } from './IEntity';
import { IRepository } from './IRepository';
export type IRepositoryFactory = (
  name: string,
  client: MongoClient,
  session?: ClientSession
) => IRepository<IEntity>;

export type Repositories = { [repoName: string]: IRepositoryFactory };
export const getFactory = <Repos extends Repositories>(repos: Repos) => {
  return function RepositoryFactory<R extends string>(name: string, client: MongoClient, session?: ClientSession) {
    const getRepo = repos[name];
    if (!getRepo) throw new Error(`unknown repository '${name}'`);
    return getRepo(name, client, session) as ReturnType<(Repos)[R]>
  };
};