import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AuditableRepository,
  BaseRepository,
  configureLogging,
  createJsonLogHandler,
  defaultPaging,
  getPackageLogger,
  IEntity,
  IRepository,
  resetLogging,
  UnitOfWork,
} from '../src/index';
import { flatObj } from '../src/utils/flatObj';
import { getFactory, Repositories } from '../src/interfaces/IRepositoryFactory';
import { IAuditable } from '../src/interfaces';

type Item = IEntity & {
  name?: string;
  nested?: { value?: number | null; keep?: string };
  created?: { at: Date; by?: string };
  updated?: { at: Date; by?: string };
  deleted?: { at: Date; by?: string };
};

afterEach(() => {
  resetLogging();
});

class FakeCursor<T extends IEntity> {
  private offset = 0;
  private count = Number.POSITIVE_INFINITY;
  private sorter?: { [field: string]: 1 | -1 };

  constructor(private readonly items: T[]) {}

  sort(sorter: { [field: string]: 1 | -1 }) {
    this.sorter = sorter;
    return this;
  }

  skip(offset: number) {
    this.offset = offset;
    return this;
  }

  limit(count: number) {
    this.count = count;
    return this;
  }

  async toArray() {
    let result = [...this.items];
    if (this.sorter) {
      const [field, direction] = Object.entries(this.sorter)[0];
      result = result.sort((a, b) => String(a[field]).localeCompare(String(b[field])) * direction);
    }
    return result.slice(this.offset, this.offset + this.count);
  }
}

class FakeCollection<T extends IEntity> {
  aggregateCalls: any[] = [];
  countCalls: any[] = [];
  deleteManyCalls: any[] = [];
  deleteOneCalls: any[] = [];
  findCalls: any[] = [];
  findOneCalls: any[] = [];
  findOneAndUpdateCalls: any[] = [];
  insertManyCalls: any[] = [];
  insertOneCalls: any[] = [];
  updateManyCalls: any[] = [];
  insertManyError?: any;
  nextFindOneAndUpdateResult?: unknown;
  nextFindOneAndDeleteResult?: unknown;

  constructor(private readonly items: T[] = []) {}

  aggregate(pipeline: object[], options?: object) {
    this.aggregateCalls.push({ pipeline, options });
    return new FakeCursor(this.items);
  }

  async countDocuments(filter: object, options?: object) {
    this.countCalls.push({ filter, options });
    return this.items.filter(item => matches(item, filter)).length;
  }

  async insertOne(item: T, options?: object) {
    this.insertOneCalls.push({ item, options });
    this.items.push(item);
    return { acknowledged: true, insertedId: item._id };
  }

  async insertMany(items: T[], options?: object) {
    this.insertManyCalls.push({ items, options });
    if (this.insertManyError) throw this.insertManyError;
    this.items.push(...items);
    return { acknowledged: true, insertedCount: items.length };
  }

  async findOneAndUpdate(filter: object, update: any, options?: any) {
    this.findOneAndUpdateCalls.push({ filter, update, options });
    if (this.nextFindOneAndUpdateResult !== undefined) {
      const result = this.nextFindOneAndUpdateResult;
      this.nextFindOneAndUpdateResult = undefined;
      return result;
    }
    let item = this.items.find(candidate => matches(candidate, filter));
    if (!item && options?.upsert) {
      item = { _id: String((filter as any)._id || `new-${this.items.length}`) } as T;
      this.items.push(item);
      applySet(item, update.$setOnInsert);
    }
    if (!item) return null;
    applySet(item, update.$set);
    applyUnset(item, update.$unset);
    return item;
  }

  async findOneAndDelete(filter: object, options?: object) {
    this.deleteOneCalls.push({ filter, options });
    if (this.nextFindOneAndDeleteResult !== undefined) {
      const result = this.nextFindOneAndDeleteResult;
      this.nextFindOneAndDeleteResult = undefined;
      return result;
    }
    const index = this.items.findIndex(item => matches(item, filter));
    if (index === -1) return null;
    return this.items.splice(index, 1)[0];
  }

