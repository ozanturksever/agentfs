/**
 * OOSS Integration Types for AgentFS
 * 
 * These types define the interfaces for integrating AgentFS with the OOSS platform,
 * including permission hooks, metadata storage, and Convex streaming.
 */

/**
 * File operations that can be intercepted by permission hooks
 */
export type FileOperation = 
  | 'read'
  | 'write'
  | 'delete'
  | 'mkdir'
  | 'readdir'
  | 'stat'
  | 'execute'
  | 'rename'
  | 'copy'
  | 'symlink';

/**
 * Context provided to access hooks for permission decisions
 */
export interface AccessHookContext {
  /** The file operation being performed */
  operation: FileOperation;
  /** The path being accessed */
  path: string;
  /** Workspace ID (if available from OOSS metadata) */
  workspaceId?: string;
  /** Workload ID (if available from OOSS metadata) */
  workloadId?: string;
  /** Trust class (if available from OOSS metadata) */
  trustClass?: string;
  /** Additional operation-specific data */
  data?: Record<string, unknown>;
}

/**
 * Access hook function type
 * Returns true to allow the operation, false to deny
 */
export type AccessHook = (ctx: AccessHookContext) => boolean | Promise<boolean>;

/**
 * OOSS metadata stored in AgentFS KV store
 */
export interface OOSSMetadata {
  /** Workspace identifier */
  workspaceId: string;
  /** Workload identifier */
  workloadId: string;
  /** Sandbox identifier */
  sandboxId: string;
  /** Trust class for permission evaluation */
  trustClass: string;
  /** Allowed path patterns (glob-style) */
  allowedPaths: string[];
  /** Denied path patterns (glob-style) */
  deniedPaths: string[];
  /** Timestamp when sandbox was created */
  createdAt: number;
  /** Optional expiration timestamp */
  expiresAt?: number;
  /** Custom metadata */
  custom?: Record<string, unknown>;
}

/**
 * Configuration for Convex toolcall streaming
 */
export interface ConvexStreamConfig {
  /** Convex client instance (must have mutation method) */
  convexClient: ConvexClientLike;
  /** Mutation path for recording toolcalls (e.g., "sandbox:recordToolcalls") */
  mutationPath: string;
  /** Number of events to batch before sending (default: 10) */
  batchSize?: number;
  /** Interval in ms to flush batch even if not full (default: 1000) */
  flushIntervalMs?: number;
  /** Whether to include full toolcall results (default: true) */
  includeResults?: boolean;
  /** OOSS context to include with each event */
  oossContext?: Partial<OOSSMetadata>;
}

/**
 * Minimal Convex client interface
 */
export interface ConvexClientLike {
  mutation(name: string, args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Toolcall event sent to Convex
 */
export interface ConvexToolcallEvent {
  /** Toolcall ID from AgentFS */
  id: number;
  /** Tool name */
  name: string;
  /** Tool parameters */
  parameters?: unknown;
  /** Tool result (if includeResults is true) */
  result?: unknown;
  /** Error message (if failed) */
  error?: string;
  /** Status: pending, success, error */
  status: 'pending' | 'success' | 'error';
  /** Unix timestamp when started */
  startedAt: number;
  /** Unix timestamp when completed */
  completedAt?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** OOSS context */
  oossContext?: Partial<OOSSMetadata>;
}

/**
 * Configuration for git overlay initialization
 */
export interface OverlayConfig {
  /** Path to the git checkout (base layer) */
  basePath: string;
  /** Whether the base layer should be read-only (default: true) */
  readOnly?: boolean;
  /** Glob patterns to exclude from the overlay */
  excludePatterns?: string[];
  /** Path prefix in AgentFS to mount the overlay (default: '/') */
  mountPath?: string;
}

/**
 * A change detected in the overlay
 */
export interface OverlayChange {
  /** Path relative to overlay root */
  path: string;
  /** Type of change */
  type: 'added' | 'modified' | 'deleted';
  /** File content for added/modified files */
  content?: Uint8Array;
  /** Original content for modified files */
  originalContent?: Uint8Array;
  /** File mode */
  mode?: number;
}

/**
 * Result of permission check
 */
export interface PermissionCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Reason for denial (if not allowed) */
  reason?: string;
  /** Whether this was a local check or required callback */
  source: 'local' | 'callback';
}

/**
 * Error thrown when a permission is denied
 */
export class PermissionDeniedError extends Error {
  public readonly code = 'EACCES';
  public readonly operation: FileOperation;
  public readonly path: string;
  public readonly reason?: string;

  constructor(operation: FileOperation, path: string, reason?: string) {
    const message = reason 
      ? `Permission denied: ${operation} on ${path} - ${reason}`
      : `Permission denied: ${operation} on ${path}`;
    super(message);
    this.name = 'PermissionDeniedError';
    this.operation = operation;
    this.path = path;
    this.reason = reason;
  }
}
