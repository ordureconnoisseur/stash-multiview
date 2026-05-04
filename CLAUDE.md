# multiView Plugin — Claude Context

## Repo locations

| Location | Path | Purpose |
|---|---|---|
| Mac (canonical) | `/Users/ethork/stash-multiview` | Work here, push to GitHub from here |
| PC repo | `C:\Users\ethork\stash-multiview-repo` | Mirror — pull from GitHub to keep in sync |
| PC live plugin | `C:\Users\ethork\.stash\plugins\multiView\` | What Stash actually loads |
| GitHub | `https://github.com/ordureconnoisseur/stash-multiview` | Source of truth |
| Stash plugin index | `https://github.com/ordureconnoisseur/plugins` | Community index listing for Stash's plugin browser |

## Sync workflow

`C:\Users\ethork\.stash\plugins\multiView` is a Windows junction pointing to `C:\Users\ethork\stash-multiview-repo` — they are the same folder. Pulling the repo instantly updates the live plugin, no file copying needed.

**Making changes:**
1. Edit files in `/Users/ethork/stash-multiview` on the Mac
2. `git push` from the Mac — credentials work here, not over SSH to the PC
3. Pull on PC: `ssh pc "cd C:\Users\ethork\stash-multiview-repo && git pull"`

**SSHing to PC:** `ssh pc` (host alias defined in `~/.ssh/config`, key at `~/.ssh/id_ed25519_pc`)

**Windows shell note:** `ls` doesn't work over SSH to the PC — use `dir` or `powershell -Command "..."`. Prefer `scp` for file transfers rather than PowerShell heredocs (avoids encoding/line-ending issues).

## Plugin files

| File | Purpose |
|---|---|
| `multiView.js` | Main plugin — injected into Stash UI |
| `multiView.css` | Styles for the scenes-list UI additions |
| `multiView-player.js` | The multiview player page logic |
| `multiView-player.css` | Player page styles |
| `multiView.yml` | Stash plugin manifest |
| `index.html` | Player page HTML (`/plugin/multiView/assets/index.html`) |