  async deleteMany(filter: object, options?: object) {
    this.deleteManyCalls.push({ filter, options });
    const before = this.items.length;
    for (let index = this.items.length - 1; index >= 0; index--) {
      if (matches(this.items[index], filter)) this.items.splice(index, 1);
    }
    return { deletedCount: before - this.items.length };
  }

  async findOne(filter: object, options?: object) {
    this.findOneCalls.push({ filter, options });
    return this.items.find(item => matches(item, filter)) || null;
  }

  find(filter: object, options?: object) {
    this.findCalls.push({ filter, options });
    return new FakeCursor(this.items.filter(item => matches(item, filter)));
  }

  async updateMany(filter: object, update: any, options?: object) {
    this.updateManyCalls.push({ filter, update, options });
    let modifiedCount = 0;
    for (const item of this.items) {
      if (matches(item, filter)) {
        applySet(item, update.$set);
        applyUnset(item, update.$unset);
        modifiedCount++;
      }
    }
    return { acknowledged: true, matchedCount: modifiedCount, modifiedCount };
  }
}

class FakeSession {
  committed = false;
  ended = false;
  rolledBack = false;
  transaction = false;
  endError?: Error;

  inTransaction() {
    return this.transaction;
  }

  startTransaction() {
    this.transaction = true;
  }

  async commitTransaction() {
    this.committed = true;
    this.transaction = false;
  }

  async abortTransaction() {
    this.rolledBack = true;
    this.transaction = false;
  }

  async endSession() {
    if (this.endError) throw this.endError;
    this.ended = true;
  }
}

function getByPath(obj: any, path: string) {
  return path.split('.').reduce((current, part) => current && current[part], obj);
}

function setByPath(obj: any, path: string, value: unknown) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts.slice(0, -1)) {
    current[part] = current[part] || {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function unsetByPath(obj: any, path: string) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts.slice(0, -1)) {
    current = current && current[part];
  }
  if (current) delete current[parts[parts.length - 1]];
}

function applySet(obj: any, update?: object) {
  for (const [key, value] of Object.entries(update || {})) {
    setByPath(obj, key, value);
  }
}

function applyUnset(obj: any, update?: object) {
  for (const key of Object.keys(update || {})) {
    unsetByPath(obj, key);
  }
}

function matches(item: any, filter: any): boolean {
  return Object.entries(filter || {}).every(([key, expected]) => {
    const actual = getByPath(item, key);
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      if ('$in' in expected) return (expected as any).$in.includes(actual);
      if ('$exists' in expected) return (actual !== undefined) === (expected as any).$exists;
    }
    return actual === expected;
  });
}

function repository(collection = new FakeCollection<Item>([]), session?: FakeSession) {
  return new BaseRepository<Item>('items', collection as any, session as any);
}

function auditableRepository(
  collection = new FakeCollection<Item>([]),
  configs: object = {},
  session?: FakeSession
) {
  return new AuditableRepository<Item>('items', collection as any, session as any, {
    getCurrentTime: () => new Date('2026-05-27T00:00:00.000Z'),
    getUserId: () => 'user-1',
    softDelete: true,
    ...configs,
  });
}

test('package exports the supported v3 API', async () => {
  const api = await import('../src/index');
  assert.equal(typeof api.UnitOfWork, 'function');
  assert.equal(typeof api.BaseRepository, 'function');
  assert.equal(typeof api.AuditableRepository, 'function');
  assert.equal(typeof api.getFactory, 'function');
  assert.equal(typeof api.configureLogging, 'function');
  assert.equal(typeof api.resetLogging, 'function');
  assert.equal(typeof api.createJsonLogHandler, 'function');
  assert.equal(typeof api.getPackageLogger, 'function');
  assert.equal('BaseRepositoryWithCache' in api, false);
  assert.equal('ProtectedRepository' in api, false);
});

test('logging is silent by default and by explicit silent level', async () => {
  const records: unknown[] = [];
  configureLogging({ level: 'silent', handler: record => records.push(record) });
  const repo = repository();

  await repo.add({ _id: '1' });

  assert.equal(records.length, 0);
});

