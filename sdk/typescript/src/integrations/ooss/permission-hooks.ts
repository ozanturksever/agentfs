/**
 * Permission Hooks for OOSS Integration
 * 
 * Provides access control hooks that can be attached to AgentFS filesystem operations.
 * These hooks allow workspace rules to be enforced at the filesystem level.
 */

import type { KvStore } from '../../kvstore.js';
import type {
  AccessHook,
  AccessHookContext,
  FileOperation,
  OOSSMetadata,
  PermissionCheckResult,
} from './types.js';
import { PermissionDeniedError } from './types.js';
import { getOOSSMetadata } from './metadata.js';

/**
 * Permission hooks manager for AgentFS
 * 
 * This class manages access control hooks and provides utilities for
 * checking permissions based on workspace rules stored in the KV store.
 */
export class PermissionHooks {
  private hook?: AccessHook;
  private kv?: KvStore;
  private cachedMetadata?: OOSSMetadata | null;
  private metadataCacheTime = 0;
  private readonly metadataCacheTtlMs = 5000; // 5 second cache

  constructor(kv?: KvStore) {
    this.kv = kv;
  }

  /**
   * Set the access hook for permission checks
   */
  setAccessHook(hook: AccessHook): void {
    this.hook = hook;
  }

  /**
   * Clear the access hook
   */
  clearAccessHook(): void {
    this.hook = undefined;
  }

  /**
   * Check if an access hook is set
   */
  hasAccessHook(): boolean {
    return this.hook !== undefined;
  }

  /**
   * Set the KV store for metadata lookups
   */
  setKvStore(kv: KvStore): void {
    this.kv = kv;
    this.invalidateMetadataCache();
  }

  /**
   * Invalidate the cached metadata
   */
  invalidateMetadataCache(): void {
    this.cachedMetadata = undefined;
    this.metadataCacheTime = 0;
  }

  /**
   * Get OOSS metadata with caching
   */
  private async getMetadata(): Promise<OOSSMetadata | null> {
    if (!this.kv) return null;

    const now = Date.now();
    if (this.cachedMetadata !== undefined && now - this.metadataCacheTime < this.metadataCacheTtlMs) {
      return this.cachedMetadata;
    }

    this.cachedMetadata = await getOOSSMetadata(this.kv);
    this.metadataCacheTime = now;
    return this.cachedMetadata;
  }

  /**
   * Check if an operation is allowed
   * 
   * First checks against locally stored patterns, then falls back to the hook
   * for operations that require runtime evaluation.
   * 
   * @param operation - The file operation type
   * @param path - The path being accessed
   * @param data - Additional operation-specific data
   * @returns Whether the operation is allowed
   * @throws PermissionDeniedError if the operation is denied
   */
  async checkAccess(
    operation: FileOperation,
    path: string,
    data?: Record<string, unknown>
  ): Promise<PermissionCheckResult> {
    // If no hook is set, allow all operations
    if (!this.hook) {
      return { allowed: true, source: 'local' };
    }

    // Get metadata for context
    const metadata = await this.getMetadata();

    // First, try local pattern matching if metadata is available
    if (metadata) {
      const localResult = this.checkLocalPatterns(path, metadata);
      if (!localResult.allowed) {
        return localResult;
      }
    }

    // Build context for the hook
    const ctx: AccessHookContext = {
      operation,
      path,
      workspaceId: metadata?.workspaceId,
      workloadId: metadata?.workloadId,
      trustClass: metadata?.trustClass,
      data,
    };

    // Call the hook
    const allowed = await this.hook(ctx);
    return {
      allowed,
      reason: allowed ? undefined : 'Denied by access hook',
      source: 'callback',
    };
  }

  /**
   * Check access and throw if denied
   */
  async checkAccessOrThrow(
    operation: FileOperation,
    path: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    const result = await this.checkAccess(operation, path, data);
    if (!result.allowed) {
      throw new PermissionDeniedError(operation, path, result.reason);
    }
  }

