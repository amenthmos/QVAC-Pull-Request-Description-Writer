# QVAC Pull Request Description Writer

Describe the changes you made and why, and an on-device AI writes a structured PR description with Summary, Changes, and Testing sections. No cloud call, no API key.

## Run

```bash
npm install
npm start
```

Then open http://localhost:32009

## Example

Input:

> added rate limiting to the login endpoint to prevent brute force attacks, tested with a script that sends 100 requests per second

Output:

```
## Summary
- Added rate limiting to the login endpoint to prevent brute force attacks.

## Changes
- Added rate limiting to the login endpoint to prevent brute force attacks.

## Testing
- Tested with a script that sends 100 requests per second.
```

The description is split deterministically into a change part, an optional "because ..." motivation, and any testing-related clause, so the Testing section reflects only what was actually described instead of the model guessing or denying that testing happened.

## QVAC SDK version

`@qvac/sdk` ^0.19.0 (see `package.json`).

## How it works

Built on [Tether's QVAC SDK](https://www.npmjs.com/package/@qvac/sdk) — all inference runs on-device, no cloud call, no API key. The app loads `LLAMA_3_2_1B_INST_Q4_0` locally with `loadModel()`, generates with `completion()` (streamed via `tokenStream`), and releases the model with `unloadModel()` on shutdown.

## License

MIT
