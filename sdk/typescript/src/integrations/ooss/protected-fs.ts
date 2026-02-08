/**
 * Protected Filesystem Wrapper for OOSS
 * 
 * Wraps an AgentFS filesystem with permission hooks, automatically checking
 * access on every operation before delegating to the underlying filesystem.
 */

import type {
  FileSystem,
  Stats,
  DirEntry,
  FilesystemStats,
  FileHandle,
} from '../../filesystem/interface.js';
import type { KvStore } from '../../kvstore.js';
import type { AccessHook, FileOperation } from './types.js';
import { PermissionHooks } from './permission-hooks.js';

/**
 * A filesystem wrapper that enforces permission hooks on all operations
 */
export class ProtectedFileSystem implements FileSystem {
  private fs: FileSystem;
  private hooks: PermissionHooks;

  constructor(fs: FileSystem, kv?: KvStore) {
    this.fs = fs;
    this.hooks = new PermissionHooks(kv);
  }

  /**
   * Set the access hook for permission checks
   */
  setAccessHook(hook: AccessHook): void {
    this.hooks.setAccessHook(hook);
  }

  /**
   * Clear the access hook
   */
  clearAccessHook(): void {
    this.hooks.clearAccessHook();
  }

  /**
   * Get the underlying permission hooks manager
   */
  getPermissionHooks(): PermissionHooks {
    return this.hooks;
  }

  /**
   * Get the underlying filesystem
   */
  getUnderlyingFS(): FileSystem {
    return this.fs;
  }

  // FileSystem interface implementation with permission checks

  async stat(path: string): Promise<Stats> {
    await this.checkAccess('stat', path);
    return this.fs.stat(path);
  }

  async lstat(path: string): Promise<Stats> {
    await this.checkAccess('stat', path);
    return this.fs.lstat(path);
  }

  readFile(path: string): Promise<Buffer>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readFile(path: string, options: { encoding: BufferEncoding }): Promise<string>;
  async readFile(
    path: string,
    options?: BufferEncoding | { encoding?: BufferEncoding }
  ): Promise<Buffer | string> {
    await this.checkAccess('read', path);
    return this.fs.readFile(path, options as any);
  }

  async writeFile(
    path: string,
    data: string | Buffer,
    options?: BufferEncoding | { encoding?: BufferEncoding }
  ): Promise<void> {
    await this.checkAccess('write', path);
    return this.fs.writeFile(path, data, options);
  }

  async readdir(path: string): Promise<string[]> {
    await this.checkAccess('readdir', path);
    return this.fs.readdir(path);
  }

  async readdirPlus(path: string): Promise<DirEntry[]> {
    await this.checkAccess('readdir', path);
    return this.fs.readdirPlus(path);
  }

  async mkdir(path: string): Promise<void> {
    await this.checkAccess('mkdir', path);
    return this.fs.mkdir(path);
  }

  async rmdir(path: string): Promise<void> {
    await this.checkAccess('delete', path);
    return this.fs.rmdir(path);
  }

  async unlink(path: string): Promise<void> {
    await this.checkAccess('delete', path);
    return this.fs.unlink(path);
  }

  async rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void> {
    await this.checkAccess('delete', path);
    return this.fs.rm(path, options);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.checkAccess('rename', oldPath, { newPath });
    await this.checkAccess('write', newPath);
    return this.fs.rename(oldPath, newPath);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await this.checkAccess('read', src);
    await this.checkAccess('write', dest);
    return this.fs.copyFile(src, dest);
  }

  async symlink(target: string, linkpath: string): Promise<void> {
    await this.checkAccess('symlink', linkpath, { target });
    return this.fs.symlink(target, linkpath);
  }

  async readlink(path: string): Promise<string> {
    await this.checkAccess('read', path);
    return this.fs.readlink(path);
  }

  async access(path: string): Promise<void> {
    await this.checkAccess('stat', path);
    return this.fs.access(path);
  }

  async statfs(): Promise<FilesystemStats> {
    // statfs doesn't need permission check (global operation)
    return this.fs.statfs();
  }

  async open(path: string): Promise<FileHandle> {
    await this.checkAccess('read', path);
    // Wrap the file handle to check write permissions
    const handle = await this.fs.open(path);
    return new ProtectedFileHandle(handle, path, this.hooks);
  }

  private async checkAccess(
    operation: FileOperation,
    path: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    await this.hooks.checkAccessOrThrow(operation, path, data);
  }
}

/**
 * A file handle wrapper that checks write permissions
 */
class ProtectedFileHandle implements FileHandle {
  private handle: FileHandle;
  private path: string;
  private hooks: PermissionHooks;

  constructor(handle: FileHandle, path: string, hooks: PermissionHooks) {
    this.handle = handle;
    this.path = path;
    this.hooks = hooks;
  }

  async pread(offset: number, size: number): Promise<Buffer> {
    // Read was already checked when opening
    return this.handle.pread(offset, size);
  }

  async pwrite(offset: number, data: Buffer): Promise<void> {
    // Check write permission
    await this.hooks.checkAccessOrThrow('write', this.path);
    return this.handle.pwrite(offset, data);
  }

  async truncate(size: number): Promise<void> {
    await this.hooks.checkAccessOrThrow('write', this.path);
    return this.handle.truncate(size);
  }

  async fsync(): Promise<void> {
    return this.handle.fsync();
  }

  async fstat(): Promise<Stats> {
    return this.handle.fstat();
  }
}

/**
 * Create a protected filesystem wrapper
 * 
 * @param fs - The underlying filesystem to wrap
 * @param kv - Optional KV store for OOSS metadata lookups
 * @returns Protected filesystem instance
 */
export function createProtectedFS(fs: FileSystem, kv?: KvStore): ProtectedFileSystem {
  return new ProtectedFileSystem(fs, kv);
}
