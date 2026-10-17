# Chrome Web Store submission: AquaGuard Prompt Optimizer

Everything needed for a manual submission, in the order the Developer Dashboard asks for it. Copy each block into the matching field.

**Not done for you (needs your account and payment):** registering a developer account, paying the one-time fee, uploading, and clicking *Submit for review*. Nothing has been submitted.

---

## 0. Before you start (one time)

1. Go to the Chrome Web Store Developer Dashboard (search "Chrome Web Store Developer Dashboard", it lives at `chrome.google.com/webstore/devconsole`) and sign in with the Google account you want listed as the publisher.
2. Accept the developer agreement and pay the **one-time US$5 registration fee**.
3. Verify your contact email (Account tab). Submissions are blocked until it is verified.
4. Optional but recommended: turn on 2-step verification for that Google account (required for publishing).

## 1. Upload the package

Build the ZIP from the repository root:

```bash
python scripts/package_extension.py --check
```

Upload `dist/aquaguard-prompt-optimizer-0.2.1.zip` with **New item**. It contains only runtime files (manifest, `src/`, `popup/`, `options/`, `ui/`, `icons/`) and was verified to install in Chrome.

## 2. Store listing tab

**Name** (from the manifest, not editable here): `AquaGuard Prompt Optimizer`

**Summary** (from the manifest description, 115/132 characters):

```
Shortens verbose AI prompts locally before you send them. Automatic or manual, one-click Undo, never sends for you.
```

**Description** (paste as-is):

```
AquaGuard shortens wordy AI prompts on your own computer, before you send them, so the AI has fewer tokens to process. Your requirements stay intact.

HOW IT WORKS
Type a prompt in a supported AI chat and pause. AquaGuard removes filler such as greetings, "could you please…", "I would like you to…", "thanks in advance", repeated instructions and recap sentences, and keeps everything that matters.

The first time, it asks how you want to work:
• Automatic: your draft is replaced with the shorter version after you pause typing. A small indicator shows the tokens saved, and Undo restores your exact original in one click.
• Manual: you see the shorter version with a red/green comparison and click Apply when you want it.
Change modes any time from the toolbar icon.

WHAT IT NEVER DOES
• It never sends, submits or presses Enter for you. You always press Send yourself.
• It never changes numbers, units, dates, code, links, quoted text, or words like "not", "never", "only" and "must". Every rewrite is checked, and if a change could affect your meaning, your original is kept.
• It doesn't replace text while you're typing, while your cursor is mid-text, or while you're using an input method (IME).

PRIVATE BY DESIGN
• All processing happens in your browser. The extension makes no network requests.
• Your prompts are never stored or sent anywhere. The original is kept in memory only, for Undo.
• Optional usage statistics are off by default and contain only counts, never prompt text.
• Turn it off everywhere or on individual sites.

SUPPORTED SITES
ChatGPT (chatgpt.com), with experimental support for Claude (claude.ai) and Gemini (gemini.google.com). A built-in "Try it" box in Settings works with any text.

HONEST NUMBERS
Savings depend on how wordy a prompt is: typically 0–35% of prompt tokens; already-concise prompts are left alone. Token counts are local estimates and differ slightly between AI providers. Fewer input tokens means less work for the AI model, but AquaGuard does not measure energy or water use.

Open source: https://github.com/keithdias07/aquaguard-data-center-water-monitor
```

**Category:** Productivity → Tools (if the dashboard shows the older single list, choose *Productivity*).

**Language:** English.

**Graphic assets** (all in `store/images/`, rebuilt with `node ../store/build_store_assets.js` from `extension/`):

| Field | File | Size |
|---|---|---|
| Store icon | `extension/icons/icon128.png` | 128×128 |
| Screenshot 1 | `screenshot-1.png`: automatic mode on a real prompt (−25.9%, Undo) | 1280×800 |
| Screenshot 2 | `screenshot-2.png`: review panel with the diff | 1280×800 |
| Screenshot 3 | `screenshot-3.png`: one-time Automatic/Manual question | 1280×800 |
| Screenshot 4 | `screenshot-4.png`: popup + privacy points | 1280×800 |
| Screenshot 5 | `screenshot-5.png`: settings "Try it" and statistics | 1280×800 |
| Small promo tile (required) | `promo-small-440x280.png` | 440×280 |
| Marquee promo (optional) | `promo-marquee-1400x560.png` | 1400×560 |

