import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '@tursodatabase/database';
import { KvStore } from '../src/kvstore.js';
import { AgentFS as Filesystem } from '../src/filesystem/index.js';
import { ToolCalls } from '../src/toolcalls.js';
import {
  // Types
  type OOSSMetadata,
  type AccessHookContext,
  PermissionDeniedError,
  // Permission Hooks
  PermissionHooks,
  createPermissionHooks,
  createPatternAccessHook,
  // Metadata
  setOOSSMetadata,
  getOOSSMetadata,
  updateOOSSMetadata,
  deleteOOSSMetadata,
  hasOOSSMetadata,
  getWorkspaceId,
  getAllowedPaths,
  getDeniedPaths,
  createDefaultMetadata,
  // Convex Streaming
  ConvexToolcallStreamer,
  createConvexStreamer,
  // Protected FS
  ProtectedFileSystem,
  createProtectedFS,
} from '../src/integrations/ooss/index.js';

describe('OOSS Integration', () => {
  let db: Database;
  let kv: KvStore;
  let fs: Filesystem;
  let tools: ToolCalls;

  beforeEach(async () => {
    db = new Database(':memory:');
    await db.connect();
    kv = await KvStore.fromDatabase(db);
    fs = await Filesystem.fromDatabase(db);
    tools = await ToolCalls.fromDatabase(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('OOSS Metadata', () => {
    it('should set and get complete metadata', async () => {
      const metadata: OOSSMetadata = {
        workspaceId: 'ws_test',
        workloadId: 'wl_test',
        sandboxId: 'sbx_test',
        trustClass: 'agent',
        allowedPaths: ['/workspace/**'],
        deniedPaths: ['/workspace/.env'],
        createdAt: Date.now(),
      };

      await setOOSSMetadata(kv, metadata);
      const retrieved = await getOOSSMetadata(kv);

      expect(retrieved).toEqual(metadata);
    });

    it('should check if metadata exists', async () => {
      expect(await hasOOSSMetadata(kv)).toBe(false);

      await setOOSSMetadata(kv, createDefaultMetadata('ws', 'wl', 'sbx'));

      expect(await hasOOSSMetadata(kv)).toBe(true);
    });

    it('should update partial metadata', async () => {
      await setOOSSMetadata(kv, createDefaultMetadata('ws', 'wl', 'sbx'));
      
      await updateOOSSMetadata(kv, {
        trustClass: 'admin',
        allowedPaths: ['/admin/**'],
      });

      const updated = await getOOSSMetadata(kv);
      expect(updated?.trustClass).toBe('admin');
      expect(updated?.allowedPaths).toEqual(['/admin/**']);
      expect(updated?.workspaceId).toBe('ws'); // Unchanged
    });

    it('should delete metadata', async () => {
      await setOOSSMetadata(kv, createDefaultMetadata('ws', 'wl', 'sbx'));
      expect(await hasOOSSMetadata(kv)).toBe(true);

      await deleteOOSSMetadata(kv);
      expect(await hasOOSSMetadata(kv)).toBe(false);
    });

    it('should get individual metadata fields', async () => {
      await setOOSSMetadata(kv, createDefaultMetadata('ws_123', 'wl_456', 'sbx_789', 'agent'));

      expect(await getWorkspaceId(kv)).toBe('ws_123');
      expect(await getAllowedPaths(kv)).toEqual([]);
      expect(await getDeniedPaths(kv)).toEqual([]);
    });
  });

  describe('Permission Hooks', () => {
    it('should allow all operations when no hook is set', async () => {
      const hooks = createPermissionHooks();
      
      const result = await hooks.checkAccess('read', '/any/path');
      expect(result.allowed).toBe(true);
      expect(result.source).toBe('local');
    });

    it('should call hook and respect its decision', async () => {
      const hooks = createPermissionHooks();
      let hookCalled = false;

      hooks.setAccessHook(async (ctx: AccessHookContext) => {
        hookCalled = true;
        return ctx.path.startsWith('/allowed');
      });

      const allowed = await hooks.checkAccess('read', '/allowed/file.txt');
      expect(allowed.allowed).toBe(true);
      expect(hookCalled).toBe(true);

      const denied = await hooks.checkAccess('read', '/denied/file.txt');
      expect(denied.allowed).toBe(false);
    });

    it('should throw PermissionDeniedError on denied access', async () => {
      const hooks = createPermissionHooks();
      hooks.setAccessHook(async () => false);

      await expect(
        hooks.checkAccessOrThrow('write', '/some/path')
      ).rejects.toThrow(PermissionDeniedError);
    });

    it('should check local patterns from metadata', async () => {
      await setOOSSMetadata(kv, {
        workspaceId: 'ws',
        workloadId: 'wl',
        sandboxId: 'sbx',
        trustClass: 'agent',
        allowedPaths: ['/workspace/**'],
        deniedPaths: ['/workspace/secrets/**'],
        createdAt: Date.now(),
      });

      const hooks = createPermissionHooks(kv);
      hooks.setAccessHook(async () => true); // Hook would allow, but local patterns should deny

      // Allowed path
      const allowed = await hooks.checkAccess('read', '/workspace/code.ts');
      expect(allowed.allowed).toBe(true);

      // Denied path (matches denied pattern)
      const denied = await hooks.checkAccess('read', '/workspace/secrets/key.txt');
      expect(denied.allowed).toBe(false);
      expect(denied.source).toBe('local');
    });

    it('should create pattern-based access hook', async () => {
      const hook = createPatternAccessHook(
        ['/workspace/**', '/tmp/**'],
        ['/workspace/.git/**']
      );

      expect(await hook({ operation: 'read', path: '/workspace/src/index.ts' })).toBe(true);
      expect(await hook({ operation: 'read', path: '/tmp/temp.txt' })).toBe(true);
      expect(await hook({ operation: 'read', path: '/workspace/.git/config' })).toBe(false);
      expect(await hook({ operation: 'read', path: '/root/secret' })).toBe(false);
    });
  });

  describe('Protected Filesystem', () => {
    it('should allow operations when no hook is set', async () => {
      const protectedFs = createProtectedFS(fs);

      await protectedFs.writeFile('/test.txt', 'hello');
      const content = await protectedFs.readFile('/test.txt', 'utf8');
      expect(content).toBe('hello');
    });

    it('should block operations when hook denies', async () => {
      const protectedFs = createProtectedFS(fs);
      
      protectedFs.setAccessHook(async (ctx) => {
        return ctx.operation !== 'write';
      });

      await expect(
        protectedFs.writeFile('/blocked.txt', 'content')
      ).rejects.toThrow(PermissionDeniedError);
    });

    it('should allow operations when hook permits', async () => {
      const protectedFs = createProtectedFS(fs);
      
      protectedFs.setAccessHook(async (ctx) => {
        return ctx.path.startsWith('/allowed');
      });

      await protectedFs.mkdir('/allowed');
      await protectedFs.writeFile('/allowed/test.txt', 'hello');
      
      const content = await protectedFs.readFile('/allowed/test.txt', 'utf8');
      expect(content).toBe('hello');
    });

    it('should clear access hook', async () => {
      const protectedFs = createProtectedFS(fs);
      
      protectedFs.setAccessHook(async () => false);
      await expect(protectedFs.mkdir('/test')).rejects.toThrow();

      protectedFs.clearAccessHook();
      await protectedFs.mkdir('/test'); // Should succeed now
    });
  });

  describe('Convex Toolcall Streamer', () => {
    it('should create streamer with config', () => {
      const mockClient = {
        mutation: vi.fn().mockResolvedValue({}),
      };

      const streamer = createConvexStreamer(tools, {
        convexClient: mockClient,
        mutationPath: 'sandbox:recordToolcalls',
        batchSize: 5,
        flushIntervalMs: 500,
      });

      expect(streamer).toBeInstanceOf(ConvexToolcallStreamer);
      expect(streamer.isActive()).toBe(false);
    });

    it('should start and stop correctly', async () => {
      const mockClient = {
        mutation: vi.fn().mockResolvedValue({}),
      };

      const streamer = createConvexStreamer(tools, {
        convexClient: mockClient,
        mutationPath: 'sandbox:recordToolcalls',
      });

      streamer.start();
      expect(streamer.isActive()).toBe(true);

      await streamer.stop();
      expect(streamer.isActive()).toBe(false);
    });

    it('should update OOSS context', () => {
      const mockClient = {
        mutation: vi.fn().mockResolvedValue({}),
      };

      const streamer = createConvexStreamer(tools, {
        convexClient: mockClient,
        mutationPath: 'sandbox:recordToolcalls',
      });

      streamer.setOOSSContext({
        workspaceId: 'ws_new',
        sandboxId: 'sbx_new',
      });

      // Context is set - we can't easily verify without exposing internals
      // but the method should not throw
    });
  });

  describe('Pattern Matching', () => {
    it('should match simple paths', async () => {
      const hook = createPatternAccessHook(['/workspace/file.txt']);
      
      expect(await hook({ operation: 'read', path: '/workspace/file.txt' })).toBe(true);
      expect(await hook({ operation: 'read', path: '/workspace/other.txt' })).toBe(false);
    });

    it('should match single wildcard', async () => {
      const hook = createPatternAccessHook(['/workspace/*.ts']);
      
      expect(await hook({ operation: 'read', path: '/workspace/index.ts' })).toBe(true);
      expect(await hook({ operation: 'read', path: '/workspace/app.ts' })).toBe(true);
      expect(await hook({ operation: 'read', path: '/workspace/src/index.ts' })).toBe(false);
    });

    it('should match double wildcard', async () => {
      const hook = createPatternAccessHook(['/workspace/**']);
      
      expect(await hook({ operation: 'read', path: '/workspace/index.ts' })).toBe(true);
      expect(await hook({ operation: 'read', path: '/workspace/src/index.ts' })).toBe(true);
      expect(await hook({ operation: 'read', path: '/workspace/src/deep/file.ts' })).toBe(true);
      expect(await hook({ operation: 'read', path: '/other/file.ts' })).toBe(false);
    });

    it('should handle denied patterns taking precedence', async () => {
      const hook = createPatternAccessHook(
        ['/workspace/**'],
        ['/workspace/node_modules/**']
      );
      
      expect(await hook({ operation: 'read', path: '/workspace/src/index.ts' })).toBe(true);
      expect(await hook({ operation: 'read', path: '/workspace/node_modules/lodash/index.js' })).toBe(false);
    });
  });
});
