# mongo-unit-of-work

MongoDB repositories with a small unit-of-work abstraction for transaction-scoped operations.

## Requirements

- Node.js `>=20.19.0`
- MongoDB Node.js driver `7.x`
- MongoDB replica set or sharded cluster when using transactions

## Installation

```bash
npm install mongo-unit-of-work mongodb
```

## Quick Start

```ts
import { MongoClient } from 'mongodb';
import {
  BaseRepository,
  IEntity,
  UnitOfWork,
  getFactory,
} from 'mongo-unit-of-work';

interface User extends IEntity {
  email: string;
}

const client = new MongoClient(process.env.MONGODB_URI || '');
await client.connect();

const db = client.db('app');
const repositories = {
  users: (name, _client, session) =>
    new BaseRepository<User>(name, db.collection<User>('users'), session),
};

const unitOfWork = new UnitOfWork(client, getFactory(repositories));
const users = unitOfWork.getRepository<User>('users');

await users.add({ _id: 'user-1', email: 'user@example.com' });
await unitOfWork.commit();
await unitOfWork.dispose();
```

## Repository Factory

`UnitOfWork` receives a repository factory. The helper `getFactory` maps repository names to constructors and throws when a name is unknown.

```ts
import { getFactory } from 'mongo-unit-of-work';

const factory = getFactory({
  users: (name, client, session) =>
    new BaseRepository(name, client.db().collection('users'), session),
});
```

Repositories created with transactions enabled receive the active `ClientSession`. Repositories created with `withTransaction = false` do not receive a session.

## Transactions

Transactions are enabled by default.

```ts
const uow = new UnitOfWork(client, factory);
const repo = uow.getRepository('users');

try {
  await repo.add({ _id: '1' });
  await uow.commit();
} catch (error) {
  await uow.rollback();
  throw error;
} finally {
  await uow.dispose();
}
```

Disable default transactions when you only need repository grouping:

```ts
const uow = new UnitOfWork(client, factory, { useTransactions: false });
```

You can also opt out per repository:

```ts
const repo = uow.getRepository('users', false);
```

## Logging

The package is silent by default. Enable logging explicitly from your application entry point.

```ts
import {
  configureLogging,
  createJsonLogHandler,
} from 'mongo-unit-of-work';

configureLogging({
  level: 'info',
  handler: createJsonLogHandler(line => {
    process.stdout.write(line + '\n');
  }),
});
```

Available levels are:

- `trace`
- `debug`
- `info`
- `warn`
- `error`
- `silent`

Repository operation logs use structured context. For example:

```json
{
  "timestamp": "2026-05-27T00:00:00.000Z",
  "level": "trace",
  "namespace": "BaseRepository",
  "message": "findOne",
  "context": {
    "collection": "users",
    "filter": { "_id": "user-1" },
    "session": true
  }
}
```

Use a custom handler to send logs to an application logger:

```ts
configureLogging({
  level: 'debug',
  handler: record => appLogger.debug(record),
});
```

Call `resetLogging()` in tests if you need to restore the silent default.

## BaseRepository API

`BaseRepository<T extends IEntity>` provides:

- `add(item)`
- `addMany(items, ordered?)`
- `patch(filter, item, upsert?)`
- `update(filter, update, options?)`
- `deleteOne(filter)`
- `deleteMany(filter)`
- `findOne(filter, projection?)`
- `findById(id, projection?)`
- `findMany(filter, projection?)`
- `findManyPage(filter, paging, projection?)`
- `findOneAndUpdate(filter, update, options?)`
- `aggregate(pipeline, options?)`
- `count(filter)`

It also exposes an `EventEmitter` through `changes` and `on(event, callback)` for `add`, `update`, and `delete` events.

## AuditableRepository

`AuditableRepository<T extends IAuditable>` extends `BaseRepository` and manages audit fields:

- `created` is set on `add` and `addMany`.
- `updated` is set on `patch`, `update`, and `findOneAndUpdate`.
- `deleted` is set for soft deletes when `softDelete` is enabled.

```ts
const repo = new AuditableRepository(
  'users',
  db.collection('users'),
  session,
  {
    softDelete: true,
    getUserId: () => currentUser.id,
    getCurrentTime: () => new Date(),
  }
);
```

Soft delete is enabled by default. When enabled, reads and counts automatically exclude documents where `deleted` exists.

## Paging

```ts
const page = await repo.findManyPage(
  { email: /@example.com$/ },
  { index: 0, size: 20, sorter: { email: 1 } }
);
```

`index` is zero-based in the request. The returned page uses `index + 1`, matching the package's historical behavior.

## v3 Migration Notes

Version `3.0.0` removes cache and protected-resource repositories:

- Removed `BaseRepositoryWithCache`
- Removed `ProtectedRepository`
- Removed `ICache`
- Removed `IRepositoryWithCache`
- Removed `IProtectedResource`
- Removed `ResourceAccess`
- Removed `Access`

Move caching and authorization concerns into application-specific repository wrappers or service layers. The package now focuses on unit-of-work, base repository, and audit behavior.

The package also requires Node.js `>=20.19.0` because MongoDB driver 7 requires it.

## Development

```bash
npm install
npm run build
npm run type-check
npm run lint
npm test
```

`npm test` compiles the TypeScript tests and runs Node's built-in test runner with 100% line, branch, and function coverage thresholds.

## License

MIT

## Maintainer

Zaid Al-Omari
