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

interface CompletionOptions extends ApiEndpointConfig {
  [key: string]: any;
}
