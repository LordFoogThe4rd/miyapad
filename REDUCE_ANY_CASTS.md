# Reduce `as any` Casts — Plan

**31 casts in `src/`**, **6 in `server/`** (server treated separately).

---

## Tier 1 — Trivial (redundant, ~15 casts)

All API dispatch functions in `src/api/index.ts` declare `[key: string]: any` in their parameter types, making `as any` on call sites redundant (narrow → wide is always valid in TS). Just delete the cast.

### Changes

| File | Line(s) | Change |
|---|---|---|
| `src/api/index.ts:180` | `aiHordeAbortCompletion({...} as any)` | → `aiHordeAbortCompletion({...})` |
| `src/hooks/useGenerationLogic.ts:68,80` | `abortCompletion({...} as any)` | Remove `as any` (×2) |
| `src/hooks/useGenerationLogic.ts:104` | `getTokenCount({...} as any)` | Remove `as any` |
| `src/hooks/useGenerationLogic.ts:263` | `} as any))` on completion/chatCompletion call | Remove `as any` |
| `src/hooks/useTokenCounters.ts:39,84,124` | same param pattern | Remove `as any` (×3) |
| `src/AppLayout.tsx:396,422` | same param pattern | Remove `as any` (×2) |
| `src/components/modals/ConnectionManagerModal.tsx:38` | same param pattern | Remove `as any` |
| `src/components/modals/ContextModal.tsx:35` | same param pattern | Remove `as any` |
| `src/components/modals/LogitBiasModal.tsx:97,112` | same param pattern | Remove `as any` (×2) |
| `src/api/deepseek.ts:35,95` | `const opts = {...options} as any` | → `{...options}` (rest is `[key: string]: any`) |

---

## Tier 2 — Easy Wins (~5 casts)

### 1. `PromptContainer.tsx:271` — dataset access

```ts
// Before
const index = +((pc as HTMLElement).dataset.promptchunk as any);
// After
const index = Number(pc.dataset.promptchunk ?? '0');
```

### 2. `InstructTemplatesModal.tsx:197,201` — dynamic DOM property

Replace `(fileInput as any).func` hack with a closure variable:

```ts
let onFileLoad: ((text: string) => Promise<void>) | null = null;
// ... set onFileLoad before creating input
// in onchange: onFileLoad(contents);
// after appendChild: onFileLoad = async (text) => { ... };
```
Eliminates both `as any` on `fileInput`.

### 3. `polyfills.ts:3` — ReadableStream prototype

**SKIPPED** — legitimate polyfill. The `as any` on `(ReadableStream.prototype as any)[Symbol.asyncIterator]`
is a runtime prototype assignment that fundamentally bypasses the existing DOM lib typing.
Adding a global declaration caused a type conflict (the generator return type didn't match the
interface method signature), and using `as HTMLElement`-style narrowing isn't applicable.
This is a valid use of `as any` for polyfill code.

### 4. `SessionStorage.ts:247,281` — callback invocation

Type the `onchange` field properly (e.g., `private onchange?: () => void`) and call `this.onchange?.()` directly.

---

## Tier 3 — Medium (~5 casts)

### 5. `deepseek.ts:20` — empty object builder

Define an interface:

```ts
interface DeepseekConvertedOpts {
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  seed?: number;
}
```

Then `const out: DeepseekConvertedOpts = {};` and set properties normally.

### 6. `SessionStorage.ts:141` — `(data as any).name`

Type the return of `loadSessionInfoFromDatabase` or cast to a known partial shape:

```ts
interface SessionMeta {
  name?: string;
  created?: number | null;
  modified?: number | null;
  pinned?: boolean;
  tags?: string[];
}
```

Use `(data as SessionMeta).name` instead of `as any`.

### 7. `CompressionInfoModal.tsx:32,57` — unknown config shape

Define:

```ts
interface ZstdCompressionConfig {
  compression_level?: number;
  train_dict_samples_ratio?: number;
  table?: string;
  column?: string;
  [key: string]: unknown;
}
```

Replace `as any` with `as ZstdCompressionConfig`.

### 8. `SessionsModal.tsx:58` — group typing

Type the return of `compileTagFilterGroups` as `TagGroup[]` where:

```ts
type TagGroup = Array<{ pattern: string; negate: boolean; regex: RegExp | null }>;
```

Then remove the `as any`.

---

## Tier 4 — Harder (~5 casts)

### 9. `LogitBiasModal.tsx:98,113` — return value double-cast

**Context:** The ternary unions `serverTokenize` (returns `{ ids: any; str: any }`) and `getTokens` (returns `TokenCountResult | []`).
After the early-return guard `if (tokens.length === 0) return;`, the effective runtime shape is `{ ids: number[]; str: string | string[] }`
(`str` is `string[]` from tokenizers, `string` from the direct-ID branch at line 70).

**Changes:**

1. Define type at top of file:
```ts
type TokenizeResult = { ids: number[]; str: string | string[] };
```

2. Change variable declarations:
```ts
// line 64: let tokens: any → let tokens: TokenizeResult

// line 98: remove `as any` on result, use narrow cast on each branch
tokens = await (useServerTk
  ? serverTokenize({...}) as Promise<TokenizeResult>
  : getTokens({...}) as Promise<TokenizeResult>
);

// line 103-113: same pattern for logitBiasWorkaround
const logitBiasWorkaround: TokenizeResult = await (useServerTk
  ? serverTokenize({...}) as Promise<TokenizeResult>
  : getTokens({...}) as Promise<TokenizeResult>
);
```

