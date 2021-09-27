import { Collection, FindOneAndUpdateOption, UpdateManyOptions, ClientSession } from 'mongodb';
import { EventEmitter } from 'events';
import { flatObj } from '../utils/flatObj';
import loggerFactory from '@log4js-node/log4js-api';
import { IRepository, IEntity, IPage, IPaging } from '../interfaces';

const logger = loggerFactory.getLogger('BaseRepository');

export class BaseRepository<T extends IEntity> implements IRepository<T> {


  constructor(protected _name: string, protected _collection: Collection, protected _session?: ClientSession) {

  }

  get name(): string {
    return this._name;
  }


  async add(item: T): Promise<T> {
    logger.trace('add', this._name, JSON.stringify(item));
    await this._collection.insertOne(item, { session: this._session });
    this._eventEmitter.emit('add', item);
    return item;
  }

  async addMany(items: T[], ordered = true): Promise<T[]> {
    logger.trace('addMany', this._name, JSON.stringify(items), `ordered : ${ordered}`);
    let resultItems: T[];
    try {
      await this._collection.insertMany(items, { ordered, session: this._session });
      resultItems = items;
    } catch (err) {
      if (err && err.writeErrors && err.writeErrors.length) {
        const ids: string[] = err.writeErrors.map((e: any) => e.err.op._id);
        resultItems = items.filter(i => !ids.includes(i._id));
      } else {
        throw err;
      }
    }
    for (const item of resultItems) {
      this._eventEmitter.emit('add', item);
    }
    return resultItems;
  }

  patch(filter: any, item: Partial<T>, upsert = false): Promise<T | undefined> {
    logger.trace('patch', this._name, JSON.stringify(item), `upsert : ${upsert}`);
    const flatObject: any = flatObj(item);
    const undefinedKeys = Object.keys(flatObject).filter(x => flatObject[x] === undefined || flatObject[x] === null);
    const set = { ...flatObject };
    delete set._id;
    const unset: any = {};
    for (const key of undefinedKeys) {
      delete set[key];
      unset[key] = '';
    }
    const updateObj = { $set: set, $unset: unset };
    if (Object.keys(updateObj.$set).length === 0) delete updateObj.$set;
    if (Object.keys(updateObj.$unset).length === 0) delete updateObj.$unset;
    if (Object.keys(updateObj).length === 0) return Promise.reject(new Error('No changes submited!'));
    return this.findOneAndUpdate(
      filter,
      updateObj,
      { upsert, returnOriginal: false })
      .then(result => {
        if (result) {
          this._eventEmitter.emit('update', result);
        }
        return result;
      });
  }

  delete(item: IEntity): Promise<any> {
    logger.trace('delete', this._name, JSON.stringify(item));
    return this._collection.deleteOne({ _id: item._id }, { session: this._session }).then(x => {
      this._eventEmitter.emit('delete', item);
      return x;
    });
  }

  findOne(filter: any, projection?: any): Promise<T | undefined> {
    logger.trace('findOne', this._name, JSON.stringify(filter), JSON.stringify(projection));
    return this._collection.findOne<T>(filter, { projection, session: this._session }).then(x => x || undefined);
  }

  findById(id: string, projection?: any): Promise<T | undefined> {
    logger.trace('findById', this._name, id, JSON.stringify(projection));
    return this._collection.findOne<T>({ _id: id }, { projection, session: this._session }).then(x => x || undefined);
  }

  findMany(filter: any, projection?: any): Promise<T[]> {
    logger.trace('findMany', this._name, JSON.stringify(filter), JSON.stringify(projection));
    return this._collection.find(filter, { projection, session: this._session }).toArray();
  }

  async findManyPage(filter: any, paging: IPaging, projection?: any): Promise<IPage<T>> {
    logger.trace('findMany', this._name, JSON.stringify(filter), JSON.stringify(paging), JSON.stringify(projection));
    const total = await this._collection.countDocuments(filter, <{}>{ fields: projection, session: this._session });
    let cursor = this._collection
      .find<T>(filter, { fields: projection, session: this._session })
      .skip(paging.index * paging.size)
      .limit(paging.size);
    if (paging.sorter) {
      cursor = cursor.sort(paging.sorter);
    }
    const items = await cursor.toArray();
    return <IPage<T>>{
      index: paging.index + 1,
      size: paging.size,
      total,
      items
    };
  }

  update(filter: any, update: any, options?: UpdateManyOptions | undefined): Promise<any> {
    logger.trace('update', this._name, JSON.stringify(filter), JSON.stringify(update), JSON.stringify(options));
    return this._collection.updateMany(filter, update, { ...options, session: this._session })
      .then(x => x.result);
  }


  findOneAndUpdate(filter: any, update: any, options?: FindOneAndUpdateOption<T> | undefined): Promise<T | undefined> {
    logger.trace('findOneAndUpdate', this._name, JSON.stringify(filter), JSON.stringify(update), JSON.stringify(options));
    return this._collection.findOneAndUpdate(filter, update, { ...options, session: this._session })
      .then(x => x.value || undefined);
  }

  protected _eventEmitter = new EventEmitter();

  get changes() {
    return this._eventEmitter;
  }

  on(event: 'add' | 'delete' | 'update', cb: (item: T) => void) {
    this._eventEmitter.on(event, cb);
  }
}