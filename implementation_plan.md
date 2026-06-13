# Plan to Reduce Remaining `any` Types

We have found 721 occurrences of `any` across the codebase (primarily type annotations like `: any` and generic type arguments like `<any>`). Only a single `as any` cast remains (in `src/polyfills.ts`), which is a legitimate prototype polyfill.

This plan aims to reduce the remaining `any` usages systematically by grouping them into 7 distinct categories.

---

## User Review Required

> [!NOTE]
> Eliminating these types is non-breaking because `any` is a wide type. Refining them to narrower, more accurate types will improve editor autocompletion and prevent runtime bugs without changing execution behavior.

---

## Proposed Changes

### 1. Icon Prop Typing
**Target File:** [index.tsx](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/components/icons/index.tsx)
- **Problem:** All 28 icon components destructure props as `: any`.
- **Proposed Solution:** Import `SVGProps` from `react` and type them as `SVGProps<SVGSVGElement>`.
```ts
import type { SVGProps } from 'react';
export const SVG = ({ stroke="currentColor", fill="currentColor", strokeWidth="0", children, ...props }: SVGProps<SVGSVGElement>) => { ... }
```

---

### 2. Storage & Database Layer Refactoring
**Target Files:**
- [AbstractStorage.ts](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/storage/AbstractStorage.ts)
- [SessionStorage.ts](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/storage/SessionStorage.ts)
- [TemplateStorage.ts](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/storage/TemplateStorage.ts)
- [ThemeStorage.ts](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/storage/ThemeStorage.ts)
- [ConnectionStorage.ts](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/storage/ConnectionStorage.ts)
- [IndexedDBAdapter.ts](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/storage/IndexedDBAdapter.ts)
- [ServerDBAdapter.ts](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/storage/ServerDBAdapter.ts)

- **Problem:** Adapters and storage classes utilize `: any` for connections, adapters, data payloads, and keys.
- **Proposed Solution:**
  1. Define a shared `DbConnection` type representing `IDBDatabase` or the server adapter's dynamic query function:
     ```ts
     export type DbConnection = IDBDatabase | ((route: string, options: any) => Promise<any>);
     ```
  2. Define a shared `DatabaseAdapter` interface:
     ```ts
     export interface DatabaseAdapter {
         sessionEndpoint?: string;
         init?(): Promise<void>;
         openDatabase(): Promise<DbConnection>;
         loadFromDatabase(db: DbConnection, storeName: string, key: string | number): Promise<any>;
         loadAllFromDatabase(db: DbConnection, storeName: string): Promise<Record<string, any>>;
         loadSessionInfoFromDatabase(db: DbConnection, storeName: string): Promise<Record<string, any>>;
         saveToDatabase(db: DbConnection, storeName: string, key: string | number, data: any): Promise<void>;
         renameSessionInDatabase(db: DbConnection, storeName: string, key: string | number, newName: string): Promise<void>;
         deleteFromDatabase(db: DbConnection, storeName: string, key: string | number): Promise<void>;
     }
     ```
  3. Replace `: any` annotations with `DbConnection`, `DatabaseAdapter`, and specific key types (`string | number`) across the storage classes.

---

### 3. Leverage Implicit Type Inference in Callbacks & Setters
**Target Files:**
- [Sidebar.tsx](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/components/Sidebar.tsx)
- [useGenerationLogic.ts](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/hooks/useGenerationLogic.ts)
- [useTokenCounters.ts](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/hooks/useTokenCounters.ts)
- And other UI components.

- **Problem:** Many inline arrow functions (e.g. state update handlers like `(prevState: any) => !prevState`, event handlers like `(e: any) => ...`) are typed as `any`.
- **Proposed Solution:** Delete the explicit `: any` type parameter annotation. Since React context, states, and hooks are already typed, TypeScript's contextual typing will automatically infer the parameters correctly.
```diff
- onClick=${() => setChatMode((prevState: any) => !prevState)}
+ onClick=${() => setChatMode((prevState) => !prevState)}
```

---

### 4. Replace Generic `<any>` Types
**Target Files:** Various modals, hooks, and views.
- **Problem:** Generic definitions like `useState<any>(null)` or `useRef<any>(null)` are used instead of explicit types.
- **Proposed Solution:** Narrow them to the exact shapes or elements:
  - `useRef<HTMLInputElement | null>(null)`
  - `useRef<NodeJS.Timeout | number | null>(null)`
  - `useState<string | null>(null)`
  - For AI Horde models state, declare:
    ```ts
    interface AIHordeModel {
        name: string;
        count: number;
        eta: number;
        type: string;
    }
    ```

---

### 5. Catch Clause Typing
**Target Files:** Across all files.
- **Problem:** Standard `catch (e: any)` or `catch (err: any)`.
- **Proposed Solution:** Change to `catch (e: unknown)` (or simply `catch (e)`) and safely check `e instanceof Error` or cast properties using safe helpers.

---

### 6. Component and Modal Properties
**Target Files:**
- [App.tsx](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/App.tsx)
- [ConnectionManagerModal.tsx](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/components/modals/ConnectionManagerModal.tsx)
- [SessionsModal.tsx](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/components/modals/SessionsModal.tsx)
- [InstructTemplatesModal.tsx](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/src/components/modals/InstructTemplatesModal.tsx)

- **Problem:** Component arguments destructure from `any`.
- **Proposed Solution:** Define clean interfaces for the props, e.g.:
```ts
interface SessionsModalProps {
    isOpen: boolean;
    closeModal: () => void;
    sessionStorage: SessionStorage;
    cancel: (() => void) | null;
}
```

---

### 7. Backend Server Database Types
**Target Files:**
- [database.ts](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/server/lib/database.ts)
- [data.ts](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/server/routes/data.ts)
- [proxy.ts](file:///home/satorin/Documents/programming%20socks/mikupad-refactored/server/routes/proxy.ts)

- **Problem:** Database rows and callback params default to `any`.
- **Proposed Solution:** Type query callback parameters accurately (e.g. `row: { value: string } | undefined` or database rows to a specific record type).

---

## Verification Plan

### Automated Tests
- Build verification: Run type checking using `npx tsc --noEmit`.
- Run `npm run build` to ensure the bundling pipeline succeeds without type errors.
