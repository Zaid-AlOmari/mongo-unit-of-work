import { Collection, FindOneAndUpdateOption, ClientSession } from 'mongodb';
import loggerFactory from '@log4js-node/log4js-api';
import { BaseRepository } from './BaseRepository';
import { IEntity, ICache } from '../interfaces';

const logger = loggerFactory.getLogger('BaseRepositoryWithCache');

export class BaseRepositoryWithCache<T extends IEntity>
  extends BaseRepository<T>  {

  get(id: string): T | undefined {
    return this._cache.get(id);
  }

  cache(item: T) {
    return this._cache.set(item._id, item);
  }

  invalidateKey(id: string, localOnly: boolean) {
    return this._cache.invalidateKey(id, localOnly);
  }

  invalidateAll(localOnly: boolean) {
    return this._cache.invalidateAll(localOnly);
  }

  constructor(name: string, collection: Collection, protected _cache: ICache<string, T>, protected _session?: ClientSession) {
    super(name, collection, _session);
  }

  async add(item: T): Promise<T> {
    const x = await super.add(item);
    this.cache(x);
    return x;
  }

  async addMany(items: T[], ordered = true): Promise<T[]> {
    const results = await super.addMany(items, ordered);
    for (const item of results) {
      this.cache(item);
    }
    return results;
  }

  async patch(filter: any, item: Partial<T>, upsert = false): Promise<T | undefined> {
    if (filter && typeof filter._id === 'string') {
      await this.invalidateKey(filter._id, false);
    }
    else if (item && typeof item._id === 'string') {
      await this.invalidateKey(item._id, false);
    }
    else {
      await this.invalidateAll(false);
    }
    const x = await super.patch(filter, item, upsert);
    return x;
  }

  async delete(item: IEntity): Promise<any> {
    await this.invalidateKey(item._id, false);
    const x = await super.delete(item);
    return x;
  }

  async findOne(filter: any, projection?: any): Promise<T | undefined> {
    if (typeof filter._id === 'string' && Object.keys(filter).length === 1) {
      return this.findById(filter._id, projection);
    }
    if (!projection) {
      const query = JSON.stringify(filter);
      const results = this._cache.getQuery(query);
      if (results) {
        logger.trace('findById Cache hit', query);
        return Promise.resolve(results[0]);
      } else {
        logger.trace('findById Cache miss', query);
      }
    }
    const results = await super.findOne(filter, projection);
    if (results && results._id && !projection) {
      this._cache.setQuery(JSON.stringify(filter), [{ key: results._id, value: results }]);
    }
    return results;
  }

  async findById(id: string, projection?: any): Promise<T | undefined> {
    if (!projection) {
      const item = this.get(id);
      if (item) {
        logger.trace('findById Cache hit', id);
        return Promise.resolve(item);
      } else {
        logger.trace('findById Cache miss', id);
      }
    }
    const x = await super.findById(id, projection);
    if (x && x._id && !projection) this.cache(x);
    return x;
  }

  async findMany(filter: any, projection?: any): Promise<T[]> {
    if (!projection) {
      const query = JSON.stringify(filter);
      const results = this._cache.getQuery(query);
      if (results) {
        logger.trace('findById Cache hit', query);
        return Promise.resolve(results);
      } else {
        logger.trace('findById Cache miss', query);
      }
    }
    const results = await super.findMany(filter, projection);
    if (!projection) {
      if (results && results.length > 0) {
        this._cache.setQuery(JSON.stringify(filter), results.map(x => ({ key: x._id, value: x })));
        for (const item of results) {
          const isCached = this._cache.get(item._id) && true;
          if (!isCached) this.cache(item);
        }
      }
    }
    return results;
  }

  async findOneAndUpdate(filter: any, update: any, options?: FindOneAndUpdateOption<T> | undefined): Promise<T | undefined> {
    const result = await super.findOneAndUpdate(filter, update, options);
    if (result) {
      await this.invalidateKey(result._id, false);
      if (options && options.returnOriginal === false) this.cache(result);
      return result;
    }
    else {
      if (typeof filter._id === 'string') {
        await this.invalidateKey(filter._id, false);
      }
      return undefined;
    }
  }
}