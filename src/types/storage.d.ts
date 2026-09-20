interface SessionData {
  name?: string;
  created?: number | null;
  modified?: number | null;
  pinned?: boolean;
  tags?: string[];
  /** Name of the folder the session is in; sessions with the same name share a folder. */
  folder?: string;
  stats?: SessionStats;
  inactive?: boolean;
  [key: string]: unknown;
}

/**
 * Lifetime counters for one session. Stored alongside the session's metadata, so
 * every session's counters are in memory once the app has loaded and totals across
 * all of them need no extra reads.
 */
interface SessionStats {
  /** Generations that produced at least one token. */
  generations: number;
  /** Tokens streamed from the model. */
  genTokens: number;
  /** Characters streamed from the model. */
  genChars: number;
  /** Milliseconds spent streaming. */
  genMs: number;
  /** Characters the user entered themselves, by typing, pasting or instructing. */
  typedChars: number;
  /** Characters the user removed from the prompt. */
  deletedChars: number;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface InstructTemplate {
  sysPre: string;
  sysSuf: string;
  instPre: string;
  instSuf: string;
  fimTemplate?: string;
}

interface ThemeData {
  order: number;
  isDefault: boolean;
  className: string;
  css: string;
}

interface ConnectionData {
  id: string;
  name: string;
  enabled: boolean;
  api: number;
  endpoint: string;
  key?: string;
  model?: string;
  models?: string[];
  strict?: boolean;
  chatAPI?: boolean;
  postSamplingProbs?: boolean;
}

interface WorldInfoData {
  miyaPediaVersion: number; // ponytail: reserved, migrate mikuPediaVersion from old stored data before reading
  entries: WorldInfoEntry[];
  prefix: string;
  suffix: string;
}

interface WorldInfoEntry {
  displayName: string;
  text: string;
  keys: string[];
  search: string;
}

interface MemoryTokensData {
  contextOrder: string;
  prefix: string;
  text: string;
  suffix: string;
}

interface AuthorNoteData {
  prefix: string;
  text: string;
  suffix: string;
}

type HistoryReason = 'open' | 'idle' | 'deletion' | 'generation' | 'restore';

interface HistoryEntry {
  time: number;
  hash: string;
  reason: HistoryReason;
  words: number;
  /** The last 100 characters of the prompt text, to tell versions apart. */
  tail: string;
}

interface SessionSnapshot {
  prompt?: PromptChunk[];
  memoryTokens?: MemoryTokensData;
  authorNoteTokens?: AuthorNoteData;
  worldInfo?: WorldInfoData;
}

interface LogitBiasEntry {
  ids: number[];
  strings: string[];
  power: number;
}

interface LogitBiasState {
  bias: Record<string, LogitBiasEntry>;
  model: string;
}

interface SamplerPresetData {
  id: string;
  name: string;
  enabled: boolean;
  seed: number;
  maxPredictTokens: number;
  temperature: number;
  dynaTempRange: number;
  dynaTempExp: number;
  repeatPenalty: number;
  repeatLastN: number;
  penalizeNl: boolean;
  presencePenalty: number;
  frequencyPenalty: number;
  topK: number;
  topP: number;
  typicalP: number;
  minP: number;
  tfsZ: number;
  mirostat: number;
  mirostatTau: number;
  mirostatEta: number;
  xtcThreshold: number;
  xtcProbability: number;
  dryMultiplier: number;
  dryBase: number;
  dryAllowedLength: number;
  dryPenaltyRange: number;
  drySequenceBreakers: string;
  bannedTokens: string;
  ignoreEos: boolean;
  enabledSamplers: string[];
  grammar: string;
}

type DbConnection = IDBDatabase | ((route: string, options?: unknown) => Promise<unknown>);

type BatchOp = { type: 'save'; key: string | number; data: unknown } | { type: 'delete'; key: string | number };

interface DatabaseAdapter {
  sessionEndpoint?: string;
  init?(): Promise<void>;
  openDatabase(): Promise<DbConnection>;
  loadFromDatabase(db: DbConnection, storeName: string, key: string | number): Promise<unknown>;
  loadAllFromDatabase(db: DbConnection, storeName: string): Promise<Record<string, unknown>>;
  loadSessionInfoFromDatabase(db: DbConnection, storeName: string): Promise<Record<string, unknown>>;
  saveToDatabase(db: DbConnection, storeName: string, key: string | number, data: unknown): Promise<void>;
  renameSessionInDatabase(db: DbConnection, storeName: string, key: string | number, newName: string): Promise<void>;
  deleteFromDatabase(db: DbConnection, storeName: string, key: string | number): Promise<void>;
  batchMutation?(db: DbConnection, storeName: string, ops: BatchOp[]): Promise<void>;
}

interface SillyTavernWorldInfoEntry {
  key: string[];
  comment: string;
  content: string;
  scanDepth?: string | null;
}

interface SillyTavernWorldInfo {
  entries?: Record<string, SillyTavernWorldInfoEntry>;
}
