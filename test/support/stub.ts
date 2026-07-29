/**
 * Minimal module-stubbing helper.
 *
 * The suite boots the real `createNestApp`, so the real middleware ordering,
 * the real `AppModule` wiring, real Passport, real Zod validators, real Multer
 * and the real `errorHandler` are all under test. Only the leaves that perform
 * I/O — Mongo, Cloudinary storage, the AI clients, mailers, cron — are replaced,
 * by seeding `require.cache` before `src/main.ts` is first imported.
 *
 * Seeding the cache (rather than a DI override) is deliberate: `app.module.ts`
 * imports `ensureDatabaseConnection` and `upload` as plain module bindings, and
 * the point of these tests is to exercise that real wiring rather than a
 * test-only rearrangement of it.
 */
import Module from "module";
import path from "path";

const SRC = path.resolve(__dirname, "..", "..", "src");

type Recorder = { calls: number };

const recorders = new Map<string, Recorder>();

/** Call counter for a named stub, used to assert middleware runs exactly once. */
export const recorder = (name: string): Recorder => {
  let r = recorders.get(name);
  if (!r) {
    r = { calls: 0 };
    recorders.set(name, r);
  }
  return r;
};

export const resetRecorders = (): void => {
  for (const r of recorders.values()) r.calls = 0;
};

/**
 * Registers `exports` as the resolved module for `src/<relative>`, so any later
 * `import`/`require` of that path receives the stub instead of loading the real
 * file.
 */
export const stubModule = (relative: string, exports: unknown): void => {
  const resolved = require.resolve(path.join(SRC, relative));
  const stub = new Module(resolved, undefined);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[resolved] = stub;
};

/** Stubs a node_modules package by id (used for the Cloudinary storage engine). */
export const stubPackage = (id: string, exports: unknown): void => {
  const resolved = require.resolve(id);
  const stub = new Module(resolved, undefined);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[resolved] = stub;
};
