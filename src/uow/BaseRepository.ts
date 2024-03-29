import { Collection, ClientSession, Filter, UpdateFilter, UpdateOptions, FindOneAndUpdateOptions, ObjectId, OptionalId, AggregateOptions, UpdateResult, Document, WithId, OptionalUnlessRequiredId } from 'mongodb';
import { EventEmitter } from 'events';
import { flatObj } from '../utils/flatObj';
import loggerFactory from '@log4js-node/log4js-api';
import { IRepository, IEntity, IPage, IPaging } from '../interfaces';

const logger = loggerFactory.getLogger('BaseRepository');

export class BaseRepository<T extends IEntity> implements IRepository<T> {


  constructor(protected _name: string, protected _collection: Collection<T>, protected _session?: ClientSession) {

  }

  get name(): string {
    return this._name;
  }

  async aggregate<T extends Document>(pipeline: object[], options?: AggregateOptions) {
    logger.trace('aggregate', this._name, JSON.stringify(pipeline), JSON.stringify({ ...options, session: undefined }));
    return this._collection.aggregate<T>(
      pipeline,
      { ...options, session: this._session }
    ).toArray();
  }

  async count(filter: Filter<T>) {
    return this._collection.countDocuments(filter, { session: this._session });
  }

  async add(item: T): Promise<T> {
    logger.trace('add', this._name, JSON.stringify(item));
    await this._collection.insertOne(<OptionalUnlessRequiredId<T>>item, { session: this._session });
    this._eventEmitter.emit('add', item);
    return item;
  }

  async addMany(items: T[], ordered = true): Promise<T[]> {
    logger.trace('addMany', this._name, JSON.stringify(items), `ordered : ${ordered}`);
    let resultItems: T[];
    try {
      await this._collection.insertMany(items as OptionalUnlessRequiredId<T>[], { ordered, session: this._session });
      resultItems = items;
    } catch (err: any) {
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

  async patch(filter: Filter<T>, item: Partial<T>, upsert = false): Promise<T | undefined> {
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

    const result = await this._collection.findOneAndUpdate(filter, updateObj, { upsert, session: this._session, returnDocument: 'after' });
    if (result) {
      this._eventEmitter.emit('update', result);
    }
    return result.value ? <T>result.value : undefined;
  }

  async deleteOne(filter: Filter<T>): Promise<T | undefined> {
    logger.trace('delete', this._name, JSON.stringify(filter));
    const x = await this._collection.findOneAndDelete(filter, { session: this._session });
    this._eventEmitter.emit('delete', x.value);
    return x.value ? <T>x.value : undefined;
  }

  async deleteMany(filter: Filter<T>): Promise<number> {
    logger.trace('deleteMany', this._name, JSON.stringify(filter));
    const x = await this._collection.deleteMany(filter, { session: this._session });
    return x.deletedCount;
  }

  async findOne(filter: Filter<T>, projection?: any): Promise<T | undefined> {
    logger.trace('findOne', this._name, JSON.stringify(filter), JSON.stringify(projection));
    const x = await this._collection.findOne<T>(filter, { projection, session: this._session });
    return x || undefined;
  }

  async findById(id: string, projection?: any): Promise<T | undefined> {
    logger.trace('findById', this._name, id, JSON.stringify(projection));
    const x = await this._collection.findOne<T>(<T>{ _id: id }, { projection, session: this._session });
    return x || undefined;
  }

  async findMany(filter: Filter<T>, projection?: any): Promise<T[]> {
    logger.trace('findMany', this._name, JSON.stringify(filter), JSON.stringify(projection));
    const result = await this._collection.find(filter, { projection, session: this._session }).toArray();
    return <T[]>result;
  }

  async findManyPage(filter: Filter<T>, paging: IPaging, projection?: any): Promise<IPage<T>> {
    logger.trace('findMany', this._name, JSON.stringify(filter), JSON.stringify(paging), JSON.stringify(projection));
    const total = await this._collection.countDocuments(filter, <{}>{ fields: projection, session: this._session });
    let cursor = this._collection
      .find<T>(filter, { projection, session: this._session });
    if (paging.sorter) {
      cursor = cursor.sort(paging.sorter);
    }
    cursor = cursor.skip(paging.index * paging.size)
      .limit(paging.size);

    const items = await cursor.toArray();
    return <IPage<T>>{
      index: paging.index + 1,
      size: paging.size,
      total,
      items
    };
  }

  async update(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions): Promise<Document | UpdateResult> {
    logger.trace('update', this._name, JSON.stringify(filter), JSON.stringify(update), JSON.stringify(options));
    const result = await this._collection.updateMany(filter, update, { ...options, session: this._session });
    return result;
  }


  async findOneAndUpdate(filter: Filter<T>, update: UpdateFilter<T>, options?: FindOneAndUpdateOptions): Promise<T | undefined> {
    logger.trace('findOneAndUpdate', this._name, JSON.stringify(filter), JSON.stringify(update), JSON.stringify(options));
    const result = await this._collection.findOneAndUpdate(filter, update, { ...options, session: this._session });
    return result.value ? <T>result.value : undefined;
  }

  protected _eventEmitter = new EventEmitter();

  get changes() {
    return this._eventEmitter;
  }

  on(event: 'add' | 'delete' | 'update', cb: (item: T) => void) {
    this._eventEmitter.on(event, cb);
  }
}