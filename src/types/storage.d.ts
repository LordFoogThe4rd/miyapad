interface SessionData {
  name?: string;
  created?: number | null;
  modified?: number | null;
  pinned?: boolean;
  tags?: string[];
  inactive?: boolean;
  [key: string]: any;
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
  name: string;
  enabled: boolean;
  api: number;
  endpoint: string;
  key?: string;
  model?: string;
  strict?: boolean;
  chatAPI?: boolean;
  postSamplingProbs?: boolean;
}

interface WorldInfoData {
  mikuPediaVersion: number;
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

interface LogitBiasState {
  bias: Record<string, number>;
  model: string;
}