The `as Promise<TokenizeResult>` is still a type assertion, but it narrows from `any`
to a meaningful shape. The early `tokens.length === 0` guard safely handles the empty-array
case from `getTokens` before `.ids`/`.str` access.

**Bonus:** The direct-ID branch at line 68-71 produces `{ ids: number[]; str: string }`,
which is already a subtype of `TokenizeResult` — no cast needed.

---

### 10. `LogitBiasModal.tsx:222` — state type

**Context:** `useState<any>([])` hides the real shape:
```
{ positive: BiasItem[], negative: BiasItem[] }
```
where `BiasItem = { value, valueBack, strings, tokens, power }`.

**Changes:**

1. Add types before component:
```ts
type BiasItem = {
  value: string;
  valueBack: string;
  strings: string[];
  tokens: number[];
  power: number;
};
type BiasTempState = { positive: BiasItem[]; negative: BiasItem[] };
```

2. Fix state declaration (line 13):
```ts
const [logitBiasTemp, setLogitBiasTemp] = useState<BiasTempState>({ positive: [], negative: [] });
```

3. Remove `as any` from line 222 — the map/filter pipeline already produces `BiasTempState`:
```ts
// before:  } as any);
// after:   });
```

**Bonus cleanups (same file):**
- `useState<any[]>([])` → `useState<string[]>([])` on `logitBiasSorted` (stores array of string keys)
- `useState<any>(undefined)` → `useState<string | undefined>(undefined)` on `lastBiasError`

**Note:** The htm/react template iterates `Object.keys(logitBiasTemp)` and indexes
`logitBiasTemp[key]`. With `BiasTempState`, `key` infers as `string`, so the index access works.
Template-internal `(bias: any)` can stay as-is (htm/react typing is separate).

---

### 11. `useGenerationLogic.ts:266` — stream chunk union

**Context:** The generator chain is entirely untyped — all 7 sub-generators
(`llamaCppCompletion`, `koboldCppCompletion`, `openaiCompletion`, `openaiChatCompletion`,
`deepseekCompletion`, `deepseekChatCompletion`, `aiHordeCompletion`) use `[key: string]: any`
params and have no return type annotations. This makes `chunk` in the `for await...of` loop
implicitly `any`, so `chunk as any` on line 266 is a no-op.

**Actual yield shapes from sub-generators:**
- `llamaCppCompletion`, `koboldCppCompletion`, `openaiCompletion`, `openaiChatCompletion`,
  `deepseekCompletion`, `deepseekChatCompletion` → `CompletionChunk`
- `aiHordeCompletion` → `AIHordeChunk`

**Files to modify (7 files):**

| File | Change |
|------|--------|
| `src/api/llamacpp.ts:65` | Add return type `AsyncGenerator<CompletionChunk, void, unknown>` |
| `src/api/koboldcpp.ts:71` | Same |
| `src/api/openai.ts:263,408` | Same (two generators) |
| `src/api/deepseek.ts:43,103` | Same (two generators) |
| `src/api/aihorde.ts:23` | Add return type `AsyncGenerator<AIHordeChunk, void, unknown>` |
| `src/api/index.ts:146,162` | Add return type `AsyncGenerator<CompletionChunk \| AIHordeChunk, void, unknown>` |
| `src/hooks/useGenerationLogic.ts:266` | Remove `as any`, replace with typed narrow pattern |

**Approach — Type the generator chain (Phase A1 + A2):**

All sub-generators already yield the correct structural shapes. The return type annotations
are purely additive — no other code changes needed inside generator bodies.

Existing interfaces are globally declared in `types/api.d.ts` so no imports needed.

**Phase A3 — Fix the consumption site:**

Replace the `as any` with explicit endpoint-based narrowing:

```ts
// At top of useGenerationLogic.ts (or import from types):
type GenerationChunk = CompletionChunk | AIHordeChunk;

// In the loop, replace line 266:
//   const chunkData = chunk as any;
// with:
if (endpointAPI === API_AI_HORDE) {
  const hordeChunk = chunk as AIHordeChunk;
  switch (hordeChunk.status) {
    case 'queue_init':
      hordeTaskId.current = hordeChunk.taskId;
      continue;
    case 'queue_status':
      setHordeQueuePos(hordeChunk.position);
      setHordeProcessing(hordeChunk.processing);
      continue;
  }
}

const compChunk = chunk as CompletionChunk;
if (compChunk.stopping_word)
  compChunk.content = compChunk.stopping_word;
if (!compChunk.content) continue;
// ... rest uses compChunk
```

The `endpointAPI === API_AI_HORDE` check already exists and acts as a runtime discriminant.
Horde status-only chunks `continue` before reaching `CompletionChunk`-specific logic.

**Alternative (lighter, less refactoring):** If touching 7 sub-generator files is too much,
just add return types to the top-level generators in `api/index.ts` and use
`chunk as GenerationChunk` at the consumption site (one-line change). This still removes the
`as any` but keeps a narrow union cast.

**Note:** `stopping_word` is declared on `CompletionChunk` but never yielded by any sub-generator
— the code at line 267-268 is innocuous dead logic, safe to keep.

---

## Summary

| Tier | Casts removed | Effort | Risk |
|---|---|---|---|
| 1 — Redundant | ~15 | 5 min | None |
| 2 — Easy wins | ~5 | 15 min | Low |
| 3 — Medium | ~5 | 30 min | Low-Med |
| 4 — Harder | ~5 | 1 hr | Medium |
| **Total** | **~26 of 31** | **~2 hr** | |

Remaining ~5 casts after all tiers: legitimate uses in genuinely dynamic code.
