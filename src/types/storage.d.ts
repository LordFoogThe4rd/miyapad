interface SessionData {
  name?: string;
  created?: number | null;
  modified?: number | null;
  pinned?: boolean;
  tags?: string[];
  inactive?: boolean;
  [key: string]: unknown;
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
  tokens?: number;
  tokensWI?: number;
  worldInfo?: string;
}

interface AuthorNoteData {
  prefix: string;
  text: string;
  suffix: string;
  tokens?: number;
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
