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

  getRepository<T extends IEntity, R extends IRepository<T>>(name: string, withTransaction = this._options.useTransactions): R {
    let repo = this._repos.get(name + (withTransaction ? '_w' : ''));
    if (repo) return <R>repo;
    repo = this._repositoryFactory(name, this._client, withTransaction ? this.getSession() : undefined);
    this._repos.set(name + (withTransaction ? '_w' : ''), repo);
    return <R>repo;
  }

  commit(): Promise<void> {
    if (this._session && this._session.inTransaction()) {
      logger.debug('commit');
      return this._session.commitTransaction();
    } else {
      return Promise.resolve();
    }
  }

  rollback(): Promise<void> {
    if (this._session && this._session.inTransaction()) {
      logger.debug('rollback');
      return this._session.abortTransaction();
    } else {
      return Promise.resolve();
    }
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