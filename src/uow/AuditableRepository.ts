import {
  Collection,
  ClientSession,
  Filter,
  UpdateOptions,
  FindOneAndUpdateOptions,
  UpdateFilter,
  AggregateOptions,
  AggregationCursor,
  FindCursor,
  FindOptions,
  UpdateResult,
  MatchKeysAndValues,
  Document
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
    return {
      at: this._configs.getCurrentTime(),
      ...(this.configs.getUserId() ? { by: this._configs.getUserId() } : {}),
    }
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

  patch(filter: Filter<T>, item: Partial<T>, upsert = false): Promise<T | undefined> {
    const newFilter = this.getDeletedFilter(filter);
    const newItem = { ...item };
    if (item && Object.keys(item).length > 0) newItem.updated = this.getAuditObject();
    return super.patch(newFilter, newItem, upsert);
  }


  async deleteMany(filter: Filter<T>): Promise<number> {
    if (!this._configs.softDelete) return super.deleteMany(filter);
    const newFilter = this.getDeletedFilter(filter);
    const $set = <UpdateFilter<T>['$set']><any>{ deleted: this.getAuditObject() };
    const result = await this._collection.updateMany(
      newFilter,
      { $set: <any>{ deleted: this.getAuditObject() } },
      { session: this._session }
    );
    return result.modifiedCount;
  }

  async deleteOne(filter: Filter<T>): Promise<T | undefined> {
    if (!this._configs.softDelete) return super.deleteOne(filter);
    const newFilter = this.getDeletedFilter(filter);
    const $set = <UpdateFilter<T>['$set']><any>{ deleted: this.getAuditObject() };
    const result = await this._collection.findOneAndUpdate(
      newFilter,
      { $set },
      { returnDocument: 'after', session: this._session }
    );
    return this.getFindAndModifyValue<T>(result);
  }

  findOne(filter: Filter<T>, projection?: any): Promise<T | undefined> {
    const newFilter = this.getDeletedFilter(filter);
    return super.findOne(newFilter, projection);
  }

  findMany(filter: Filter<T>, projection?: any): Promise<T[]> {
    const newFilter = this.getDeletedFilter(filter);
    return super.findMany(newFilter, projection);
  }

  findCursor(filter: Filter<T>, options?: Omit<FindOptions, 'session'>): FindCursor<T> {
    const newFilter = this.getDeletedFilter(filter);
    return super.findCursor(newFilter, options);
  }

  findManyPage(filter: Filter<T>, paging: IPaging, projection?: any): Promise<IPage<T>> {
    const newFilter = this.getDeletedFilter(filter);
    return super.findManyPage(newFilter, paging, projection);
  }

  update(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions) {
    const newFilter = this.getDeletedFilter(filter);
    const newUpdate = this.addAuditableFields(update, options?.upsert);
    return super.update(newFilter, newUpdate, options);
  }

  async findOneAndUpdate(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: FindOneAndUpdateOptions
  ): Promise<T | undefined> {
    const newFilter = this.getDeletedFilter(filter);
    const newUpdate = this.addAuditableFields(update, options?.upsert);
    return super.findOneAndUpdate(newFilter, newUpdate, options);
  }

  aggregate<T extends Document>(pipeline: object[], options?: AggregateOptions | undefined): Promise<T[]> {
    return super.aggregate<T>(this.getDeletedPipeline(pipeline), options);
  }

  aggregateCursor<T extends Document>(pipeline: object[], options?: Omit<AggregateOptions, 'session'>): AggregationCursor<T> {
    return super.aggregateCursor<T>(this.getDeletedPipeline(pipeline), options);
  }

  protected getDeletedPipeline(pipeline: object[]): object[] {
    if (!this._configs.softDelete) return pipeline;
    if (pipeline.length > 0 && typeof pipeline[0] === 'object' && pipeline[0]['$match']) {
      const [existingMatch, ...rest] = pipeline;
      return [{ $match: { deleted: { $exists: false }, ...existingMatch['$match'] } }, ...rest];
    }
    return [{ $match: { deleted: { $exists: false } } }, ...pipeline];
  }

  addAuditableFields<T extends IAuditable>(updateObject: UpdateFilter<T>, upsert = false) {
    const newUpdate = { ...updateObject }
    if (newUpdate.$set) {
      newUpdate.$set = { updated: this.getAuditObject(), ...newUpdate.$set }
    }
    else {
      newUpdate.$set = <MatchKeysAndValues<T>>{ updated: this.getAuditObject() }
    }
    if (upsert) {
      Object.assign(newUpdate, {
        $setOnInsert: { created: this.getAuditObject(), ...newUpdate.$setOnInsert } as Readonly<Partial<T>>
      });
    }
    return newUpdate;
  }
}
