# Starlink Launch Tycoon

A browser tycoon game: buy satellites, load the rocket, launch, deploy, recover the booster, earn orbital income, expand. You run it from a walkable 3D launch control room that overlooks the pad, and you can fly the stage separation and booster landing yourself.

Fan-made prototype. Not affiliated with or endorsed by SpaceX.

## Play locally

The 3D view loads its models over HTTP, so run a small local server in this folder and open the address it prints. Opening `index.html` directly still works, but only with the 2D art.

```bash
python3 -m http.server 8000
```

## Publish on GitHub Pages

1. Push these files to the `main` branch of the repository, with `index.html` at the top level.
2. On GitHub open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then save.
4. After a minute the game is live at `https://debruynbrycedbb.github.io/SpaceX-Tycoon/`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | Interface styling |
| `game.js` | All game rules. Balance numbers are in the `CONFIG` block at the top |
| `view3d.js` | The outside world and mission cameras, built with Three.js. It only draws the game state |
| `room.js` | The walkable launch control room: movement, consoles, screens, launch button and hologram |
| `assets/models/` | Web-ready 3D models, with textures shrunk for faster loading |
| `assets/*.jpg` | 2D art, used as a fallback when 3D cannot load |
| `3D Models/`, `Reference rocket images/` | Original downloads, not loaded by the game |

When you change `game.js`, `view3d.js` or `style.css`, bump the `?v=` number on their links in `index.html` so browsers fetch the new version.

## How the game works

- **Start:** 1 Falcon 9 booster, 1 pad, 10 Starlink V1 satellites, $0 cash.
- **Launch stages:** prepare, launch, booster recovery, satellite deployment, upper-stage disposal, turnaround. Booster recovery and deployment run in parallel and succeed or fail independently.
- **Economy:** every active satellite pays its tier income each second. Cash buys satellites, refuels ($60, 60 s), boosters, pads and upgrades.
- **Tiers:** ten satellite tiers unlock from lifetime earnings.
- **Risk:** the first flight is guaranteed. Later flights can fail at launch, landing or deployment, and the odds are shown before launch. If the company ever has no income and no way to fly, investors supply a booster and 10 satellites.
- **Saving:** progress saves in the browser and earns income while away, capped at 8 hours.

## The control room

On a desktop browser the game opens inside a launch control room at the top of a tower beside the pad.

- **Move:** click the view to take the mouse, then use WASD to walk and the mouse to look. Esc frees the mouse.
- **Use a console:** walk up and press E. The matching panel opens on the right. Press E or Esc to step away.
- **Jump to a console:** press 1 to 5.

| Key | Console | What it does |
|---|---|---|
| 1 | Launch console | The covered red button by the window. Press E to launch the selected pad |
| 2 | Payload and flight plan | Buy and load satellites, choose autopilot or manual, choose the landing site |
| 3 | Fleet console | Boosters, pads and pad upgrades |
| 4 | Upgrades console | Reliability and payload upgrades, satellite tiers |
| 5 | Constellation hologram | The hologram Earth shows every satellite in orbit, coloured by tier |

Screens around the room show launch readiness, mission stages, live camera feeds, company figures, fleet status and the event feed. The **Dashboard view** button in the top bar switches to the flat layout, which phones and narrow windows always use.

The room's walkable floor is a baked grid in `room.js`. If the room model changes, the grid has to be sampled again.

## Flight plan and hands-on moments

Each pad has a flight plan, chosen before launch.

- **Flight control: Autopilot or Manual.** Autopilot uses the success odds. In Manual you fly two moments yourself.
  - **Stage separation:** press SPACE or tap when the marker reaches the bright zone. Perfect timing guarantees deployment and adds landing fuel. A mistimed press raises deployment risk and cuts landing fuel.
  - **Booster landing:** hold SPACE to fire the engine and use the arrow keys to lean. On a phone, use the on-screen buttons. Touch down slowly, upright and on the target. A perfect landing makes the next refuel free and twice as fast. A hard landing damages the booster. A crash loses it.
- **Landing site: Landing zone or Drone ship.** The drone ship allows 30% more payload. Its deck is smaller and moves, and the ship takes 45 s to bring the booster home.

Manual flight needs the 3D view. If 3D cannot load, the game falls back to the 2D art and autopilot.

## Balancing and testing tips

- Edit `TIERS`, `BASE`, `FLIGHT`, `GLOBAL_UPS` and `PAD_UPS` at the top of `game.js`.
- Add `?speed=10` to the page address to run the simulation ten times faster. The manual landing always runs in real time.
- In the browser console, `__tycoon.state` exposes the live game state and `__tycoon.reset()` wipes the save.
- `Room.tp(x, z, yaw, pitch)` moves the player in the control room, and `Room.pick(x, y)` reports what part of the room model is under a screen point.
- `View3D.force = { key: 'landing', p: 0.5 }` previews a 3D scene without flying. Keys: `orbit`, `pad`, `ignite`, `ascent`, `coast`, `deploy`, `deorbit`, `return`, `landing`, `landed`. Set it back to `null` to resume.

## Credits

3D models from Sketchfab, used under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Textures were resized for the web.

- [Falcon 9 - SpaceX](https://sketchfab.com/3d-models/falcon-9-spacex-394f7cf52d124bbd9db69f24d1ff2f08) by Stanley Creative
- [Planet Earth](https://sketchfab.com/3d-models/planet-earth-eb83482f3a2a415eb73e4c73790fce21) by rodrigoscar
- [SpaceX Falcon 9 Strongback](https://sketchfab.com/3d-models/spacex-falcon-9-strongback-854921c608784624ad2af042a24fded4) by Thor's Hammer
- [Starlink Spacex Satellite](https://sketchfab.com/3d-models/starlink-spacex-satellite-0a60f6720c5141c9a1c6d71aac108b31) by Malacodart
- [Spaceship 003 - Control Room Concept](https://sketchfab.com/3d-models/spaceship-003-control-room-concept-a8179cb26ee248e1996c7178a184f1e1) by Mixmamo.studio. Modified: one themed half is mirrored, roof hardware is removed, and the screen artwork is replaced with original graphics

3D rendering by [Three.js](https://threejs.org/), loaded from the jsDelivr CDN.