test('logging emits structured records at or above the configured level', async () => {
  const records: any[] = [];
  configureLogging({
    level: 'debug',
    handler: record => records.push(record),
    getTimestamp: () => '2026-05-27T00:00:00.000Z',
  });
  const session = new FakeSession();
  const collection = new FakeCollection<Item>();
  const repo = repository(collection, session);

  await repo.add({ _id: '1', name: 'a' });
  await repo.findOne({ _id: '1' });

  assert.equal(records.length, 0);

  configureLogging({
    level: 'trace',
    handler: record => records.push(record),
    getTimestamp: () => '2026-05-27T00:00:00.000Z',
  });
  await repo.findOne({ _id: '1' });

  assert.deepEqual(records[0], {
    timestamp: '2026-05-27T00:00:00.000Z',
    level: 'trace',
    namespace: 'BaseRepository',
    message: 'findOne',
    context: {
      collection: 'items',
      filter: { _id: '1' },
      projection: undefined,
      session: true,
    },
  });
});

test('logging writes JSON lines when configured with the JSON handler', async () => {
  const lines: string[] = [];
  configureLogging({
    level: 'debug',
    handler: createJsonLogHandler(line => lines.push(line)),
    getTimestamp: () => '2026-05-27T00:00:00.000Z',
  });
  const session = new FakeSession();
  const client = { startSession: () => session };
  const factory = (name: string, _client: object, repoSession?: FakeSession) => repository(new FakeCollection<Item>(), repoSession);
  const uow = new UnitOfWork(client as any, factory as any);

  uow.getRepository('items');
  await uow.commit();

  assert.deepEqual(lines.map(line => JSON.parse(line)), [
    {
      timestamp: '2026-05-27T00:00:00.000Z',
      level: 'debug',
      namespace: 'UnitOfWork',
      message: 'startSession',
      context: { hasTransaction: true },
    },
    {
      timestamp: '2026-05-27T00:00:00.000Z',
      level: 'debug',
      namespace: 'UnitOfWork',
      message: 'commit',
      context: { committed: true },
    },
  ]);
});

test('logging supports all package logger levels and default timestamps', () => {
  const records: any[] = [];
  configureLogging({ level: 'trace', handler: record => records.push(record) });
  const logger = getPackageLogger('Custom');

  logger.trace('trace-message');
  logger.debug('debug-message');
  logger.info('info-message');
  logger.warn('warn-message');
  logger.error('error-message');
  resetLogging();
  logger.error('ignored-after-reset');
  configureLogging({ level: 'trace' });
  logger.error('ignored-without-handler');

  assert.deepEqual(records.map(record => record.level), ['trace', 'debug', 'info', 'warn', 'error']);
  assert.deepEqual(records.map(record => record.message), [
    'trace-message',
    'debug-message',
    'info-message',
    'warn-message',
    'error-message',
  ]);
  assert.equal(typeof records[0].timestamp, 'string');
  assert.equal(records[0].namespace, 'Custom');
});

test('defaultPaging exposes the default page request', () => {
  assert.deepEqual(defaultPaging, { index: 0, size: 10 });
});

test('flatObj flattens objects and preserves arrays, nulls, undefined values, and dates', () => {
  const at = new Date('2026-05-27T00:00:00.000Z');
  assert.deepEqual(flatObj({
    name: 'a',
    nested: { value: 1, nil: null, missing: undefined },
    list: [1, 2],
    at,
  }), {
    name: 'a',
    'nested.value': 1,
    'nested.nil': null,
    'nested.missing': undefined,
    list: [1, 2],
    at,
  });
});

test('getFactory returns known repositories and rejects unknown names', () => {
  const collection = new FakeCollection<Item>();
  const repos: Repositories = {
    items: (name, client, session) => new BaseRepository(name, collection as any, session),
  };
  const factory = getFactory(repos);
  const repo = factory('items', {} as any);
  assert.equal(repo.name, 'items');
  assert.throws(() => factory('missing', {} as any), /unknown repository 'missing'/);
});

