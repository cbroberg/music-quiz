# Monorepo Migration Plan

> **Status:** PLANNED — execute after current refactor session is complete  
> **Goal:** Convert `cbroberg/apple-music-mcp` → `cbroberg/music-quiz` pnpm monorepo  
> **Why:** Prepare for tvOS app alongside existing Node.js/TypeScript packages

---

## 1. Target Structure

```
music-quiz/
├── pnpm-workspace.yaml
├── turbo.json
├── package.json                  ← root workspace (no app code)
├── .claude/
│   └── CLAUDE.md                 ← updated for monorepo
├── packages/
│   ├── mcp-server/               ← MCP backend + Express server
│   │   ├── package.json          ← name: @music-quiz/mcp-server
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts          ← from src/index.ts (MCP tools)
│   │   │   ├── apple-music.ts    ← from src/apple-music.ts
│   │   │   ├── oauth.ts          ← from src/oauth.ts
│   │   │   ├── token.ts          ← from src/token.ts
│   │   │   ├── token-store.ts    ← from src/token-store.ts
│   │   │   ├── browser-ws.ts     ← from src/browser-ws.ts
│   │   │   └── home-ws.ts        ← from src/home-ws.ts
│   │   └── server.js             ← from root server.js
│   │
│   ├── quiz-engine/              ← quiz game logic (pure, no Express)
│   │   ├── package.json          ← name: @music-quiz/quiz-engine
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── engine.ts         ← from src/quiz/engine.ts
│   │       ├── dj-mode.ts        ← from src/quiz/dj-mode.ts
│   │       ├── ai-enricher.ts    ← from src/quiz/ai-enricher.ts
│   │       ├── ai-evaluator.ts   ← from src/quiz/ai-evaluator.ts
│   │       ├── quiz-manager.ts   ← from src/quiz-manager.ts
│   │       ├── event-store.ts    ← from src/quiz/event-store.ts
│   │       ├── gossip-bank.ts    ← from src/quiz/gossip-bank.ts
│   │       ├── playlist-store.ts ← from src/quiz/playlist-store.ts
│   │       ├── question-bank.ts  ← from src/quiz/question-bank.ts
│   │       ├── routes.ts         ← from src/quiz/routes.ts
│   │       ├── ws-handler.ts     ← from src/quiz/ws-handler.ts
│   │       ├── playback/         ← from src/quiz/playback/
│   │       ├── public/           ← from src/quiz/public/
│   │       └── data/             ← from src/quiz/data/
│   │
│   ├── web/                      ← Next.js party game UI
│   │   ├── package.json          ← name: @music-quiz/web
│   │   ├── next.config.ts        ← from web/next.config.ts
│   │   ├── tsconfig.json         ← from web/tsconfig.json
│   │   ├── postcss.config.mjs    ← from web/postcss.config.mjs
│   │   ├── app/                  ← from web/app/
│   │   ├── components/           ← from web/components/
│   │   ├── hooks/                ← from web/hooks/
│   │   ├── lib/                  ← from web/lib/
│   │   └── public/               ← from web/public/
│   │
│   └── shared/                   ← shared types + constants
│       ├── package.json          ← name: @music-quiz/shared
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts          ← barrel export
│           ├── types.ts          ← from src/quiz/types.ts + new shared types
│           ├── ws-messages.ts    ← WebSocket message type contracts
│           └── constants.ts      ← shared config constants
│
├── apps/
│   └── tvos/                     ← native tvOS WKWebView shell (Phase 2)
│       ├── MusicQuiz.xcodeproj/
│       ├── MusicQuiz/
│       │   ├── App.swift
│       │   ├── WebViewContainer.swift
│       │   ├── FocusManager.swift
│       │   └── NativeBridge.swift
│       └── MusicQuizTests/
│
├── home/                         ← Home Controller (stays at root)
│   ├── server.ts
│   ├── start.sh
│   └── tsconfig.json
│
├── data/                         ← persistent data dir (fly.io volume)
├── docs/                         ← all plan/feature docs
├── logo/
├── public/                       ← root static assets
├── scripts/
├── Dockerfile
├── fly.toml
└── env.example
```

---

## 2. Migration Steps (for cc)

### Phase 1: Create new repo + workspace config

