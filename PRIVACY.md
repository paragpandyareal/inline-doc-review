# Privacy policy

_Lazy Panda Panel, a Claude Code plugin by Parag Pandya. Last updated 9 October 2026._

**In short: the plugin collects nothing and sends nothing to its author or to anyone else.**

## What it reads
The plugin reads the files you open in its pane, and files Claude writes in your session, so it can show them. Those files can contain personal information, such as names or email addresses in a document. They are read on your own computer and held in memory only while the pane is open.

## What it stores
- The auto-open on/off setting, in Claude Code's own plugin store on your computer.
- If you run `/panda setup`, a Python environment in `.cache/lazy-panda-panel` in your home folder. It contains software packages, not your data.

Your documents and comments are not saved anywhere by the plugin. They last for the session only.

## What it sends, and where
- **Nothing to the author or any third party.** There is no server, no account, no analytics and no telemetry.
- **Your comments, to Claude, only when you press Send** (or Enter after "Edit before sending"). They go as a normal prompt in your own Claude Code session, with the quoted parts of the file you commented on. Like anything you type in Claude Code, that prompt goes to Anthropic under your account and is kept in your session transcript. [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy) covers it from there.
- **`/panda setup` downloads packages from PyPI** (pypi.org and files.pythonhosted.org). It sends none of your data.

## Retention
The plugin keeps no data from Claude or from your files beyond the session.

## Children
The plugin is not intended for people under 18.

## Contact
Questions about privacy: open an issue at https://github.com/paragpandyareal/lazy-panda-panel/issues. Report security problems privately as described in [SECURITY.md](SECURITY.md).
