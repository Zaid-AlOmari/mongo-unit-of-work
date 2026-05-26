# Changelog

## 3.0.0

### Breaking Changes

- Removed `BaseRepositoryWithCache`.
- Removed `ProtectedRepository`.
- Removed `ICache`.
- Removed `IRepositoryWithCache`.
- Removed `IProtectedResource`.
- Removed `ResourceAccess`.
- Removed `Access`.
- Raised the Node.js requirement to `>=20.19.0`.

### Changed

- Upgraded to MongoDB driver `7.2.0`.
- Replaced Mocha, Chai, sinon-chai, and nyc with Node's built-in test runner and coverage.
- Replaced direct log4js API usage with a package-owned structured logging API.
- Added opt-in JSON logging support with levels from `trace` through `error`, plus `silent`.
- Updated repository find-and-modify handling for MongoDB driver 7 document return values.
- Updated `UnitOfWork.dispose()` to use the promise-based session API.
- Added 100% line, branch, and function coverage enforcement.

### Security

- Removed vulnerable development dependency chains reported by `npm audit`.
