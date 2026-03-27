# Contributing to opencode-review

First off, thanks for taking the time to contribute! This project is a CLI tool that uses parallel AI agents to review git diffs.

## Development Setup

1. **Fork and clone** the repository
   ```bash
   git clone https://github.com/dawooddilawar/opencode-review.git
   cd opencode-review
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Install opencode CLI** (required runtime dependency)
   ```bash
   npm install -g opencode-ai
   opencode auth login  # Optional, if you have your own API key
   ```

4. **Build the project**
   ```bash
   npm run build
   ```

5. **Link for local testing**
   ```bash
   npm link
   diffcheck --help
   ```

## Running Tests

```bash
# Run all tests
npm test

# Type check only
npm run typecheck

# Build only
npm run build
```

## Project Structure

```
opencode-review/
├── agents/           # Agent prompts (auto-discovered .md files)
├── src/              # TypeScript source code
│   ├── cli.ts        # Main CLI orchestration (also the bin entry point)
│   ├── args.ts       # Argument parsing
│   ├── runAgents.ts  # Agent discovery & execution
│   ├── git.ts        # Git diff operations
│   ├── aggregate.ts  # Issue aggregation & deduplication
│   └── ...
├── test/             # Unit tests
└── package.json
```

## Adding a New Agent

Agents are auto-discovered from `agents/*.md` files. To add a new review dimension:

1. Create a new markdown file in `agents/`:
   ```bash
   touch agents/performance.md
   ```

2. Follow the agent template structure:
   ```markdown
   You are a specialized code reviewer focused on **PERFORMANCE**.

   ## Investigation Workflow
   1. Identify performance-critical paths
   2. Look for N+1 queries, inefficient loops
   3. Check caching opportunities
   ...

   ## Output Schema
   Output JSON matching this schema:
   ```json
   {
     "issues": [
       {
         "type": "PERFORMANCE",
         "severity": "HIGH|MEDIUM|LOW",
         "title": "Brief description",
         "file": "path/to/file.ext",
         "line": 123,
         "evidence": "What you found",
         "impact": "Why it matters",
         "recommendation": "How to fix it",
         "confidence": 85
       }
     ]
   }
   ```

3. That's it! The agent will automatically run on the next review.

## Coding Standards

- **TypeScript strict mode** — All code must pass `npm run typecheck`
- **Zero runtime dependencies** — Use only Node.js built-ins
- **Test coverage** — Add tests for new functionality
- **Code style** — Follow existing patterns (ESLint config provided)

## Submitting Changes

1. **Create a branch** for your work
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes** and test thoroughly
   ```bash
   npm run build
   npm test
   npm link
   diffcheck --model ollama/qwen3:8b  # Test locally
   ```

3. **Commit** with clear messages
   ```bash
   git commit -m "Add: performance agent for memory leak detection"
   ```

4. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   # Then create PR on GitHub
   ```

## PR Checklist

Before submitting a PR, ensure:

- [ ] Tests pass locally (`npm test`)
- [ ] Type check passes (`npm run typecheck`)
- [ ] New agents follow the output schema
- [ ] Commits are clean and messages are clear
- [ ] PR description explains the **why**, not just the **what**

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions or ideas
- Check existing issues before creating new ones

Thanks for contributing! 🚀
