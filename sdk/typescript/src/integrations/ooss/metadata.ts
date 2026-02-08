/**
 * OOSS Metadata Helpers for AgentFS KV Store
 * 
 * Provides standardized functions for storing and retrieving OOSS workspace
 * metadata in the AgentFS KV store. This metadata is used for permission
 * evaluation and sandbox context tracking.
 */

import type { KvStore } from '../../kvstore.js';
import type { OOSSMetadata } from './types.js';

// Standard key prefixes for OOSS metadata
const OOSS_KEY_PREFIX = 'ooss:';
const OOSS_METADATA_KEY = `${OOSS_KEY_PREFIX}metadata`;
const OOSS_WORKSPACE_ID_KEY = `${OOSS_KEY_PREFIX}workspaceId`;
const OOSS_WORKLOAD_ID_KEY = `${OOSS_KEY_PREFIX}workloadId`;
const OOSS_SANDBOX_ID_KEY = `${OOSS_KEY_PREFIX}sandboxId`;
const OOSS_TRUST_CLASS_KEY = `${OOSS_KEY_PREFIX}trustClass`;
const OOSS_ALLOWED_PATHS_KEY = `${OOSS_KEY_PREFIX}allowedPaths`;
const OOSS_DENIED_PATHS_KEY = `${OOSS_KEY_PREFIX}deniedPaths`;
const OOSS_CREATED_AT_KEY = `${OOSS_KEY_PREFIX}createdAt`;
const OOSS_EXPIRES_AT_KEY = `${OOSS_KEY_PREFIX}expiresAt`;
const OOSS_CUSTOM_KEY = `${OOSS_KEY_PREFIX}custom`;

/**
 * Set complete OOSS metadata in the KV store
 * 
 * This stores the metadata both as a single JSON object (for easy retrieval)
 * and as individual keys (for efficient partial reads).
 * 
 * @param kv - AgentFS KV store instance
 * @param metadata - Complete OOSS metadata to store
 */
export async function setOOSSMetadata(
  kv: KvStore,
  metadata: OOSSMetadata
): Promise<void> {
  // Store complete metadata as single object
  await kv.set(OOSS_METADATA_KEY, metadata);

  // Store individual keys for efficient partial access
  await Promise.all([
    kv.set(OOSS_WORKSPACE_ID_KEY, metadata.workspaceId),
    kv.set(OOSS_WORKLOAD_ID_KEY, metadata.workloadId),
    kv.set(OOSS_SANDBOX_ID_KEY, metadata.sandboxId),
    kv.set(OOSS_TRUST_CLASS_KEY, metadata.trustClass),
    kv.set(OOSS_ALLOWED_PATHS_KEY, metadata.allowedPaths),
    kv.set(OOSS_DENIED_PATHS_KEY, metadata.deniedPaths),
    kv.set(OOSS_CREATED_AT_KEY, metadata.createdAt),
    ...(metadata.expiresAt !== undefined 
      ? [kv.set(OOSS_EXPIRES_AT_KEY, metadata.expiresAt)] 
      : []),
    ...(metadata.custom !== undefined 
      ? [kv.set(OOSS_CUSTOM_KEY, metadata.custom)] 
      : []),
  ]);
}

/**
 * Get complete OOSS metadata from the KV store
 * 
 * @param kv - AgentFS KV store instance
 * @returns The OOSS metadata or null if not set
 */
export async function getOOSSMetadata(
  kv: KvStore
): Promise<OOSSMetadata | null> {
  const metadata = await kv.get<OOSSMetadata>(OOSS_METADATA_KEY);
  return metadata ?? null;
}

/**
 * Update partial OOSS metadata in the KV store
 * 
 * This merges the provided fields with existing metadata.
 * 
 * @param kv - AgentFS KV store instance
 * @param partial - Partial metadata to merge
 */
export async function updateOOSSMetadata(
  kv: KvStore,
  partial: Partial<OOSSMetadata>
): Promise<void> {
  const existing = await getOOSSMetadata(kv);
  
  if (!existing) {
    throw new Error('Cannot update OOSS metadata: no existing metadata found');
  }

  const updated: OOSSMetadata = {
    ...existing,
    ...partial,
  };

  await setOOSSMetadata(kv, updated);
}

/**
 * Delete all OOSS metadata from the KV store
 * 
 * @param kv - AgentFS KV store instance
 */
export async function deleteOOSSMetadata(kv: KvStore): Promise<void> {
  await Promise.all([
    kv.delete(OOSS_METADATA_KEY),
    kv.delete(OOSS_WORKSPACE_ID_KEY),
    kv.delete(OOSS_WORKLOAD_ID_KEY),
    kv.delete(OOSS_SANDBOX_ID_KEY),
    kv.delete(OOSS_TRUST_CLASS_KEY),
    kv.delete(OOSS_ALLOWED_PATHS_KEY),
    kv.delete(OOSS_DENIED_PATHS_KEY),
    kv.delete(OOSS_CREATED_AT_KEY),
    kv.delete(OOSS_EXPIRES_AT_KEY),
    kv.delete(OOSS_CUSTOM_KEY),
  ]);
}

