/**
 * End-to-end bot scenarios (test/e2e): the whole app against real Postgres and
 * Redis, Telegram faked over HTTP. Run with `pnpm test:e2e`; needs
 * `docker compose up -d` locally, and CI starts both as service containers.
 * One worker: the suites share one database.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'test',
  testRegex: '.*\\.e2e-spec\\.ts$',
  testTimeout: 60_000,
  maxWorkers: 1,
  // BullMQ and pg keep sockets that close a moment after app.close().
  forceExit: true,
  moduleNameMapper: {
    '^@jobradar/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
  },
};
