# OpfsStorageBackend

## Purpose

Production implementation of `StorageBackend` that delegates directly to the `opfs-storage` module. Provides the framework's default flat session layout (`gps-plus-slam/sessions/{timestamp}/…`).

Apps that need a different on-disk layout (e.g. the recorder's `ScenarioWrappingStorageBackend`, which nests sessions under a named bucket) ship their own `StorageBackend` rather than extending this one.

## Public API

```typescript
export class OpfsStorageBackend implements StorageBackend {
  createSession(
    timestamp: Date,
    contextTag?: string
  ): Promise<CreateSessionResult>;
  listSessions(): Promise<string[]>;
  writeAction(action: unknown, index: number): Promise<void>;
  writeFrame(blob: Blob, index: number): Promise<void>;
  writeSessionMetadata(metadata: SessionMetadata): Promise<void>;
}
```

Each method delegates to the corresponding function in `opfs-storage.ts`:

- `createSession` → `opfsCreateSession` (creates `sessions/recording-{ts}/`; `contextTag` is accepted for interface parity but not used by the flat layout)
- `listSessions` → `opfsListSessions`
- `writeAction` → `opfsWriteAction`
- `writeFrame` → `opfsWriteFrame`
- `writeSessionMetadata` → `opfsWriteSessionMetadata`

## Invariants & Assumptions

- A session must exist (via `createSession`) before `writeAction`/`writeFrame` calls; otherwise the underlying `opfs-storage` functions throw "No active session".
- Errors propagate to caller — not caught internally.
- This is the **default** backend when no `storageBackend` option is passed to `createSlamAppStore()`.

## Examples

```typescript
import { OpfsStorageBackend } from './opfs-storage-backend';
import { createSlamAppStore } from '../state/create-slam-app-store';

// Production usage (this is also the default when omitted)
const store = createSlamAppStore({
  storageBackend: new OpfsStorageBackend(),
});
```

## Tests

- `storage-backend.test.ts` — covers interface compliance, delegation to the `opfs-storage` functions, and error propagation.
