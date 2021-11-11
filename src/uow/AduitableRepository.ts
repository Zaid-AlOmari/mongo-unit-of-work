import { Collection, ClientSession, Filter, UpdateOptions, FindOneAndUpdateOptions, UpdateFilter } from 'mongodb';

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

  update(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions): Promise<any> {
    this.addAuditableFields(update, options && options.upsert);
    return super.update(filter, update, options);
  }

  async findOneAndUpdate(filter: Filter<T>, update: UpdateFilter<T>, options?: FindOneAndUpdateOptions): Promise<T | undefined> {
    if (Object.values(filter).every(v => typeof v === 'undefined')) {
      logger.trace('findOneAndUpdate issue', Object.keys(filter));
      return undefined;
    }
    return super.findOneAndUpdate(filter, this.addAuditableFields(update, options && options.upsert), options);
  }

  patch(filter: Filter<T>, item: Partial<T>): Promise<T | undefined> {
    return super.patch(filter, item, false);
  }

  protected addAuditableFields(updateObject: UpdateFilter<T>, upsert: boolean | undefined = false) {
    return {
      ...updateObject,
      ...(updateObject.$set ? {
        $set: { updated: this.getAuditObject(), ...updateObject.$set }
      } : {}),
      ...(upsert ? {
        $setOnInsert: { created: this.getAuditObject(), ...updateObject.$setOnInsert }
      } : {})
    } as UpdateFilter<T>
  }
}
