import 'mocha';
import chai from 'chai';
import sinon from 'sinon';
chai.use(require('sinon-chai'));
const expect = chai.expect;

import mongodb, { MongoClient, ClientSession } from 'mongo-mock';
import { UnitOfWork, BaseRepository, IEntity, BaseRepositoryWithCache, ICache, IAuditable, AuditableRepository, IRepository } from '../src/index';
import { flatObj } from '../src/utils/flatObj';
import { Collection } from 'mongodb';
import { getFactory, Repositories } from '../src/interfaces/IRepositoryFactory';

mongodb.max_delay = 10;

const repos: Repositories = {
  c1: (name, client, session) => new BaseRepository(name, getMockedCollection(name, client), session),
  c2: (name, client, session) => new BaseRepositoryWithCache(name, getMockedCollection(name, client), getCache(), session),
  c3: (name, client, session) => new AuditableRepository(name, getMockedCollection(name, client), session),
}

describe('unit-of-work', () => {

  let uow: UnitOfWork;
  let client: MongoClient;
  const getNewSession = () => {
    return {
      id: 'some session',
      tans: false,
      inTransaction: function inTransaction() {
        return this.tans;
      },
      startTransaction: function startTransaction() {
        this.tans = true;
        return { new: 'transaction' };
      },
      endSession: (cb) => cb()
    };
  };
  beforeEach(async () => {
    client = await getMongoClient();
    Object.defineProperty(client, 'startSession', {
      value: () => getNewSession()
    });
    uow = new UnitOfWork(client, getFactory(repos), { useTransactions: false });
  });

  afterEach(async () => {
    await uow.dispose();
    sinon.restore();
    client.close();
  });

  describe('UnitOfWork', () => {
    it('should get the proper repo', async () => {
      const repo = uow.getRepository('c1');
      expect(repo.name).eq('c1');
    });

    it('should default to useTransactions being true', async () => {
      const newUnitOfWork = new UnitOfWork(client, getFactory(repos), undefined);
      // tslint:disable-next-line: no-string-literal
      expect(newUnitOfWork['_options']).deep.eq({ useTransactions: true });
    });

    it('should getSession with started transaction', async () => {
      const newUnitOfWork = new UnitOfWork(client, getFactory(repos));
      // tslint:disable-next-line: no-string-literal
      const session = newUnitOfWork['getSession']();
      expect(session).eq(session);
      // tslint:disable-next-line: no-string-literal
      expect(newUnitOfWork['getSession']()).eq(session);
    });

    it('should getRepository from the supplied factory', async () => {
      const newUnitOfWork = new UnitOfWork(client, getFactory(repos));
      // tslint:disable-next-line: no-string-literal
      const repo = newUnitOfWork.getRepository('c1');
      expect(repo.name).eq('c1');
      expect(newUnitOfWork.getRepository('c1')).eq(repo);
    });

    it('should commit if in a trasaction', async () => {
      const newUnitOfWork = new UnitOfWork(client, getFactory(repos));
      // tslint:disable-next-line: no-string-literal
      const session = newUnitOfWork['getSession']();
      let committed = false;
      Object.defineProperty(session, 'commitTransaction', {
        value: () => {
          committed = true;
        }
      });
      const repo = newUnitOfWork.getRepository('c1');
      await newUnitOfWork.commit();
      expect(committed).eq(true);
    });

    it('should pass when committing without a trasaction', async () => {
      const newUnitOfWork = new UnitOfWork(client, getFactory(repos), { useTransactions: false });
      const repo = newUnitOfWork.getRepository('c1');
      await newUnitOfWork.commit();
      // tslint:disable-next-line: no-string-literal
      expect(repo['_session']).eq(undefined);
    });

    it('should rollback if in a trasaction', async () => {
      const newUnitOfWork = new UnitOfWork(client, getFactory(repos));
      // tslint:disable-next-line: no-string-literal
      const session = newUnitOfWork['getSession']();
      let aborted = false;
      Object.defineProperty(session, 'abortTransaction', {
        value: () => {
          aborted = true;
        }
      });
      const repo = newUnitOfWork.getRepository('c1');
      await newUnitOfWork.rollback();
      expect(aborted).eq(true);
    });

    it('should pass when rolling back without a trasaction', async () => {
      const newUnitOfWork = new UnitOfWork(client, getFactory(repos), { useTransactions: false });
      const repo = newUnitOfWork.getRepository('c1');
      await newUnitOfWork.rollback();
      // tslint:disable-next-line: no-string-literal
      expect(repo['_session']).eq(undefined);
    });

    it('should rollback when calling dispose if in a trasaction', async () => {
      const newUnitOfWork = new UnitOfWork(client, getFactory(repos), { useTransactions: true });
      const repo = newUnitOfWork.getRepository('c1', true);
      let aborted = false;
      // tslint:disable-next-line: no-string-literal
      Object.defineProperty(repo['_session'], 'abortTransaction', {
        value: () => { aborted = true; }
      });
      await newUnitOfWork.dispose();
      expect(aborted).eq(true);
    });

    it('should throw error when calling dispose if in a trasaction and an endSession failed', async () => {
      const newUnitOfWork = new UnitOfWork(client, getFactory(repos), { useTransactions: true });
      const repo = newUnitOfWork.getRepository('c1', true);
      let aborted = false;
      // tslint:disable-next-line: no-string-literal
      Object.defineProperty(repo['_session'], 'abortTransaction', {
        value: () => { aborted = true; }
      });
      // tslint:disable-next-line: no-string-literal
      Object.defineProperty(repo['_session'], 'endSession', {
        value: (cb) => cb(new Error('some_error'))
      });
      try {
        await newUnitOfWork.dispose();
        expect(false, 'Should not reach here!').eq(true);
      } catch (err: any) {
        expect(err);
      }
    });

    it('should end session when calling dispose if not in a trasaction', async () => {
      const newUnitOfWork = new UnitOfWork(client, getFactory(repos));
      const repo = newUnitOfWork.getRepository('c1', true);
      // tslint:disable-next-line: no-string-literal
      repo['_session'].inTransaction = () => false;
      await newUnitOfWork.dispose();
    });

  });

  describe('BaseRepository', () => {
    it('should add an item and findById it by id', async () => {
      const repo = uow.getRepository('c1');
      await repo.add({ _id: '2' });
      const result = await repo.findById('2', { _id: 1 });
      if (result) {
        expect(result._id).eq('2');
      }
    });

    it('should add an item and findOne', async () => {
      const repo = uow.getRepository('c1');
      await repo.add({ _id: '3' });
      const result = await repo.findOne({ _id: '3' }, { _id: 1 });
      if (result) {
        expect(result._id).eq('3');
      }
    });

    it('should return undefined if item is not found', async () => {
      const repo = uow.getRepository('c1');
      const result = await repo.findOne({ _id: '4' }, { _id: 1 });
      expect(result).eq(undefined);
    });

    it('should emit an add event when item is added', async () => {
      const repo = uow.getRepository('c1');
      repo.on('add', (item) => {
        expect(item._id).eq('5');
      });
      await repo.add({ _id: '5' });
    });

    it('should delete an item', async () => {
      const repo = uow.getRepository('c1');
      await repo.add({ _id: '6' });
      repo.on('delete', (item) => {
        expect(item._id).eq('6');
      });
      await repo.deleteOne({ _id: '6' });
      const item = await repo.findById('6');
      expect(item).eq(undefined);
    });

    it('should addMany items with ordered', async () => {
      const repo = uow.getRepository('c1');
      const results = await repo.addMany([{ _id: '7' }, { _id: '8' }]);
      const item7 = await repo.findById('7', { _id: 1 });
      const item8 = await repo.findById('8', { _id: 1 });

      expect(item7 && item7._id).eq('7');
      expect(item8 && item8._id).eq('8');
    });


    it('should addMany items without ordered', async () => {
      const repo = uow.getRepository('c1');
      const results = await repo.addMany([{ _id: '9' }, { _id: '10' }], false);
      const item9 = await repo.findById('9', { _id: 1 });
      const item10 = await repo.findById('10', { _id: 1 });

      expect(item9 && item9._id).eq('9');
      expect(item10 && item10._id).eq('10');
    });

    it('should findMany by filter', async () => {
      const repo = uow.getRepository('c1');
      await repo.addMany([{ _id: '11' }, { _id: '12' }], true);
      const results = await repo.findMany({ _id: { $in: ['11', '12'] } }, { _id: 1 });

      expect(results.length).eq(2);
      expect(results.map(x => x._id)).deep.eq(['11', '12']);
    });

    it('should findManyPage by filter', async () => {
      const repo = uow.getRepository('c1');
      await repo.addMany([{ _id: '13' }, { _id: '14' }], true);
      const results = await repo.findManyPage(
        { _id: { $in: ['13', '14'] } },
        { index: 1, size: 1 },
        { _id: 1 });

      expect(results.index).eq(2);
      expect(results.size).eq(1);
      expect(results.total).eq(2);
      expect(results.items.map(x => x._id)).deep.eq(['14']);
    });

    it('should findManyPage by filter with sorter', async () => {
      const repo = uow.getRepository('c1');
      await repo.addMany([{ _id: '15' }, { _id: '16' }], true);
      const results = await repo.findManyPage(
        { _id: { $in: ['15', '16'] } },
        { index: 1, size: 1, sorter: { _id: -1 } },
        { _id: 1 });

      expect(results.index).eq(2);
      expect(results.size).eq(1);
      expect(results.total).eq(2);
      expect(results.items.map(x => x._id)).deep.eq(['15']);
    });

    it('should update by filter', async () => {
      const repo = uow.getRepository('c1') as IRepository<{ name?: string; _id: string }>;
      await repo.add({ _id: '17' });
      await repo.update({ _id: '17' }, { $set: { name: 'zaid' } });
      const result = await repo.findById('17', { _id: 1, name: 1 });
      expect(result).deep.eq({ _id: '17', name: 'zaid' });
    });

    it('should findOneAndUpdate by filter if found', async () => {
      const repo = uow.getRepository('c1') as IRepository<{ name?: string; _id: string }>;
      await repo.add({ _id: '18' });
      const result = await repo.findOneAndUpdate({ _id: '18' }, { $set: { name: 'zaid' } });
      expect(result).deep.eq({ _id: '18', name: 'zaid' });
    });

    it('should return undefined for findOneAndUpdate if not found', async () => {
      const repo = uow.getRepository('c1') as IRepository<{ name?: string; _id: string }>;
      // tslint:disable-next-line: no-string-literal
      repo['_collection'].findOneAndUpdate = (filter, update, options) => {
        expect(filter).deep.eq({ _id: '18' });
        expect(update).deep.eq({ $set: { name: 'zaid' } });
        // tslint:disable-next-line: no-null-keyword
        return Promise.resolve({ value: null });
      };
      const result = await repo.findOneAndUpdate({ _id: '18' }, { $set: { name: 'zaid' } });
    });

    it('should return only sucessfully added items for addMnay', async () => {
      const repo = uow.getRepository('c1') as IRepository<{ name?: string; _id: string }>;
      // tslint:disable-next-line: no-string-literal
      Object.defineProperty(repo['_collection'], 'insertMany', {
        value: (items, options) => {
          expect(items).deep.eq([{ _id: '19' }, { _id: '20' }]);
          expect(options).deep.eq({ ordered: true, session: undefined });
          // tslint:disable-next-line: no-null-keyword
          return Promise.reject({
            writeErrors: [
              { err: { op: { _id: '19' } } }
            ]
          });
        }
      });
      const result = await repo.addMany([{ _id: '19' }, { _id: '20' }], true);
      expect(result).deep.eq([{ _id: '20' }]);
    });

    it('should throw if some error happend for addMnay', async () => {
      const repo = uow.getRepository('c1') as IRepository<{ name?: string; _id: string }>;
      // tslint:disable-next-line: no-string-literal
      Object.defineProperty(repo['_collection'], 'insertMany', {
        value: (items, options) => {
          return Promise.reject(new Error('some_error'));
        }
      });
      try {
        const result = await repo.addMany([{ _id: '21' }, { _id: '22' }], true);
        expect(true, 'Should not reach here').eq(false);
      } catch (err: any) {
        expect(err.message).eq('some_error');
      }
    });

    it('should throw if some error happend for addMnay', async () => {
      const repo = uow.getRepository('c1');
      // tslint:disable-next-line: no-string-literal
      Object.defineProperty(repo['_collection'], 'insertMany', {
        value: (items, options) => {
          return Promise.reject(new Error('some_error'));
        }
      });
      try {
        const result = await repo.addMany([{ _id: '21' }, { _id: '22' }], true);
        expect(true, 'Should not reach here').eq(false);
      } catch (err: any) {
        expect(err.message).eq('some_error');
      }
    });


    it('should return the event emitter', async () => {
      const repo = uow.getRepository('c1');

      const fun1 = () => { return 1; };
      repo.on('add', fun1);
      expect(repo.changes.listeners('add')).to.deep.eq([fun1]);
    });

    it('should patch an item', async () => {
      const repo = uow.getRepository('c1');
      Object.defineProperty(repo['_collection'], 'findOneAndUpdate', {
        value: (filter, update, options) => {
          expect(filter).deep.eq({ _id: '23' });
          expect(update).deep.eq({ $set: { name: 'zaid' }, $unset: { email: '' } });
          return Promise.resolve({ _id: '23', name: 'zaid' });
        }
      });
      repo.on('update', (item) => {
        expect(item).deep.eq({ _id: '23', name: 'zaid' });
      });
      const result = await repo.patch(
        { _id: '23' },
        <any>{ _id: '23', name: 'zaid', email: undefined },
        false);
    });

    it('should not include a set command no $set is required', async () => {
      const repo = uow.getRepository('c1');
      Object.defineProperty(repo['_collection'], 'findOneAndUpdate', {
        value: (filter, update, options) => {
          expect(filter).deep.eq({ _id: '23' });
          expect(update).deep.eq({ $unset: { email: '' } });
          return Promise.resolve({ _id: '23', name: 'zaid' });
        }
      });
      repo.on('update', (item) => {
        expect(item).deep.eq({ _id: '23', name: 'zaid' });
      });
      const result = await repo.patch(
        { _id: '23' },
        <any>{ _id: '23', email: undefined },
        false);
    });

    it('should not include a unset command no $unset is required', async () => {
      const repo = uow.getRepository('c1');

      Object.defineProperty(repo['_collection'], 'findOneAndUpdate', {
        value: (filter, update, options) => {
          expect(filter).deep.eq({ _id: '23' });
          expect(update).deep.eq({ $set: { name: 'zaid' } });
          return Promise.resolve({ _id: '23', name: 'zaid' });
        }
      });
      repo.on('update', (item) => {
        expect(item).deep.eq({ _id: '23', name: 'zaid' });
      });
      const result = await repo.patch(
        { _id: '23' },
        <any>{ _id: '23', name: 'zaid' },
        false);
    });

    it('should throw if no change is submitted', async () => {
      const repo = uow.getRepository('c1');
      try {
        const result = await repo.patch(
          { _id: '23' },
          <any>{ _id: '23' },
          false);
      } catch (err: any) {
        expect(err);
      }
    });

    it('should not emit update event if not found', async () => {
      const repo = uow.getRepository('c1');
      Object.defineProperty(repo['_collection'], 'findOneAndUpdate', {
        value: (filter, update, options) => {
          return Promise.resolve('');
        }
      });
      repo.on('update', (item) => {
        expect(true, 'Should not reach here').eq(false);
      });
      const result = await repo.patch(
        { _id: '23' },
        <any>{ _id: '23', name: 'zaid' });
    });
  });

  describe('BaseRepositoryWithCache', () => {

    it('should add an item to the cache once it is found', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(key).eq('2');
        expect(item).deep.eq({ _id: '2' });
      };
      await repo.add({ _id: '2' });
    });

    it('should addMany items to the cache once it is found', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(['3', '4'].includes(key)).eq(true);
      };
      await repo.addMany([{ _id: '3' }, { _id: '4' }]);
    });

    it('should try to get item from cache', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.get = (key) => {
        expect(key).eq('5');
        return { _id: '5' };
      };
      cache.set = (key, item) => {
        expect(key).eq('5');
      };
      await repo.add({ _id: '5' });
      await repo.findById('5');
    });

    it('should try to invalidate the cache when delete', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.invalidateKey = (key, local) => {
        expect(key).eq('6');
        return Promise.resolve();
      };
      await repo.deleteOne({ _id: '6' });
    });

    it('should try to invalidate a key in the cache when patch by filter._id', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.invalidateKey = (key, local) => {
        expect(key).eq('7');
        return Promise.resolve();
      };
      cache.set = (key, item) => {
        expect(key).eq('7');
      };
      await repo.add({ _id: '7' });
      await repo.patch({ _id: '7' }, <{}>{ _id: '7', name: 'zaid' }, false);
    });

    it('should try to invalidate a key in the cache when patch by item._id', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.invalidateKey = (key, local) => {
        expect(key).eq('8');
        return Promise.resolve();
      };
      cache.set = (key, item) => {
        expect(key).eq('8');
      };
      await repo.add(<IEntity>{ _id: '8', type: '8' });
      await repo.patch({ type: '8' }, <{}>{ _id: '8', name: 'zaid' });
    });

    it('should try to invalidate all the cache when patching by a filter that does not include the )_id', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.invalidateAll = (local) => {
        expect(local).eq(false);
        return Promise.resolve();
      };
      cache.invalidateKey = (key, local) => {
        expect(key).eq('9');
        return Promise.resolve();
      };
      cache.set = (key, item) => {
        expect(key).eq('9');
      };
      await repo.add(<IEntity>{ _id: '9', type: '9' });
      await repo.patch({ type: '9' }, <{}>{ name: 'zaid' }, false);
    });

    it('should try to get item from cache for findOne using findById', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.getQuery = (query) => {
        expect(query).eq(JSON.stringify({ _id: '10' }));
        return [{ _id: '10' }];
      };
      cache.get = (key) => {
        expect(key).eq('10');
        return { _id: '10' };
      };
      cache.set = (key, item) => {
        expect(key).eq('10');
      };
      await repo.add(<IEntity>{ _id: '10' });
      await repo.findOne(<IEntity>{ _id: '10' });
    });

    it('should try to get item from cache for findOne using getQuery', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.getQuery = (query) => {
        expect(query).eq(JSON.stringify({ type: '11' }));
        return [{ _id: '11' }];
      };
      cache.get = (key) => {
        expect(key).eq('11');
        return { _id: '11' };
      };
      cache.set = (key, item) => {
        expect(key).eq('11');
      };
      await repo.add(<IEntity>{ _id: '11', type: '11' });
      await repo.findOne({ type: '11' });
    });

    it('should try to get item from db for findOne if getQuery failed', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.getQuery = (query) => {
        expect(query).eq(JSON.stringify({ type: '12' }));
        return undefined;
      };
      cache.get = (key) => {
        expect(key).eq('12');
        return { _id: '12' };
      };
      cache.set = (key, item) => {
        expect(key).eq('12');
      };
      cache.setQuery = (query, items) => {
        expect(query).eq(JSON.stringify({ type: '12' }));
        expect(items).deep.eq([{ key: '12', value: { _id: '12', type: '12' } }]);
      };
      // tslint:disable-next-line: no-string-literal
      repo['_collection'].findOne = (filter, options) => {
        expect(filter).deep.eq({ type: '12' });
        return Promise.resolve(<IEntity>{ _id: '12', type: '12' });
      };
      await repo.add(<IEntity>{ _id: '12', type: '12' });
      await repo.findOne({ type: '12' });
    });

    it('should not try to fetch from cache if projection is defined', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      repo['_collection'].findOne = (filter, options) => {
        expect(filter).deep.eq({ type: '13' });
        return Promise.resolve(<IEntity>{ _id: '13' });
      };
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(key).eq('13');
      };
      await repo.add(<IEntity>{ _id: '13', type: '13' });
      await repo.findOne({ type: '13' }, { _id: 1 });
    });

    it('should go to db if used findById with projection`', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      repo['_collection'].findOne = (filter, options) => {
        expect(filter).deep.eq({ _id: '14' });
        return Promise.resolve(<IEntity>{ _id: '14' });
      };
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(key).eq('14');
      };
      await repo.add(<IEntity>{ _id: '14', type: '14' });
      await repo.findById('14', { _id: 1 });
    });

    it('should go to db if used findById without projection and item is not in cache', async () => {
      const repo = uow.getRepository('c2');
      // tslint:disable-next-line: no-string-literal
      repo['_collection'].findOne = (filter, options) => {
        expect(filter).deep.eq({ _id: '15' });
        return Promise.resolve(<IEntity>{ _id: '15' });
      };
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(key).eq('15');
      };
      cache.get = (key) => undefined;
      await repo.add(<IEntity>{ _id: '15', type: '15' });
      await repo.findById('15');
    });

    it('should findMany using getQuery from cache', async () => {
      const repo = uow.getRepository('c2');
      const item = <IEntity>{ _id: '16', type: '16' };
      const query = { _id: '16' };
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(key).eq('16');
      };
      cache.setQuery = (queryString, items) => {
        expect(queryString).eq(JSON.stringify(query));
        expect(items).deep.eq([item]);
      };
      cache.getQuery = (queryString) => {
        expect(queryString).eq(JSON.stringify(query));
        return [item];
      };
      cache.get = (key) => item;
      await repo.add(item);
      const results = await repo.findMany(query);
      expect(results).deep.eq([item]);
    });

    it('should findMany from db if getQuery results in miss', async () => {
      const repo = uow.getRepository('c2');

      const item = <IEntity>{ _id: '17', type: '17' };
      const query = { _id: '17' };

      // tslint:disable-next-line: no-string-literal
      repo['_collection'].find = (filter, options) => {
        return { toArray: () => Promise.resolve([item]) };
      };
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(key).eq('17');
      };
      cache.setQuery = (queryString, items) => {
        expect(queryString).eq(JSON.stringify(query));
        expect(items).deep.eq([{ key: item._id, value: item }]);
      };
      cache.getQuery = (queryString) => {
        expect(queryString).eq(JSON.stringify(query));
        return undefined;
      };
      cache.get = (key) => item;
      await repo.add(item);
      const results = await repo.findMany(query);
      expect(results).deep.eq([item]);
    });

    it('should findMany from db and not cache the results if no any', async () => {
      const repo = uow.getRepository('c2');

      const query = { _id: '18' };

      // tslint:disable-next-line: no-string-literal
      repo['_collection'].find = (filter, options) => {
        return { toArray: () => Promise.resolve([]) };
      };
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(key).eq('18');
      };
      cache.setQuery = (queryString, items) => {
        expect(queryString).eq(JSON.stringify(query));
        expect(items).deep.eq([]);
      };
      cache.getQuery = (queryString) => {
        expect(queryString).eq(JSON.stringify(query));
        return undefined;
      };
      cache.get = (key) => undefined;
      const results = await repo.findMany(query);
      expect(results).deep.eq([]);
    });

    it('should findMany from db if projection is used', async () => {
      const repo = uow.getRepository('c2');

      const item = <IEntity>{ _id: '19', type: '19' };
      const query = { _id: '19' };

      // tslint:disable-next-line: no-string-literal
      repo['_collection'].find = (filter, options) => {
        return { toArray: () => Promise.resolve([item]) };
      };
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(key).eq('19');
      };
      cache.setQuery = (queryString, items) => {
        expect(queryString).eq(JSON.stringify(query));
        expect(items).deep.eq([{ key: item._id, value: item }]);
      };
      cache.getQuery = (queryString) => {
        expect(queryString).eq(JSON.stringify(query));
        return undefined;
      };
      cache.get = (key) => item;
      await repo.add(item);
      const results = await repo.findMany(query, { _id: 1 });
      expect(results).deep.eq([item]);
    });

    it('should cache items if not cached when findMany from db', async () => {
      const repo = uow.getRepository('c2');

      const item = <IEntity>{ _id: '20', type: '20' };
      const query = { _id: '20' };

      // tslint:disable-next-line: no-string-literal
      repo['_collection'].find = (filter, options) => {
        return { toArray: () => Promise.resolve([item]) };
      };
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(key).eq('20');
      };
      cache.setQuery = (queryString, items) => {
        expect(queryString).eq(JSON.stringify(query));
        expect(items).deep.eq([{ key: item._id, value: item }]);
      };
      cache.getQuery = (queryString) => {
        expect(queryString).eq(JSON.stringify(query));
        return undefined;
      };
      cache.get = (key) => undefined;
      await repo.add(item);
      const results = await repo.findMany(query);
      expect(results).deep.eq([item]);
    });

    it('should invalidate key if findOneAndUpdate', async () => {
      const repo = uow.getRepository('c2') as IRepository<{ name?: string; _id: string }>;

      const item = <IEntity>{ _id: '21', type: '21' };
      const query = { _id: '21' };

      // tslint:disable-next-line: no-string-literal
      repo['_collection'].findOneAndUpdate = (filter, update, options) => {
        return Promise.resolve({ value: item });
      };
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(key).eq('21');
      };
      cache.invalidateKey = (key, local) => {
        expect(key).eq('21');
        return Promise.resolve();
      };
      cache.get = (key) => item;
      const results = await repo.findOneAndUpdate(query, { $set: { name: 'hi' } }, { returnDocument: 'after' });
      expect(results).deep.eq(item);
    });

    it('should invalidate key even if findOneAndUpdate did not return', async () => {
      const repo = uow.getRepository('c2') as IRepository<{ name?: string; _id: string }>;

      const item = <IEntity>{ _id: '21', type: '21' };
      const query = { _id: '21' };

      // tslint:disable-next-line: no-string-literal
      repo['_collection'].findOneAndUpdate = (filter, update, options) => {
        return Promise.resolve({ value: undefined });
      };
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(key).eq('21');
      };
      cache.invalidateKey = (key, local) => {
        expect(key).eq('21');
        return Promise.resolve();
      };
      cache.get = (key) => item;
      const results = await repo.findOneAndUpdate(query, { $set: { name: 'hi' } }, { returnDocument: 'after' });
      expect(results).deep.eq(undefined);
    });

    it('should not cache the item if returnDocument is before', async () => {
      const repo = uow.getRepository('c2') as IRepository<{ name?: string; _id: string }>;

      const item = <IEntity>{ _id: '21', type: '21' };
      const query = { _id: '21' };

      // tslint:disable-next-line: no-string-literal
      repo['_collection'].findOneAndUpdate = (filter, update, options) => {
        return Promise.resolve({ value: item });
      };
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(true, 'Should not reach here').eq(false);
      };
      cache.invalidateKey = (key, local) => {
        expect(key).eq('21');
        return Promise.resolve();
      };
      cache.get = (key) => item;
      const results = await repo.findOneAndUpdate(query, { $set: { name: 'hi' } }, { returnDocument: 'before' });
      expect(results).deep.eq(item);
    });


    it('should not invalidate the cache if fitler does not include _id and result was not found', async () => {
      const repo = uow.getRepository('c2') as IRepository<{ name?: string; _id: string }>;

      const item = <IEntity>{ _id: '21', type: '21' };
      const query = { type: '21' };

      // tslint:disable-next-line: no-string-literal
      repo['_collection'].findOneAndUpdate = (filter, update, options) => {
        return Promise.resolve({ value: undefined });
      };
      // tslint:disable-next-line: no-string-literal
      const cache: ICache<string, IEntity> = repo['_cache'];
      cache.set = (key, item) => {
        expect(true, 'Should not reach here').eq(false);
      };
      cache.invalidateKey = (key, local) => {
        expect(true, 'Should not reach here').eq(false);
        return Promise.resolve();
      };
      cache.get = (key) => item;
      const results = await repo.findOneAndUpdate(query, { $set: { name: 'hi' } }, { returnDocument: 'after' });
      expect(results).deep.eq(undefined);
    });
  });

  describe('flatObject', () => {
    it('should flatten simple objects', async () => {
      const results = flatObj({ _id: 1, profile: { name: 'zaid' } });
      expect(results).deep.eq({ '_id': 1, 'profile.name': 'zaid' });
    });

    it('should flatten objects with dates', async () => {
      const now = new Date();
      const results = flatObj({ _id: 1, profile: { name: 'zaid', fromDate: now } });
      expect(results).deep.eq({ '_id': 1, 'profile.name': 'zaid', 'profile.fromDate': now });
    });

    it('should flatten objects with arrays', async () => {
      const now = new Date();
      const results = flatObj({ _id: 1, profile: { name: 'zaid', arr: [1, 2] } });
      expect(results).deep.eq({ '_id': 1, 'profile.name': 'zaid', 'profile.arr': [1, 2] });
    });
  });

  describe('AuditableRepository', () => {
    it('should add an item with created.at', async () => {

      const repo = uow.getRepository('c3') as AuditableRepository<IAuditable>;
      await repo.add({ _id: '24' });
      const result: IAuditable | undefined = await repo.findById('24');
      if (result) {
        expect(result._id).eq('24');
        expect(result.created?.at).lte(new Date());
        expect(result.created?.by).eq(undefined);
      }
    });

    it('should update an item with updated.at', async () => {
      const repo = uow.getRepository('c3') as IRepository<{ name?: string; _id: string }>;
      const result: IAuditable | undefined = await repo.findById('3');
      await repo.update({ _id: '3' }, { $set: { name: '1' } }, { upsert: true });
      if (result) {
        expect(result._id).eq('3');
        expect(result.created?.at).lte(new Date());
        expect(result.created?.by).eq(undefined);
        expect(result.updated?.at).lte(new Date());
        expect(result.updated?.by).eq(undefined);
      }
    });

    it('should add many items with auditable fields', async () => {
      const repo = uow.getRepository<IAuditable>('c3');
      const result = await repo.addMany([{ _id: '4' }, { _id: '5' }]);
      for (const obj of result) {
        expect(obj.created?.at).lte(new Date());
        expect(obj.created?.by).eq(undefined);
      }
    });

    it('should findOneAndUpdate an item with updated.at', async () => {
      const repo = uow.getRepository('c3') as IRepository<{ name?: string; _id: string }>;
      const result: IAuditable | undefined = await repo.findOneAndUpdate({ _id: '6' }, { $set: { name: '1' } }, { upsert: true });
      if (result) {
        expect(result._id).eq('6');
        expect(result.created?.by).eq(undefined);
        expect(result.updated?.by).eq(undefined);
      }
    });

    it('should patch an item with updated.at', async () => {
      const repo = uow.getRepository<{ _id: string, name?: string } & IAuditable>('c3');
      await repo.add({ _id: '7' });
      const result = await repo.patch({ _id: '7' }, { name: '1222' }, false);
      if (result) {
        expect(result._id).eq('7');
        expect(result.created?.at).lte(new Date());
        expect(result.created?.by).eq(undefined);
        expect(result.updated?.at).lte(new Date());
        expect(result.updated?.by).eq(undefined);
      } else {
        throw new Error('update was not done.');
      }
    });

  });

});

function sleep(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(() => {
      return resolve();
    }, ms);
  });
}

async function getMongoClient(): Promise<MongoClient> {
  return MongoClient.connect('mongodb://localhost:27017/db1');
}

function getMockedCollection(name: string, client: MongoClient, session?: ClientSession) {
  const collection: Collection<IAuditable> = client.collection(name, { session }, undefined);
  const cb = async (filter, options) => {
    const result = await collection.findOne(filter, options);
    await collection.deleteOne(filter);
    console.log('findOneAndDelete', filter, result);
    return { value: result };
  }
  collection.findOneAndDelete = <any>cb;
  return collection;
}
function getCache() {
  return <ICache<string, IEntity>>{

  };
}