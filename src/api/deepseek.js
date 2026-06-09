import { parseEventStream, applyTemperatureToProbs } from './common.js';

export async function deepseekModels({ endpoint, endpointAPIKey, proxyEndpoint, signal }) {
  const finalEndpoint = proxyEndpoint ?? endpoint;
  const url = `${finalEndpoint}/models`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}`, 'X-Real-URL': endpoint } : { 'Authorization': `Bearer ${endpointAPIKey}` }),
    },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { data } = await res.json();
  return data.map(item => item.id);
}

function deepseekConvertOptions(options) {
  const out = {};
  if (options.n_predict === -1) {
    out.max_tokens = 1024;
  } else if (options.n_predict !== undefined) {
    out.max_tokens = options.n_predict;
  }
  if (options.temperature !== undefined) out.temperature = options.temperature;
  if (options.top_p !== undefined) out.top_p = options.top_p;
  if (options.stop !== undefined) out.stop = options.stop;
  if (options.stream !== undefined) out.stream = options.stream;
  if (options.seed !== undefined && options.seed !== -1) out.seed = options.seed;
  return out;
}

export async function* deepseekChatCompletion({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
  const finalEndpoint = proxyEndpoint ?? endpoint;
  const res = await fetch(`${finalEndpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}`, 'X-Real-URL': endpoint } : { 'Authorization': `Bearer ${endpointAPIKey}` }),
    },
    body: JSON.stringify({
      ...deepseekConvertOptions(options),
      model: options.model || 'deepseek-v4-flash',
      messages: options.messages,
      ...(options.n_probs > 0 ? { logprobs: true, top_logprobs: Math.min(options.n_probs, 20) } : {}),
      thinking: { type: "disabled" },
    }),
    signal,
  });

  if (!res.ok) {
    let json;
    try { json = await res.json(); } catch {}
    if (json?.error?.message) throw new Error(json.error.message);
    throw new Error(`HTTP ${res.status}`);
  }

  async function* yieldTokens(chunks) {
    for await (const chunk of chunks) {
      if (!chunk.choices || chunk.choices.length === 0) continue;
      const choice = chunk.choices[0];
      const token = choice.delta?.content || choice.text;
      if (!token) continue;

      const topLogprobs = choice.logprobs?.content?.[0]?.top_logprobs;
      let probs = [];
      let prob;
      if (topLogprobs?.length) {
        const rawProbsArr = topLogprobs.map(({ token: t, logprob }) => ({ tok_str: t, logprob }));
        const res = applyTemperatureToProbs(rawProbsArr, token, options.temperature);
        probs = res.probs;
        prob = res.prob;
      }

      yield {
        content: token,
        ...(probs.length > 0 ? { prob: prob ?? -1, completion_probabilities: [{ content: token, probs }] } : {}),
      };
    }
  }

  if (options.stream) {
    yield* yieldTokens(parseEventStream(res.body));
  } else {
    const { choices } = await res.json();
    if (choices?.[0]?.message?.content) {
      yield { content: choices[0].message.content };
    }
  }
}

export async function* deepseekCompletion({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
  const finalEndpoint = proxyEndpoint ?? endpoint;
  const res = await fetch(`${finalEndpoint}/beta/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}`, 'X-Real-URL': endpoint } : { 'Authorization': `Bearer ${endpointAPIKey}` }),
    },
    body: JSON.stringify({
      ...deepseekConvertOptions(options),
      model: options.model || 'deepseek-v4-flash',
      prompt: options.prompt,
      ...(options.n_probs > 0 ? { logprobs: Math.min(options.n_probs, 20) } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    let json;
    try { json = await res.json(); } catch {}
    if (json?.error?.message) throw new Error(json.error.message);
    throw new Error(`HTTP ${res.status}`);
  }

  async function* yieldTokens(chunks) {
    for await (const chunk of chunks) {
      if (!chunk.choices || chunk.choices.length === 0) continue;
      const choice = chunk.choices[0];
      const text = choice.text;
      if (!text) continue;

      const logprobsData = choice.logprobs;
      let probs = [];
      let prob;
      let rawProbsArr = [];

      if (logprobsData?.content?.[0]?.top_logprobs) {
        rawProbsArr = logprobsData.content[0].top_logprobs.map(({ token, logprob }) => ({ tok_str: token, logprob }));
      } else if (logprobsData?.top_logprobs?.[0]) {
        const top_logprobs_obj = logprobsData.top_logprobs[0];
        rawProbsArr = Object.entries(top_logprobs_obj).map(([tok, logprob]) => ({ tok_str: tok, logprob }));
      }

      if (rawProbsArr.length > 0) {
        const res = applyTemperatureToProbs(rawProbsArr, text, options.temperature);
        probs = res.probs;
        prob = res.prob;
      }

      yield {
        content: text,
        ...(probs.length > 0 ? { prob: prob ?? -1, completion_probabilities: [{ content: text, probs }] } : {}),
      };
    }
  }

  if (options.stream) {
    yield* yieldTokens(parseEventStream(res.body));
  } else {
    const data = await res.json();
    if (data.choices?.[0]?.text) {
      yield { content: data.choices[0].text };
    }
  }
}

export async function deepseekAbortCompletion() {}
