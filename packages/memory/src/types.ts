import type { Conf } from '@si/core';

/** L0-L10 are knowledge layers. L11 (evidence) is the ledger and is never blended with these. */
export const LAYERS = {
  L0: 'working', L1: 'recall', L2: 'task', L3: 'episodic', L4: 'semantic', L5: 'profile',
  L6: 'procedural', L7: 'project', L8: 'domain', L9: 'organization', L10: 'harness_learning',
} as const;

export type MemoryType = 'episodic' | 'semantic' | 'profile' | 'procedural' | 'project' | 'domain' | 'organization' | 'harness_learning';
export type ScopeType = 'personal_space' | 'organization_space' | 'assistant' | 'project' | 'work_order' | 'session' | 'thread' | 'domain_pack';
export type MemoryStatus = 'candidate' | 'active' | 'superseded' | 'expired' | 'retracted';
export type Method = 'user_instruction' | 'user_feedback' | 'observed_event' | 'task_outcome' | 'source_document' | 'model_inference' | 'carry';

export interface Principal {
  id: string;
  spaceId: string;
  kind: 'user' | 'org_member' | 'assistant';
  roles: string[];
}

export interface SourceRef {
  kind: string;
  id: string;
  uri?: string;
}

export interface MemoryRecord {
  id: string;
  spaceId: string;
  scopeType: ScopeType;
  scopeId: string;
  memoryType: MemoryType;
  title: string;
  content: string;
  normalizedValue?: { key?: string; value?: unknown; compat?: Record<string, string> };
  entities: string[];
  sourceRefs: SourceRef[];
  provenance: { actor: string; method: Method; sourceTimestamp?: string };
  confidence: number;
  salience: number;
  sensitivity: Conf;
  status: MemoryStatus;
  createdAt: number;
  updatedAt: number;
  lastConfirmedAt?: number;
  expiresAt?: number;
  retentionClass: string;
  revision: number;
  supersedes?: string;
  consentBasis: string;
  pinned: boolean;
}

export interface MemoryProposalInput {
  scopeType: ScopeType;
  scopeId: string;
  memoryType: MemoryType;
  title: string;
  content: string;
  normalizedValue?: MemoryRecord['normalizedValue'];
  entities?: string[];
  sourceRefs: SourceRef[];
  provenance: MemoryRecord['provenance'];
  confidence?: number;
  salience?: number;
  expiresAt?: number;
  pinned?: boolean;
  consentBasis?: string;
}

export interface MemoryCandidate {
  id: string;
  spaceId: string;
  input: MemoryProposalInput;
  sensitivity: Conf;
  status: 'pending' | 'approved' | 'rejected';
  conflictsWith: string[];
  needsConfirmation: boolean;
  createdAt: number;
  decidedBy?: string;
  reason?: string;
}

export interface MemoryPolicy {
  spaceId: string;
  /** Pause learning: only explicit user instructions are accepted. */
  pauseLearning: boolean;
  retentionDays: Partial<Record<MemoryType, number>>;
  allowCarryOut: boolean;
  allowCarryIn: boolean;
  /** Roles allowed to write organization memory. */
  orgWriterRoles: string[];
  policyRevision: string;
}

/** What an assistant manifest says it may touch. Resolved by the harness, never by the model. */
export interface AssistantMemoryAccess {
  assistantId: string;
  readTypes: MemoryType[];
  writeTypes: MemoryType[];
  readScopes: ScopeType[];
}

export interface RuntimeContext {
  spaceId: string;
  principal: Principal;
  assistant: AssistantMemoryAccess;
  projectId?: string;
  taskId?: string;
  threadId?: string;
  /** Used for L10 compatibility filtering. */
  compat?: Record<string, string>;
}

export interface MemoryQuery {
  ctx: RuntimeContext;
  query: string;
  allowedTypes: MemoryType[];
  maxItems: number;
  tokenBudget: number;
}

export interface RetrievedItem {
  record: MemoryRecord;
  score: number;
  why: { lexical: number; recency: number; salience: number; confidence: number };
}
export interface MemoryRetrieval {
  receiptId: string;
  items: RetrievedItem[];
  /** Everything that matched before ranking and budgeting: "available" is not "used". */
  considered: number;
  contradictions: Array<{ key: string; ids: string[] }>;
  dropped: Array<{ id: string; reason: string }>;
}

export class CrossSpaceError extends Error {
  constructor() {
    super('memory: cross-Space access is not allowed');
  }
}
export class MemoryPolicyError extends Error {}
