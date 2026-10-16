# AquaGuard Prompt Optimizer: privacy policy

*Last updated: 2026-10-17 · applies to extension version 0.1.0*

## Summary

AquaGuard processes your prompt **locally in your browser**. It does not send your prompts, browsing activity or personal data to the developer or to any third party.

## What the extension accesses

- **The prompt box** on chatgpt.com, chat.openai.com, claude.ai and gemini.google.com, so it can analyse the text you type and, when you choose Apply (or opt in to auto-apply), replace it with the shortened version.
- Nothing else on those pages, and nothing on any other website.

## What is stored, and where

All storage is `chrome.storage.local` on your device. It is not synced to the cloud by the extension.

| Data | When | Contains prompt text? |
|---|---|---|
| Settings (on/off, mode, delay, disabled sites, impact assumptions) | Always | No |
| Aggregate statistics (counts, estimated token numbers, rule names, dates) | **Only if you turn statistics on** | No |
| Your original prompt, for Undo | In memory of the open tab only, discarded when the tab closes | n/a (never stored) |

## What is transmitted

Nothing. The extension contains no network requests, analytics, telemetry or remote code. (The chat website you use still receives whatever prompt **you** send to it, under that website's own privacy policy.)

## Your controls

- Turn the extension off globally or per site from the toolbar popup.
- Statistics are off by default. Turn them on or off at any time in Settings.
- **Reset statistics** or **Reset all settings and data** in Settings deletes the stored data immediately.
- Uninstalling the extension removes all of its stored data.

## Permissions

- `storage`: save your settings and optional statistics.
- Site access to the four chat sites listed above: read and replace the prompt box text.

## Future changes

If an optional cloud-based compressor is ever added, it will be **off by default**, will require explicit opt-in, and will name the destination service before any text is sent. This policy will be updated first.