All screenshots show the real extension running in Chrome on a neutral demo chat page. They contain no third-party logos or look-alike interfaces.

**Official URL:** leave empty (needs a verified domain). **Homepage URL:** `https://github.com/keithdias07/aquaguard-data-center-water-monitor`. **Support URL:** `https://github.com/keithdias07/aquaguard-data-center-water-monitor/issues`

## 3. Privacy practices tab

**Single purpose description:**

```
AquaGuard shortens the prompt a user is writing in a supported AI chat website, locally in the browser, before the user sends it, while preserving the prompt's requirements.
```

**Permission justifications:**

| Permission | Justification to paste |
|---|---|
| `storage` | `Saves the user's settings (on/off, Automatic/Manual mode, delay, disabled sites) and, only if the user turns it on, aggregate usage counts. Stored locally with chrome.storage.local; no prompt text is stored.` |
| Host permissions (content scripts on chatgpt.com, chat.openai.com, claude.ai, gemini.google.com) | `The content script reads the prompt box on these AI chat sites to compute a shorter version locally, and replaces the prompt box text when the user clicks Apply or has chosen Automatic mode. It runs only on these four sites and reads nothing else on the page.` |

**Remote code:** **No, I am not using remote code.** (All JavaScript is in the package; there is no `eval` and nothing is loaded from the network.)

**Data usage.** Recommended answers, based on how the code behaves. You are the publisher, so confirm they match your understanding:
- *What user data do you plan to collect?* **None.** The extension reads the prompt box text in order to shorten it, but that text is processed only in the browser and is never transmitted off the device, stored, or shared. Settings and optional statistics stay in `chrome.storage.local` on the user's device.
- Tick all three certifications: you do not sell or transfer user data to third parties; you do not use or transfer it for purposes unrelated to the single purpose; you do not use it to determine creditworthiness or for lending.

**Privacy policy URL:**

```
https://github.com/keithdias07/aquaguard-data-center-water-monitor/blob/main/docs/PRIVACY.md
```

## 4. Distribution tab

- **Visibility:** *Public* (anyone can find it), or *Unlisted* if you only want to share the link first.
- **Regions:** all regions.
- **Pricing:** free (the dashboard no longer offers paid items).

## 5. Test instructions (optional field; helps reviewers)

```
No account or login is needed for basic testing.
1. Open https://chatgpt.com (the logged-out composer works).
2. Type a prompt of 40+ characters, for example:
   "Hi there! Could you please explain how binary search works in a sorted array? Please do not use code longer than 10 lines. Thanks in advance!"
3. Pause for about one second. A small card asks "Shorten prompts automatically?". Click Automatic.
4. The text becomes: "Explain how binary search works in a sorted array. Do not use code longer than 10 lines." An indicator shows the tokens saved; click Undo to restore the original.
5. Nothing is ever sent automatically; the user presses Send.
The toolbar popup switches modes (Automatic / Manual / Preview only) and turns the extension off globally or per site. Settings has a "Try it" box that works without visiting any site.
```

## 6. Submit

Click **Submit for review**. Review usually takes a few days; extensions requesting site access can take longer. You'll get an email with the result. If it is rejected, the email names the policy. Send it to me and I'll fix the extension or the listing.

## Checklist

- [ ] Developer account registered, fee paid, contact email verified
- [ ] `dist/aquaguard-prompt-optimizer-0.2.1.zip` uploaded
- [ ] Summary, description, category, language filled in
- [ ] Icon, 5 screenshots and small promo tile uploaded (marquee optional)
- [ ] Homepage and support URLs set
- [ ] Single purpose, both permission justifications, remote code = No
- [ ] Data usage = none collected, three certifications ticked
- [ ] Privacy policy URL set (the PRIVACY.md change must be pushed to GitHub `main` first, so the URL shows the current text)
- [ ] Visibility and regions chosen
- [ ] Test instructions pasted
- [ ] Submitted for review
