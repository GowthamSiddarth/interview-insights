import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deleteManifest, listManifests, readManifest, SeedManifest, writeManifest } from './seed-manifest';

describe('seed-manifest', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-manifest-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function manifest(overrides: Partial<SeedManifest> = {}): SeedManifest {
    return {
      runId: 'run-1',
      createdAt: '2026-07-27T00:00:00.000Z',
      companyCount: 2,
      companyIds: ['company-1', 'company-2'],
      candidateIds: ['candidate-1', 'candidate-2', 'candidate-3'],
      ...overrides,
    };
  }

  it('writes a manifest and reads it back unchanged', () => {
    writeManifest(manifest(), dir);

    expect(readManifest('run-1', dir)).toEqual(manifest());
  });

  it('creates the target directory if it does not exist yet', () => {
    const nested = path.join(dir, 'nested', 'runs');

    writeManifest(manifest(), nested);

    expect(readManifest('run-1', nested)).toEqual(manifest());
  });

  it('throws for an unknown run id', () => {
    expect(() => readManifest('does-not-exist', dir)).toThrow();
  });

  it('lists manifests oldest-first', () => {
    writeManifest(manifest({ runId: 'run-b', createdAt: '2026-07-27T02:00:00.000Z' }), dir);
    writeManifest(manifest({ runId: 'run-a', createdAt: '2026-07-27T01:00:00.000Z' }), dir);

    expect(listManifests(dir).map((m) => m.runId)).toEqual(['run-a', 'run-b']);
  });

  it('returns an empty array when the directory does not exist', () => {
    expect(listManifests(path.join(dir, 'never-created'))).toEqual([]);
  });

  it('deletes a manifest, and is a no-op if it is already gone', () => {
    writeManifest(manifest(), dir);

    deleteManifest('run-1', dir);
    expect(listManifests(dir)).toEqual([]);

    expect(() => deleteManifest('run-1', dir)).not.toThrow();
  });
});