test('UnitOfWork defaults to transactions and reuses repositories by transaction mode', async () => {
  const session = new FakeSession();
  const client = { startSession: () => session };
  const created: Array<{ name: string; session?: FakeSession }> = [];
  const factory = (name: string, _client: object, repoSession?: FakeSession) => {
    created.push({ name, session: repoSession });
    return repository(new FakeCollection<Item>(), repoSession);
  };
  const uow = new UnitOfWork(client as any, factory as any);

  const writeRepo = uow.getRepository('items');
  const sameWriteRepo = uow.getRepository('items');
  const otherWriteRepo = uow.getRepository('other');
  const readRepo = uow.getRepository('items', false);

  assert.equal(writeRepo, sameWriteRepo);
  assert.notEqual(writeRepo, otherWriteRepo);
  assert.notEqual(writeRepo, readRepo);
  assert.equal(session.inTransaction(), true);
  assert.equal(created[0].session, session);
  assert.equal(created[1].session, session);
  assert.equal(created[2].session, undefined);
});

test('UnitOfWork honors disabled transactions and no-op commit and rollback without a session', async () => {
  const client = { startSession: () => assert.fail('startSession should not be called') };
  const factory = (name: string) => repository(new FakeCollection<Item>());
  const uow = new UnitOfWork(client as any, factory as any, { useTransactions: false });

  const repo = uow.getRepository('items');
  await uow.commit();
  await uow.rollback();
  await uow.dispose();

  assert.equal(repo.name, 'items');
});

test('UnitOfWork commits, rolls back, and disposes active sessions', async () => {
  const session = new FakeSession();
  const client = { startSession: () => session };
  const factory = (name: string, _client: object, repoSession?: FakeSession) => repository(new FakeCollection<Item>(), repoSession);
  const uow = new UnitOfWork(client as any, factory as any);

  uow.getRepository('items');
  await uow.commit();
  assert.equal(session.committed, true);
  await uow.commit();

  session.transaction = true;
  await uow.rollback();
  assert.equal(session.rolledBack, true);
  await uow.rollback();

  session.transaction = true;
  await uow.dispose();
  assert.equal(session.ended, true);
});

test('UnitOfWork propagates endSession failures during dispose', async () => {
  const session = new FakeSession();
  session.endError = new Error('end failed');
  const client = { startSession: () => session };
  const factory = (name: string, _client: object, repoSession?: FakeSession) => repository(new FakeCollection<Item>(), repoSession);
  const uow = new UnitOfWork(client as any, factory as any);

  uow.getRepository('items');
  await assert.rejects(() => uow.dispose(), /end failed/);
});

test('BaseRepository aggregates and counts with the active session', async () => {
  const session = new FakeSession();
  const collection = new FakeCollection<Item>([{ _id: '1', name: 'a' }]);
  const repo = repository(collection, session);

  assert.deepEqual(await repo.aggregate([{ $match: { name: 'a' } }], { allowDiskUse: true }), [{ _id: '1', name: 'a' }]);
  assert.equal(await repo.count({ name: 'a' }), 1);
  assert.equal(collection.aggregateCalls[0].options.session, session);
  assert.equal(collection.countCalls[0].options.session, session);
});

test('BaseRepository adds one item and emits add', async () => {
  const collection = new FakeCollection<Item>();
  const repo = repository(collection);
  let emitted: Item | undefined;
  repo.on('add', item => emitted = item);

  const item = await repo.add({ _id: '1', name: 'a' });

  assert.equal(item._id, '1');
  assert.equal(emitted, item);
  assert.deepEqual(collection.insertOneCalls[0].item, item);
  assert.equal(repo.changes.listeners('add').length, 1);
});

test('BaseRepository addMany returns inserted items and emits each successful add', async () => {
  const collection = new FakeCollection<Item>();
  const repo = repository(collection);
  const emitted: string[] = [];
  repo.on('add', item => emitted.push(item._id));

  const result = await repo.addMany([{ _id: '1' }, { _id: '2' }], false);

  assert.deepEqual(result.map(item => item._id), ['1', '2']);
  assert.deepEqual(emitted, ['1', '2']);
  assert.equal(collection.insertManyCalls[0].options.ordered, false);
});

