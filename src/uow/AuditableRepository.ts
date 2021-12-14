import {
  Collection,
  ClientSession,
  Filter,
  UpdateOptions,
  FindOneAndUpdateOptions,
  UpdateFilter,
  AggregateOptions,
  UpdateResult
} from 'mongodb';
import { IPage, IPaging, IAuditable } from '../interfaces';

import { BaseRepository } from './BaseRepository';

export type RepositoryConfigs<T> = T & {
  getUserId: () => string | undefined;
  getCurrentTime: () => Date;
};


export type AuditableRepositoryConfigs = RepositoryConfigs<{
  softDelete: boolean;
}>

export const defaultConfigs: AuditableRepositoryConfigs = {
  getUserId: () => undefined,
  getCurrentTime: () => new Date(),
  softDelete: true
};

export class AuditableRepository<T extends IAuditable> extends BaseRepository<T> {

  protected _configs: AuditableRepositoryConfigs;
  constructor(
    protected _name: string,
    protected _collection: Collection<T>,
    protected _session?: ClientSession,
    configs: Partial<AuditableRepositoryConfigs> = defaultConfigs
  ) {
    super(_name, _collection, _session);
    this._configs = { ...defaultConfigs, ...configs }
  }

  protected get configs() {
    return this._configs;
  }

  protected getDeletedFilter(filter: Filter<T>) {
    if (this._configs.softDelete) return { ...filter, deleted: { $exists: false } };
    return filter;
  }

  protected getAuditObject() {
    return { at: this._configs.getCurrentTime(), by: this._configs.getUserId() }
  }

  add(entity: T) {
    entity.created = this.getAuditObject();
    return super.add(entity);
  }

  addMany(entities: T[], ordered = false) {
    entities.forEach(e => e.created = this.getAuditObject());
    return super.addMany(entities, ordered);
  }

  count(filter: Filter<T>): Promise<number> {
    const newFilter = this.getDeletedFilter(filter);
    return super.count(newFilter);
  }

  patch(filter: Filter<T>, item: Partial<T>): Promise<T | undefined> {
    const newFilter = this.getDeletedFilter(filter);
    return super.patch(newFilter, item);
  }


  async deleteMany(filter: Filter<T>): Promise<number> {
    if (!this._configs.softDelete) return super.deleteMany(filter);
    const $set = <UpdateFilter<T>['$set']>{ deleted: this.getAuditObject() };
    const result = await this._collection.updateMany(
      filter,
      { $set },
      { session: this._session }
    );
    return result.modifiedCount;
  }

  async deleteOne(filter: Filter<T>): Promise<T | undefined> {
    if (!this._configs.softDelete) return super.deleteOne(filter);
    const $set = <UpdateFilter<T>['$set']>{ deleted: this.getAuditObject() };
    const result = await this._collection.findOneAndUpdate(
      filter,
      { $set },
      { returnDocument: 'after', session: this._session }
    );
    return result.value ? result.value : undefined;
  }

  findOne(filter: Filter<T>, projection?: any): Promise<T | undefined> {
    const newFilter = this.getDeletedFilter(filter);
    return super.findOne(newFilter, projection);
  }

  findMany(filter: Filter<T>, projection?: any): Promise<T[]> {
    const newFilter = this.getDeletedFilter(filter);
    return super.findMany(newFilter, projection);
  }

  findManyPage(filter: Filter<T>, paging: IPaging, projection?: any): Promise<IPage<T>> {
    const newFilter = this.getDeletedFilter(filter);
    return super.findManyPage(newFilter, paging, projection);
  }

  update(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions) {
    const newFilter = this.getDeletedFilter(filter);
    return super.update(newFilter, update, options);
  }

  async findOneAndUpdate(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: FindOneAndUpdateOptions
  ): Promise<T | undefined> {
    const newFilter = this.getDeletedFilter(filter);

    return super.findOneAndUpdate(newFilter, update, options);
  }

  aggregate<T>(pipeline: object[], options?: AggregateOptions): Promise<T[]> {
    let newPipeline = pipeline;

    if (this._configs.softDelete) {
      if (pipeline.length > 0 && pipeline[0].hasOwnProperty('$match')) {
        const [existingMatch, ...rest] = pipeline;
        newPipeline = [{ $match: { deleted: { $exists: false }, ...existingMatch['$match'] } }, ...rest];
      } else {
        newPipeline = [{ $match: { deleted: { $exists: false } } }, ...pipeline];
      }
    }

    return super.aggregate(newPipeline, options);
  }
}
