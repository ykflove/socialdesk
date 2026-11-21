# Contributing

Thanks for helping. Socialdesk aims to stay **dependency-free and easy to self-host**.

1. Fork the repository, then create a branch.
2. Run `npm start` and make your change.
3. Run `npm test`. All tests must pass. Add a test for new API behaviour.
4. Open a pull request that explains what changed and why.

Guidelines:
- No npm dependencies unless there is no reasonable alternative. Use Node built-ins (`node:sqlite`, `fetch`, `crypto`).
- Every database query that takes an id from a request must be scoped to the caller's workspace. Use `brandFor`, `accountFor` and `postFor` in `server.js`.
- Network adapters live in `src/networks/`. Each one exports `id`, `label`, `color`, `limits`, `fields`, `verify()` and `publish()`, plus optionally `stats()` and `metrics()`.
- Never log tokens or secrets.