test('BaseRepository addMany filters duplicate write errors and rethrows unknown errors', async () => {
  const collection = new FakeCollection<Item>();
  const repo = repository(collection);
  collection.insertManyError = { writeErrors: [{ err: { op: { _id: '2' } } }] };

  const result = await repo.addMany([{ _id: '1' }, { _id: '2' }]);

  assert.deepEqual(result.map(item => item._id), ['1']);
  collection.insertManyError = new Error('insert failed');
  await assert.rejects(() => repo.addMany([{ _id: '3' }]), /insert failed/);
  collection.insertManyError = { writeErrors: [] };
  await assert.rejects(() => repo.addMany([{ _id: '4' }]));
});

test('BaseRepository patches set and unset fields and rejects empty patches', async () => {
  const collection = new FakeCollection<Item>([{ _id: '1', name: 'old', nested: { keep: 'yes', value: 1 } }]);
  const repo = repository(collection);
  const updates: string[] = [];
  repo.on('update', item => updates.push(item._id));

  const updated = await repo.patch({ _id: '1' }, { _id: 'ignored', name: 'new', nested: { value: null } });

  assert.equal(updated?.name, 'new');
  assert.equal(updated?.nested?.value, undefined);
  assert.equal(updated?.nested?.keep, 'yes');
  assert.deepEqual(updates, ['1']);
  assert.deepEqual(collection.findOneAndUpdateCalls[0].update, {
    $set: { name: 'new' },
    $unset: { 'nested.value': '' },
  });
  await assert.rejects(() => repo.patch({ _id: '1' }, { _id: '1' }), /No changes submited/);
});

test('BaseRepository patch does not emit update when no document is found', async () => {
  const collection = new FakeCollection<Item>();
  const repo = repository(collection);
  let emitted = false;
  repo.on('update', () => emitted = true);

  const result = await repo.patch({ _id: 'missing' }, { name: 'new' });

  assert.equal(result, undefined);
  assert.equal(emitted, false);
});

test('BaseRepository patch supports unset-only changes', async () => {
  const collection = new FakeCollection<Item>([{ _id: '1', nested: { value: 1 } }]);
  const repo = repository(collection);

  const result = await repo.patch({ _id: '1' }, { nested: { value: undefined } });

  assert.equal(result?.nested?.value, undefined);
  assert.deepEqual(collection.findOneAndUpdateCalls[0].update, {
    $unset: { 'nested.value': '' },
  });
});

test('BaseRepository supports legacy find-and-modify result wrappers', async () => {
  const collection = new FakeCollection<Item>();
  collection.nextFindOneAndUpdateResult = { value: { _id: '1', name: 'wrapped' } };
  const repo = repository(collection);

  const result = await repo.findOneAndUpdate({ _id: '1' }, { $set: { name: 'x' } });

  assert.deepEqual(result, { _id: '1', name: 'wrapped' });
  collection.nextFindOneAndUpdateResult = { value: null };
  assert.equal(await repo.findOneAndUpdate({ _id: '2' }, { $set: { name: 'x' } }), undefined);
  collection.nextFindOneAndUpdateResult = 'primitive-result';
  assert.equal(await (repo as any).findOneAndUpdate({ _id: '3' }, { $set: { name: 'x' } }), 'primitive-result');
});

test('BaseRepository deletes one item and many items', async () => {
  const collection = new FakeCollection<Item>([{ _id: '1' }, { _id: '2' }, { _id: '3' }]);
  const repo = repository(collection);
  const deletedEvents: Array<Item | undefined> = [];
  repo.on('delete', item => deletedEvents.push(item));

  assert.deepEqual(await repo.deleteOne({ _id: '1' }), { _id: '1' });
  assert.equal(await repo.deleteOne({ _id: 'missing' }), undefined);
  assert.equal(await repo.deleteMany({ _id: { $in: ['2', '3'] } } as any), 2);
  assert.deepEqual(deletedEvents.map(item => item && item._id), ['1', undefined]);
});