```bash
# 1. Create new repo cbroberg/music-quiz on GitHub

# 2. Clone existing repo and rename
git clone git@github.com:cbroberg/apple-music-mcp.git music-quiz
cd music-quiz
git remote set-url origin git@github.com:cbroberg/music-quiz.git
```

### Phase 2: Initialize pnpm workspace

**Root `package.json`:**
```json
{
  "name": "music-quiz",
  "version": "4.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.12.1",
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "lint": "turbo lint",
    "clean": "turbo clean"
  },
  "devDependencies": {
    "turbo": "^2.5.4",
    "typescript": "^6.0.2"
  }
}
```

**`pnpm-workspace.yaml`:**
```yaml
packages:
  - "packages/*"
```

> **Note:** `apps/tvos/` is intentionally NOT in workspace — Xcode manages its own deps via Swift Package Manager.

**`turbo.json`:**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "clean": {
      "cache": false
    }
  }
}
```

### Phase 3: Create package directories + move files

```bash
# Create package structure
mkdir -p packages/{mcp-server/src,quiz-engine/src,web,shared/src}
mkdir -p apps/tvos

# Move MCP server files
mv src/index.ts packages/mcp-server/src/
mv src/apple-music.ts packages/mcp-server/src/
mv src/oauth.ts packages/mcp-server/src/
mv src/token.ts packages/mcp-server/src/
mv src/token-store.ts packages/mcp-server/src/
mv src/browser-ws.ts packages/mcp-server/src/
mv src/home-ws.ts packages/mcp-server/src/
mv server.js packages/mcp-server/

# Move quiz engine files
mv src/quiz/engine.ts packages/quiz-engine/src/
mv src/quiz/dj-mode.ts packages/quiz-engine/src/
mv src/quiz/ai-enricher.ts packages/quiz-engine/src/
mv src/quiz/ai-evaluator.ts packages/quiz-engine/src/
mv src/quiz-manager.ts packages/quiz-engine/src/
mv src/quiz/event-store.ts packages/quiz-engine/src/
mv src/quiz/gossip-bank.ts packages/quiz-engine/src/
mv src/quiz/playlist-store.ts packages/quiz-engine/src/
mv src/quiz/question-bank.ts packages/quiz-engine/src/
mv src/quiz/routes.ts packages/quiz-engine/src/
mv src/quiz/ws-handler.ts packages/quiz-engine/src/
mv src/quiz/playback packages/quiz-engine/src/
mv src/quiz/public packages/quiz-engine/src/
mv src/quiz/data packages/quiz-engine/src/
mv src/quiz.ts packages/quiz-engine/src/

# Move web app files
mv web/app packages/web/
mv web/components packages/web/
mv web/hooks packages/web/
mv web/lib packages/web/
mv web/public packages/web/
mv web/next.config.ts packages/web/
mv web/tsconfig.json packages/web/
mv web/postcss.config.mjs packages/web/
mv web/next-env.d.ts packages/web/

# Create shared package from quiz types
cp src/quiz/types.ts packages/shared/src/types.ts

# Cleanup old dirs
rm -rf src/ web/
```

### Phase 4: Create package.json for each package

**`packages/mcp-server/package.json`:**
```json
{
  "name": "@music-quiz/mcp-server",
  "version": "4.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc && NODE_ENV=development node server.js",
    "start": "node server.js",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.82.0",
    "@modelcontextprotocol/sdk": "^1.28.0",
    "@music-quiz/quiz-engine": "workspace:*",
    "@music-quiz/shared": "workspace:*",
    "cookie-parser": "^1.4.7",
    "dotenv": "^17.3.1",
    "express": "^5.2.1",
    "iron-session": "^8.0.4",
    "jsonwebtoken": "^9.0.3",
    "qrcode": "^1.5.4",
    "ws": "^8.20.0"
  }
}
```

**`packages/quiz-engine/package.json`:**
```json
{
  "name": "@music-quiz/quiz-engine",
  "version": "4.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.82.0",
    "@music-quiz/shared": "workspace:*",
    "howler": "^2.2.4"
  }
}
```

**`packages/web/package.json`:**
```json
{
  "name": "@music-quiz/web",
  "version": "4.0.0",
  "type": "module",
  "scripts": {
    "build": "next build",
    "dev": "next dev",
    "clean": "rm -rf .next"
  },
  "dependencies": {
    "@music-quiz/shared": "workspace:*",
    "next": "^16.2.1",
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.2.2",
    "postcss": "^8.5.8",
    "tailwindcss": "^4.2.2"
  }
}
```

**`packages/shared/package.json`:**
```json
{
  "name": "@music-quiz/shared",
  "version": "4.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist"
  }
}
```

### Phase 5: Fix imports

All cross-package imports must be updated:

```typescript
// Before (relative path within monolith)
import { QuizState } from './quiz/types.js';