  /**
   * Check path against locally stored patterns
   */
  private checkLocalPatterns(path: string, metadata: OOSSMetadata): PermissionCheckResult {
    // Check denied patterns first (deny takes precedence)
    for (const pattern of metadata.deniedPaths) {
      if (this.matchPattern(path, pattern)) {
        return {
          allowed: false,
          reason: `Path matches denied pattern: ${pattern}`,
          source: 'local',
        };
      }
    }

    // If there are allowed patterns, path must match at least one
    if (metadata.allowedPaths.length > 0) {
      const matchesAllowed = metadata.allowedPaths.some(pattern => 
        this.matchPattern(path, pattern)
      );
      if (!matchesAllowed) {
        return {
          allowed: false,
          reason: 'Path does not match any allowed pattern',
          source: 'local',
        };
      }
    }

    return { allowed: true, source: 'local' };
  }

  /**
   * Match a path against a glob-like pattern
   * 
   * Supports:
   * - `*` matches any single path segment
   * - `**` matches any number of path segments
   * - Exact string matching otherwise
   */
  private matchPattern(path: string, pattern: string): boolean {
    // Normalize paths
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    const normalizedPattern = pattern.startsWith('/') ? pattern : '/' + pattern;

    // Convert glob pattern to regex
    const regexPattern = normalizedPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/\*\*/g, '§§') // Temporarily replace **
      .replace(/\*/g, '[^/]*') // * matches single segment
      .replace(/§§/g, '.*'); // ** matches any path

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
  }
}

/**
 * Create a permission hooks instance from an AgentFS KV store
 */
export function createPermissionHooks(kv?: KvStore): PermissionHooks {
  return new PermissionHooks(kv);
}

/**
 * Match a path against a glob-like pattern
 * 
 * Supports:
 * - `*` matches any single path segment
 * - `**` matches any number of path segments
 * - Exact string matching otherwise
 * 
 * @param path - The path to check
 * @param pattern - The glob pattern to match against
 * @returns True if the path matches the pattern
 */
export function matchPathPattern(path: string, pattern: string): boolean {
  // Normalize paths
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  const normalizedPattern = pattern.startsWith('/') ? pattern : '/' + pattern;

  // Convert glob pattern to regex
  const regexPattern = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
    .replace(/\*\*/g, '§§') // Temporarily replace **
    .replace(/\*/g, '[^/]*') // * matches single segment
    .replace(/§§/g, '.*'); // ** matches any path

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedPath);
}

/**
 * Check a path against allowed and denied patterns
 * 
 * @param path - The path to check
 * @param allowedPatterns - Patterns that allow access
 * @param deniedPatterns - Patterns that deny access (takes precedence)
 * @returns Permission check result
 */
export function checkPathPatterns(
  path: string,
  allowedPatterns: string[],
  deniedPatterns: string[]
): PermissionCheckResult {
  // Check denied patterns first (deny takes precedence)
  for (const pattern of deniedPatterns) {
    if (matchPathPattern(path, pattern)) {
      return {
        allowed: false,
        reason: `Path matches denied pattern: ${pattern}`,
        source: 'local',
      };
    }
  }

  // If there are allowed patterns, path must match at least one
  if (allowedPatterns.length > 0) {
    const matchesAllowed = allowedPatterns.some(pattern => 
      matchPathPattern(path, pattern)
    );
    if (!matchesAllowed) {
      return {
        allowed: false,
        reason: 'Path does not match any allowed pattern',
        source: 'local',
      };
    }
  }

  return { allowed: true, source: 'local' };
}

/**
 * Create a simple pattern-based access hook
 * 
 * This is a convenience function that creates an access hook that
 * checks paths against allowed and denied patterns.
 */
export function createPatternAccessHook(
  allowedPatterns: string[],
  deniedPatterns: string[] = []
): AccessHook {
  return async (ctx: AccessHookContext): Promise<boolean> => {
    const result = checkPathPatterns(ctx.path, allowedPatterns, deniedPatterns);
    return result.allowed;
  };
}
