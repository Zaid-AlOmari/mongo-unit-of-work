import { MongoClient, ClientSession } from 'mongodb';
import { IUnitOfWork, IRepository, IEntity, IRepositoryFactory } from '../interfaces';
import loggerFactory from '@log4js-node/log4js-api';
import { IUnitOfWorkOptions } from '../interfaces/IUnitOfWork';

const logger = loggerFactory.getLogger('UnitOfWork');

export class UnitOfWork implements IUnitOfWork {

  protected _repos = new Map<string, IRepository<IEntity>>();
  protected _options: IUnitOfWorkOptions;
  constructor(protected _client: MongoClient, protected _repositoryFactory: IRepositoryFactory, options?: IUnitOfWorkOptions) {
    if (!options) this._options = { useTransactions: true };
    else this._options = { ...options };
  }

  protected _session: ClientSession | undefined;
  protected getSession() {
    if (this._session) return this._session;
    this._session = this._client.startSession();
    this._session.startTransaction();
    logger.debug('startSession');
    return this._session;
  }

  getRepository<T extends IEntity>(name: string, withTransaction = this._options.useTransactions): IRepository<T> {
    let repo = this._repos.get(name + (withTransaction ? '_w' : ''));
    if (repo) return <IRepository<T>>repo;
    repo = this._repositoryFactory(name, this._client, withTransaction ? this.getSession() : undefined);
    this._repos.set(name + (withTransaction ? '_w' : ''), repo);
    return <IRepository<T>>repo;
  }

  async commit(): Promise<void> {
    if (this._session && this._session.inTransaction()) {
      const result = await this._session.commitTransaction();
      logger.debug('commit', result);
    }
    return Promise.resolve();
  }

  async rollback(): Promise<void> {
    if (this._session && this._session.inTransaction()) {
      const result = await this._session.abortTransaction();
      logger.debug('rollback', result);
    }
    return Promise.resolve();
  }

  async dispose(): Promise<void> {
    this._repos.clear();
    if (!this._session) return;
    if (this._session.inTransaction()) {
      await this.rollback();
    }
    return new Promise((resolve, reject) => {
      if (!this._session) return resolve();
      this._session.endSession((err) => {
        if (err) return reject(err);
        return resolve();
      });
    });
  }
}