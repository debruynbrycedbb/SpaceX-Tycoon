# Starlink Launch Tycoon

A browser tycoon prototype: buy satellites, load the rocket, launch, deploy, recover the booster, earn orbital income, expand.

Fan-made prototype. Not affiliated with or endorsed by SpaceX.

## Play locally

Open `index.html` in a browser. No build step and no dependencies.

## Publish on GitHub Pages

1. Push these files to the `main` branch of the repository, with `index.html` at the top level.
2. On GitHub open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then save.
4. After a minute the game is live at `https://debruynbrycedbb.github.io/SpaceX-Tycoon/`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | Pixel-art interface styling |
| `game.js` | All game logic. Balance numbers are in the `CONFIG` block at the top |
| `assets/` | Web-sized copies of the reference art used for the mission view |
| `Reference rocket images/` | Original full-size reference art (not loaded by the game) |

## How the prototype works

- **Start:** 1 Falcon 9 booster, 1 pad, 10 Starlink V1 satellites, $0 cash.
- **Launch stages:** prepare, launch, booster recovery, satellite deployment, upper-stage disposal, turnaround. Booster recovery and deployment run in parallel and succeed or fail independently.
- **Economy:** every active satellite pays its tier income each second. Cash buys satellites, refuels ($60, 60 s), boosters, pads and upgrades.
- **Tiers:** ten satellite tiers unlock from lifetime earnings.
- **Risk:** the first flight is guaranteed. Later flights can fail at launch, landing or deployment, and the odds are shown before launch. If the company ever has no income and no way to fly, investors supply a booster and 10 satellites.
- **Saving:** progress saves in the browser and earns income while away, capped at 8 hours.

## Balancing tips

- Edit `TIERS`, `BASE`, `GLOBAL_UPS` and `PAD_UPS` at the top of `game.js`.
- Add `?speed=10` to the page address to run the simulation ten times faster while testing.
- In the browser console, `__tycoon.state` exposes the live game state and `__tycoon.reset()` wipes the save.
