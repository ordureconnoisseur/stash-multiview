# Multi-View Player

A Stash plugin that lets you queue scenes from any browse page and watch up to 9 simultaneously in a minimal grid player.

## Requirements

- [Stash](https://stashapp.cc) v0.27+

## Installation

### Option 1 — Automatic (recommended)

1. In Stash go to **Settings → Plugins → Add Source** and enter:
   ```
   https://ordureconnoisseur.github.io/plugins/main/index.yml
   ```
2. Find **Multi-View Player** in the plugin browser and click **Install**

### Option 2 — Manual

1. Download this repository (Code → Download ZIP) and extract it
2. Place the `multiView` folder inside a category subfolder of your Stash plugins directory:
   - **Linux/Mac:** `~/.stash/plugins/Utilities/multiView/`
   - **Windows:** `%USERPROFILE%\.stash\plugins\Utilities\multiView\`

   > The plugin must be **two levels deep** inside the plugins directory — `plugins/Category/Plugin/`. Placing it directly under `plugins/` will cause it not to appear in Stash.

3. In Stash, go to **Settings → Plugins** and click **Reload Plugins**
4. Enable **Multi-View Player**

## Usage

### Picking Mode

On any scene browse page, click the grid icon button in the toolbar (next to the view mode buttons, before the zoom slider) to enable **Picking Mode**. While active, each scene card shows a **+** button in the top-right corner. Click it to add that scene to your queue — the button turns orange and shows a **✓** to confirm it's queued.

You can queue up to **9 scenes** at once.

![Picking Mode](screenshot-picking.png)

### Scene Detail Page

On an individual scene's page, a grid icon button appears in the scene toolbar. Click it to toggle that scene in or out of your queue — it turns orange when the scene is queued.

### Launching the Player

Once at least one scene is queued, a floating **Open Multiview** launcher appears in the bottom-right corner of the screen. It shows the number of queued scenes and opens the player in a new tab. Click **✕** to clear the queue without opening the player.

The queue is shared across tabs — adding scenes on one tab is immediately reflected in another.

![Player](screenshot-player.png)

### Player Controls

| Control | Action |
|---|---|
| Click a cell | Play / pause that scene |
| Seekbar (bottom of cell) | Scrub to any position |
| Volume button | Open per-cell volume slider |
| Mute button | Toggle mute for that cell |
| **O** button | Increment the scene's O counter |
| **✕** button | Remove scene from the grid |
| Pause All (top bar) | Play / pause all scenes simultaneously |
| Mute All (top bar) | Mute / unmute all scenes simultaneously |
| **O All** (top bar) | Increment O counter on all scenes |

The cell with active audio is highlighted with an orange outline.

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause all |
| `M` | Mute / unmute all |
