# TypeScript Migration Plan — Frontend

## Strategy: Big Bang (rename all files first, fix errors iteratively)

### Step 1: Install dependencies

```bash
npm install --save-dev typescript
npm install --save-dev @types/react @types/react-dom
```

### Step 2: Create `tsconfig.json`

`/tsconfig.json` — non-strict initially, gradually ratchet up.

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "strict": false,
    "noEmit": true,
    "allowJs": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "baseUrl": ".",
    "paths": { "*": ["src/types/*"] }
  },
  "include": ["src/**/*"]
}
```

### Step 3: Create type declaration files

| File | Purpose |
|------|---------|
| `src/types/global.d.ts` | CSS module declarations, Window augmentation |
| `src/types/api.d.ts` | API function signatures and response shapes |
| `src/types/storage.d.ts` | Storage adapter interfaces and DB types |
| `src/types/contexts.d.ts` | SettingsContext / GenerationContext shapes |
| `src/types/defaults.d.ts` | Preset data, template, theme types |
| `src/types/components.d.ts` | Shared component prop interfaces |

### Step 4: Rename files `.js` → `.ts` / `.tsx`

`.tsx` for files rendering `html` templates (components, contexts, App/AppLayout/main).
`.ts` for everything else (api, storage, hooks, utils, defaults).

| Directory | Count | New ext |
|-----------|-------|---------|
| `src/utils/` | 2 | `.ts` |
| `src/defaults/` | 4 | `.ts` |
| `src/api/` | 7 | `.ts` |
| `src/storage/` | 8 | `.ts` |
| `src/hooks/` | 10 | `.ts` |
| `src/contexts/` | 2 | `.tsx` |
| `src/components/` (root) | 11 | `.tsx` |
| `src/components/controls/` | 6 | `.tsx` |
| `src/components/icons/` | 1 | `.tsx` |
| `src/components/modals/` | 16 | `.tsx` |
| Root `src/` files | 6 | `.ts` or `.tsx` |

**Total: ~68 files**

### Step 5: Update entry point

`miyapad.html` line 24: `./src/main.js` → `./src/main.tsx`

### Step 6: Strip `.js` extensions from imports

All `from './foo.js'` → `from './foo'`

### Step 7: Run `tsc --noEmit` and fix type errors

Expected categories:
- `implicit any` on hook params and state setters
- `useRef(null)` needs explicit type params
- `EventTarget` subclass typing (AbstractStorage)
- `structuredClone` return types
- CSS `setProperty` with `null` values
- htm template expression types (usually permissive)

### Step 8: Run `npm run build` and verify

### Step 9: Gradually enable strict mode

Over subsequent commits:
1. `"strict": true` (enables `noImplicitAny`, `strictNullChecks`, etc.)
2. Add proper function return types
3. Add generic type params to hooks/storage
