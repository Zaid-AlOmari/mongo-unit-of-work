import { Collection, ClientSession, AggregateOptions, Filter, UpdateOptions, FindOneAndUpdateOptions } from 'mongodb';

import { BaseRepository } from './BaseRepository';
import loggerFactory from '@log4js-node/log4js-api';
import { IAuditable } from '../interfaces/IAuditable';

const logger = loggerFactory.getLogger('AduitableRepository');
export class AduitableRepository<T extends IAuditable> extends BaseRepository<T> {

  constructor(protected _name: string, protected _collection: Collection<T>, protected _session?: ClientSession, protected configs = {
    getUserId: () => 'system',
    getCurrentTime: () => new Date()
  }) {
    super(_name, _collection, _session)
  }

  protected getAuditObject() {
    return { at: this.configs.getCurrentTime(), by: this.configs.getUserId() }
  }

  add(entity: T) {
    entity.created = this.getAuditObject();
    return super.add(entity);
  }

  addMany(entities: T[], ordered = false) {
    entities.forEach(e => e.created = this.getAuditObject());
    return super.addMany(entities, ordered);
  }

  update(filter: Filter<T>, update: any, options?: UpdateOptions): Promise<any> {
    this.addAuditableFields(update, options && options.upsert);
    return super.update(filter, update, options);
  }

  async findOneAndUpdate(filter: any, update: any, options?: FindOneAndUpdateOptions): Promise<T | undefined> {
    if (Object.values(filter).every(v => typeof v === 'undefined')) {
      logger.trace('findOneAndUpdate issue', Object.keys(filter));
      return undefined;
    }
    this.addAuditableFields(update, options && options.upsert);
    return super.findOneAndUpdate(filter, update, options);
  }

  patch(filter: any, item: Partial<T>): Promise<T | undefined> {
    if (item) item.updated = this.getAuditObject();
    return super.patch(filter, item, false);
  }

  addAuditableFields(updateObject: any, upsert: boolean | undefined = false) {
    if (updateObject.$set) {
      updateObject.$set.updated = this.getAuditObject();
    }
    if (upsert) {
      if (!updateObject.$setOnInsert) updateObject.$setOnInsert = {};
      updateObject.$setOnInsert.created = this.getAuditObject();
    }
  }
}
