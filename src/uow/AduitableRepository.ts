import { UpdateManyOptions, FindOneAndUpdateOption, CollectionAggregationOptions } from 'mongodb';

import { BaseRepository } from './BaseRepository';
import loggerFactory from '@log4js-node/log4js-api';
import { IAuditable } from '../interfaces/IAuditable';

const logger = loggerFactory.getLogger('AduitableRepository');
export abstract class AduitableRepository<T extends IAuditable> extends BaseRepository<T> {

  async count(filter: any) {
    return this._collection.countDocuments(filter, { session: this._session });
  }

  async aggregate<T>(pipeline: object[], options?: CollectionAggregationOptions) {
    logger.trace('aggregate', this._name, JSON.stringify(pipeline), JSON.stringify({ ...options, session: undefined }));
    return this._collection.aggregate<T>(
      pipeline,
      { ...options, session: this._session }
    ).toArray();
  }

  async findOne(filter: any, projection?: any) {
    if (Object.values(filter).every(v => typeof v === 'undefined')) {
      logger.trace('findOne issue', Object.keys(filter));
      return undefined;
    }
    return super.findOne(filter, projection);
  }

  add(entity: T) {
    entity.createdAt = new Date();
    return super.add(entity);
  }

  addMany(entities: T[], ordered = false) {
    const now = new Date();
    entities.forEach(e => e.createdAt = now);
    return super.addMany(entities, ordered);
  }

  update(filter: any, update: any, options?: UpdateManyOptions): Promise<any> {
    this.addAuditableFields(update, options && options.upsert);
    return super.update(filter, update, options);
  }

  async findOneAndUpdate(filter: any, update: any, options?: FindOneAndUpdateOption<T> | undefined): Promise<T | undefined> {
    if (Object.values(filter).every(v => typeof v === 'undefined')) {
      logger.trace('findOneAndUpdate issue', Object.keys(filter));
      return undefined;
    }
    this.addAuditableFields(update, options && options.upsert);
    return super.findOneAndUpdate(filter, update, options);
  }

  patch(filter: any, item: Partial<T>): Promise<T | undefined> {
    if (item) item.updatedAt = new Date();
    return super.patch(filter, item, false);
  }

  addAuditableFields(updateObject: any, upsert: boolean | undefined = false) {
    if (updateObject.$set) {
      updateObject.$set.updatedAt = new Date();
    }
    if (upsert) {
      if (!updateObject.$setOnInsert) updateObject.$setOnInsert = {};
      updateObject.$setOnInsert.createdAt = new Date();
    }
  }
}