/**
 * Check if OOSS metadata exists in the KV store
 * 
 * @param kv - AgentFS KV store instance
 * @returns True if metadata exists
 */
export async function hasOOSSMetadata(kv: KvStore): Promise<boolean> {
  const metadata = await kv.get(OOSS_METADATA_KEY);
  return metadata !== undefined;
}

/**
 * Get the workspace ID from the KV store
 * 
 * @param kv - AgentFS KV store instance
 * @returns The workspace ID or undefined
 */
export async function getWorkspaceId(kv: KvStore): Promise<string | undefined> {
  return kv.get<string>(OOSS_WORKSPACE_ID_KEY);
}

/**
 * Get the workload ID from the KV store
 * 
 * @param kv - AgentFS KV store instance
 * @returns The workload ID or undefined
 */
export async function getWorkloadId(kv: KvStore): Promise<string | undefined> {
  return kv.get<string>(OOSS_WORKLOAD_ID_KEY);
}

/**
 * Get the sandbox ID from the KV store
 * 
 * @param kv - AgentFS KV store instance
 * @returns The sandbox ID or undefined
 */
export async function getSandboxId(kv: KvStore): Promise<string | undefined> {
  return kv.get<string>(OOSS_SANDBOX_ID_KEY);
}

/**
 * Get the trust class from the KV store
 * 
 * @param kv - AgentFS KV store instance
 * @returns The trust class or undefined
 */
export async function getTrustClass(kv: KvStore): Promise<string | undefined> {
  return kv.get<string>(OOSS_TRUST_CLASS_KEY);
}

/**
 * Get allowed path patterns from the KV store
 * 
 * @param kv - AgentFS KV store instance
 * @returns Array of allowed path patterns (empty if not set)
 */
export async function getAllowedPaths(kv: KvStore): Promise<string[]> {
  const paths = await kv.get<string[]>(OOSS_ALLOWED_PATHS_KEY);
  return paths ?? [];
}

/**
 * Get denied path patterns from the KV store
 * 
 * @param kv - AgentFS KV store instance
 * @returns Array of denied path patterns (empty if not set)
 */
export async function getDeniedPaths(kv: KvStore): Promise<string[]> {
  const paths = await kv.get<string[]>(OOSS_DENIED_PATHS_KEY);
  return paths ?? [];
}

/**
 * Update allowed path patterns in the KV store
 * 
 * @param kv - AgentFS KV store instance
 * @param paths - New allowed path patterns
 */
export async function setAllowedPaths(
  kv: KvStore,
  paths: string[]
): Promise<void> {
  await kv.set(OOSS_ALLOWED_PATHS_KEY, paths);
  await updateOOSSMetadata(kv, { allowedPaths: paths });
}

/**
 * Update denied path patterns in the KV store
 * 
 * @param kv - AgentFS KV store instance
 * @param paths - New denied path patterns
 */
export async function setDeniedPaths(
  kv: KvStore,
  paths: string[]
): Promise<void> {
  await kv.set(OOSS_DENIED_PATHS_KEY, paths);
  await updateOOSSMetadata(kv, { deniedPaths: paths });
}

/**
 * Check if the sandbox has expired
 * 
 * @param kv - AgentFS KV store instance
 * @returns True if expired, false if not expired or no expiry set
 */
export async function isExpired(kv: KvStore): Promise<boolean> {
  const expiresAt = await kv.get<number>(OOSS_EXPIRES_AT_KEY);
  if (expiresAt === undefined) return false;
  return Date.now() > expiresAt;
}

/**
 * Get custom metadata field
 * 
 * @param kv - AgentFS KV store instance
 * @param key - Custom metadata key
 * @returns The custom value or undefined
 */
export async function getCustomMetadata<T = unknown>(
  kv: KvStore,
  key: string
): Promise<T | undefined> {
  const custom = await kv.get<Record<string, unknown>>(OOSS_CUSTOM_KEY);
  return custom?.[key] as T | undefined;
}

/**
 * Set custom metadata field
 * 
 * @param kv - AgentFS KV store instance
 * @param key - Custom metadata key
 * @param value - Value to store
 */
export async function setCustomMetadata(
  kv: KvStore,
  key: string,
  value: unknown
): Promise<void> {
  const custom = await kv.get<Record<string, unknown>>(OOSS_CUSTOM_KEY) ?? {};
  custom[key] = value;
  await kv.set(OOSS_CUSTOM_KEY, custom);
}

/**
 * Create default OOSS metadata for a new sandbox
 * 
 * @param workspaceId - Workspace identifier
 * @param workloadId - Workload identifier
 * @param sandboxId - Sandbox identifier
 * @param trustClass - Trust class for permissions
 * @returns Default OOSS metadata object
 */
export function createDefaultMetadata(
  workspaceId: string,
  workloadId: string,
  sandboxId: string,
  trustClass: string = 'agent'
): OOSSMetadata {
  return {
    workspaceId,
    workloadId,
    sandboxId,
    trustClass,
    allowedPaths: [],
    deniedPaths: [],
    createdAt: Date.now(),
  };
}