// After (workspace dependency)
import { QuizState } from '@music-quiz/shared';
```

Key import changes:
- `src/quiz/types.ts` exports → import from `@music-quiz/shared`
- `src/quiz/*` → import from `@music-quiz/quiz-engine`
- mcp-server depends on quiz-engine + shared
- web depends on shared
- quiz-engine depends on shared

### Phase 6: Create tsconfig for each package

Each package gets its own `tsconfig.json` extending a shared root config:

**Root `tsconfig.base.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

Each package tsconfig:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### Phase 7: Update deployment files

**`Dockerfile`** — update build commands:
```dockerfile
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/ packages/
RUN pnpm install --frozen-lockfile
RUN pnpm build
COPY home/ home/
COPY data/ data/
COPY public/ public/
CMD ["node", "packages/mcp-server/server.js"]
```

**`fly.toml`** — update app name:
```toml
app = 'music-quiz'
# ... rest stays the same
```

> **Note:** `fly apps rename` eller opret ny app og migrer secrets.

### Phase 8: Update CLAUDE.md

Update `.claude/CLAUDE.md` to reflect:
- New monorepo structure
- Package dependency graph
- Build commands (`pnpm build`, `pnpm --filter @music-quiz/web dev`)
- That `apps/tvos/` is outside pnpm workspace

---

## 3. Dependency Graph

```
@music-quiz/shared          ← zero deps, pure types + constants
       ↑
@music-quiz/quiz-engine     ← depends on shared
       ↑
@music-quiz/mcp-server      ← depends on quiz-engine + shared
       
@music-quiz/web             ← depends on shared

apps/tvos/                  ← no TS deps, communicates via WebSocket/HTTP
```

---

## 4. Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package manager | pnpm | Matches all other WebHouse projects |
| Build orchestrator | Turbo | Matches all other WebHouse projects |
| npm scope | `@music-quiz` | Clean namespace, not under `@webhouse` (this is a personal/party project) |
| tvOS location | `apps/tvos/` outside workspace | Xcode uses SPM, not pnpm |
| `home/` location | Root level | Home Controller runs on Mac, not deployed — keep isolated |
| Repo name | `music-quiz` | Reflects product identity, not implementation detail |
| Version | 4.0.0 | Breaking structural change warrants major bump |

---

## 5. Validation Checklist

After migration, verify:

- [ ] `pnpm install` succeeds from root
- [ ] `pnpm build` builds all packages in correct order (shared → quiz-engine → mcp-server + web)
- [ ] `pnpm --filter @music-quiz/mcp-server dev` starts MCP server + Express
- [ ] `pnpm --filter @music-quiz/web dev` starts Next.js dev server
- [ ] WebSocket connections work between mcp-server and web
- [ ] MCP tools respond correctly via SSE at `/mcp`
- [ ] Quiz flow works end-to-end (create → join → play → scores)
- [ ] Home Controller (`home/server.ts`) compiles and connects
- [ ] `fly deploy` succeeds with new Dockerfile
- [ ] OAuth flow works at `https://music.quiz-mash.com/auth`
- [ ] Old `apple-music-mcp` repo archived on GitHub

---

## 6. Post-Migration

- Archive `cbroberg/apple-music-mcp` on GitHub (Settings → Archive)
- Update MCP config in Claude Desktop / claude.ai to point to new SSE URL if app name changes
- Update `music.quiz-mash.com` DNS/CNAME if fly app name changes
- Update any references in other repos (e.g. `webhousecode/cms` docs)
- Update memory/context references from `apple-music-mcp` → `music-quiz`
