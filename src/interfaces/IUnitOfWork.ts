import { IEntity } from './IEntity';
import { IRepository } from './IRepository';
export interface IUnitOfWork {
  /**
   * Get/Create a repository as part of a unit of work that supports transactions.
   * @param name The name of the repository.
   * @param withTransaction enable transactions for the repository, default is true.
   */
  getRepository<T extends IEntity>(name: string, withTransaction?: boolean): IRepository<T>;

  /**
   * Commits the transaction in progress.
   */
  commit(): Promise<void>;

  /**
   * Rollback any changes that was part of the transaction in progress if any.
   */
  rollback(): Promise<void>;

  /**
   * Dispose this unit of work safely, it will rollback uncommited transactions, end the session if any, and clear all repositories.
   */
  dispose(): Promise<void>;
}


export interface IUnitOfWorkOptions {
  /**
   * Enable transactions for any repository by default unless overriden by getRepository, default is true.
   */
  useTransactions?: boolean;
}