test('BaseRepository finds one, finds by id, finds many, and paginates', async () => {
  const collection = new FakeCollection<Item>([
    { _id: '1', name: 'b' },
    { _id: '2', name: 'a' },
    { _id: '3', name: 'c' },
  ]);
  const repo = repository(collection);

  assert.equal((await repo.findOne({ name: 'a' }))?._id, '2');
  assert.equal(await repo.findOne({ name: 'missing' }), undefined);
  assert.equal((await repo.findById('1'))?.name, 'b');
  assert.equal(await repo.findById('missing'), undefined);
  assert.deepEqual((await repo.findMany({ _id: { $in: ['1', '3'] } } as any)).map(item => item._id), ['1', '3']);
  assert.deepEqual(await repo.findManyPage({}, { index: 1, size: 1, sorter: { name: 1 } }), {
    index: 2,
    size: 1,
    total: 3,
    items: [{ _id: '1', name: 'b' }],
  });
});

test('BaseRepository updates many and returns findOneAndUpdate results', async () => {
  const collection = new FakeCollection<Item>([{ _id: '1', name: 'old' }, { _id: '2', name: 'old' }]);
  const repo = repository(collection);

  const result = await repo.update({ name: 'old' }, { $set: { name: 'new' } });
  assert.equal((result as any).modifiedCount, 2);
  assert.equal((await repo.findOneAndUpdate({ _id: '1' }, { $set: { name: 'newer' } }))?.name, 'newer');
  assert.equal(await repo.findOneAndUpdate({ _id: 'missing' }, { $set: { name: 'x' } }), undefined);
  assert.equal(collection.updateManyCalls[0].options.session, undefined);
});

test('AuditableRepository adds created audit fields with current user', async () => {
  const collection = new FakeCollection<Item>();
  const repo = auditableRepository(collection);

  const item = await repo.add({ _id: '1' });
  const many = await repo.addMany([{ _id: '2' }]);

  assert.deepEqual(item.created, { at: new Date('2026-05-27T00:00:00.000Z'), by: 'user-1' });
  assert.deepEqual(many[0].created, { at: new Date('2026-05-27T00:00:00.000Z'), by: 'user-1' });
});

test('AuditableRepository uses default configs when none are supplied', async () => {
  const repo = new AuditableRepository<Item>('items', new FakeCollection<Item>() as any);

  const item = await repo.add({ _id: '1' });

  assert.equal(item.created?.at instanceof Date, true);
  assert.equal(item.created?.by, undefined);
});

test('AuditableRepository omits audit user when getUserId returns undefined', async () => {
  const repo = auditableRepository(new FakeCollection<Item>(), { getUserId: () => undefined });

  const item = await repo.add({ _id: '1' });

  assert.deepEqual(item.created, { at: new Date('2026-05-27T00:00:00.000Z') });
});

test('AuditableRepository applies deleted filters to reads and counts', async () => {
  const collection = new FakeCollection<Item>([
    { _id: '1', name: 'active' },
    { _id: '2', name: 'deleted', deleted: { at: new Date('2026-05-27T00:00:00.000Z') } },
  ]);
  const repo = auditableRepository(collection);

  assert.equal(await repo.count({}), 1);
  assert.equal((await repo.findOne({ name: 'active' }))?._id, '1');
  assert.deepEqual((await repo.findMany({})).map(item => item._id), ['1']);
  assert.equal((await repo.findManyPage({}, { index: 0, size: 10 })).total, 1);
});

test('AuditableRepository can disable soft-delete filters', async () => {
  const collection = new FakeCollection<Item>([
    { _id: '1' },
    { _id: '2', deleted: { at: new Date('2026-05-27T00:00:00.000Z') } },
  ]);
  const repo = auditableRepository(collection, { softDelete: false });

  assert.equal(await repo.count({}), 2);
  assert.equal(await repo.deleteMany({ _id: '2' }), 1);
  assert.equal(await repo.deleteOne({ _id: '1' })?.then(item => item?._id), '1');
});

test('AuditableRepository patches only non-empty updates with updated audit fields', async () => {
  const collection = new FakeCollection<Item>([{ _id: '1', name: 'old' }]);
  const repo = auditableRepository(collection);

  const updated = await repo.patch({ _id: '1' }, { name: 'new' });

  assert.equal(updated?.name, 'new');
  assert.deepEqual(updated?.updated, { at: new Date('2026-05-27T00:00:00.000Z'), by: 'user-1' });
  await assert.rejects(() => repo.patch({ _id: '1' }, {}), /No changes submited/);
});

