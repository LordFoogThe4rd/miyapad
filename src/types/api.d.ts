interface CompletionChunk {
  content: string;
  prob?: number;
  completion_probabilities?: CompletionProb[];
  stopping_word?: string;
}

interface CompletionProb {
  content: string;
  probs: ProbItem[];
}

interface ProbItem {
  tok_str: string;
  prob?: number;
  logprob?: number;
}

interface AIHordeChunk {
  status: 'queue_init' | 'queue_status' | 'done';
  taskId?: string;
  position?: number;
  waitTime?: number;
  processing?: boolean;
  content?: string;
}

interface TokenCountResult {
  ids: number[];
  str: string[];
}

interface ApiEndpointConfig {
  endpoint: string;
  endpointAPI: number;
  endpointAPIKey?: string;
  signal?: AbortSignal;
  proxyEndpoint?: string;
}

interface AIHordeModel {
  name: string;
  count: number;
  eta: number;
  queued?: number;
  type?: string;
}

interface TemplateListItem {
  name: string;
  nameNew: string;
  value: string;
  nameBack: string;
  affixes: InstructTemplate;
}

interface CompletionOptions extends ApiEndpointConfig {
  [key: string]: unknown;
}

interface ApiProviderParams {
  endpoint: string;
  endpointAPIKey?: string;
  proxyEndpoint?: string;
  signal?: AbortSignal;
}

interface TokenCounterParams extends ApiProviderParams {
  content: string;
}

interface AbortParams {
  endpoint: string;
  proxyEndpoint?: string;
  hordeTaskId?: string;
}

type AnyIterable<T> = Iterable<T> | AsyncIterable<T>;

interface LogprobToken {
  token: string;
  logprob: number;
}

interface LLamaCppProb {
  token: string;
  prob: number;
}

interface LLamaCppProbItem {
  tok_str: string;
  prob: number;
}

interface SamplerOptions {
  stream?: boolean;
  temperature?: number;
  n_predict?: number;
  n_probs?: number;
  stop?: string[];
  seed?: number;
  prompt?: string;
  model?: string;
  content?: string;
  messages?: unknown[];
  grammar?: string;
  dynatemp_range?: number;
  top_p?: number;
  [key: string]: unknown;
}