test('AuditableRepository soft deletes one and many items', async () => {
  const collection = new FakeCollection<Item>([{ _id: '1' }, { _id: '2' }]);
  const repo = auditableRepository(collection);

  const deleted = await repo.deleteOne({ _id: '1' });
  const count = await repo.deleteMany({ _id: '2' });

  assert.deepEqual(deleted?.deleted, { at: new Date('2026-05-27T00:00:00.000Z'), by: 'user-1' });
  assert.equal(count, 1);
  assert.deepEqual(collection.updateManyCalls[0].update.$set.deleted, { at: new Date('2026-05-27T00:00:00.000Z'), by: 'user-1' });
});

test('AuditableRepository adds audit fields to update and findOneAndUpdate', async () => {
  const collection = new FakeCollection<Item>([{ _id: '1', name: 'old' }, { _id: '2', name: 'old' }]);
  const repo = auditableRepository(collection);

  await repo.update({ name: 'old' }, { $set: { name: 'new' } });
  await repo.update({ name: 'new' }, { $set: { name: 'new-again' } }, {});
  const updated = await repo.findOneAndUpdate({ _id: '1' }, { $set: { name: 'newer' } }, { upsert: true });
  await repo.findOneAndUpdate({ _id: '2' }, { $set: { name: 'no-options' } });
  const upserted = await repo.findOneAndUpdate({ _id: '3' }, { $set: { name: 'created' } }, { upsert: true });

  assert.deepEqual(collection.updateManyCalls[0].update.$set.updated, { at: new Date('2026-05-27T00:00:00.000Z'), by: 'user-1' });
  assert.equal(updated?.updated?.by, 'user-1');
  assert.equal(upserted?.created?.by, 'user-1');
  assert.equal(upserted?.updated?.by, 'user-1');
});

test('AuditableRepository preserves existing $setOnInsert fields during upsert audit', () => {
  const repo = auditableRepository();

  const update = repo.addAuditableFields({ $set: { name: 'a' }, $setOnInsert: { name: 'insert' } } as any, true);

  assert.deepEqual((update as any).$setOnInsert, {
    created: { at: new Date('2026-05-27T00:00:00.000Z'), by: 'user-1' },
    name: 'insert',
  });
});

test('AuditableRepository adds $set when update has no $set operator', () => {
  const repo = auditableRepository();

  const update = repo.addAuditableFields({ $unset: { name: '' } } as any);

  assert.deepEqual((update as any).$set.updated, { at: new Date('2026-05-27T00:00:00.000Z'), by: 'user-1' });
});

test('AuditableRepository injects aggregate deleted filters', async () => {
  const collection = new FakeCollection<Item>();
  const repo = auditableRepository(collection);

  await repo.aggregate([{ $match: { name: 'a' } }, { $project: { name: 1 } }]);
  await repo.aggregate([{ $project: { name: 1 } }]);
  await repo.aggregate([]);
  await repo.aggregate(['raw-stage' as any]);

  assert.deepEqual(collection.aggregateCalls[0].pipeline, [
    { $match: { deleted: { $exists: false }, name: 'a' } },
    { $project: { name: 1 } },
  ]);
  assert.deepEqual(collection.aggregateCalls[1].pipeline, [
    { $match: { deleted: { $exists: false } } },
    { $project: { name: 1 } },
  ]);
  assert.deepEqual(collection.aggregateCalls[2].pipeline, [
    { $match: { deleted: { $exists: false } } },
  ]);
  assert.deepEqual(collection.aggregateCalls[3].pipeline, [
    { $match: { deleted: { $exists: false } } },
    'raw-stage',
  ]);
});

test('AuditableRepository leaves aggregate pipelines unchanged when soft delete is disabled', async () => {
  const collection = new FakeCollection<Item>();
  const repo = auditableRepository(collection, { softDelete: false });
  const pipeline = [{ $project: { name: 1 } }];

  await repo.aggregate(pipeline);

  assert.equal(collection.aggregateCalls[0].pipeline, pipeline);
});
