# Salt & Scrap

A 3D top-down boat battle game in the browser, built with Three.js, TypeScript and Vite. You start in a leaky dinghy with an old machine gun on the bow and fight waves of raiders on a smoky, war-torn sea.

This is **phase 1: core combat**. It covers sailing, the four starter weapons, enemy boats, and the water, damage and explosion effects. Build mode, the gun workshop, fishing, crew and crew repairs come in phase 2. The systems below were designed so those can plug in.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm test         # unit tests (vitest)
```

## Controls

| Input | Action |
| --- | --- |
| **W / S** | Throttle ahead / astern |
| **A / D** | Rudder |
| **Mouse** | Aim (the diamond marks where to lead a moving target) |
| **Left click** | Fire |
| **1 – 4** | Old MG · MG Mk II · Deck Cannon · Harpoon |
| **Right click** | Cut the harpoon line |
| **R** | Patch the boat between waves (costs wood/metal) |
| **Enter** | Start the next wave early |
| **Wheel** | Zoom |
| **Esc / M** | Pause / mute |

## What's in phase 1

- **Boats made of parts.** Every boat is a set of parts on a 1 m grid: hull, armour, engine, gun mount and wheelhouse. Each part has its own HP, material (wood or metal), mass and buoyancy. Hits damage the specific part they strike. Destroyed parts break off as debris, and anything no longer attached to the hull falls off with them. Engines and wheelhouses catch fire.
- **Physics.** The boat is a rigid body. Buoyancy is sampled per hull cell from the same Gerstner waves the GPU draws, so boats ride the swell. A damaged hull rides lower. A boat below 40% hull integrity is wrecked: it burns, lists and sinks.
- **Weapons.** Stats are data-driven (`src/weapons/weaponDefs.ts`).
  - **Old MG:** inaccurate, overheats and jams.
  - **MG Mk II:** accurate, fast, with tracers.
  - **Deck Cannon:** ballistic shells with splash damage and big water columns.
  - **Harpoon:** a rope tether that winches the target in.
- **Turrets.** Each turret has a traverse speed and a firing arc, and solves its own ballistic elevation.
- **Enemies.** Four types: Raider Skiff, Harpoon Runner, Gunboat and Armoured Barge. Their AI closes to its preferred gun range, circles, fires in bursts with leading (imperfect) aim, avoids rocks and allies, and breaks off when badly hurt. Waves escalate indefinitely.
- **Salvage.** Wrecks drop floating wood and metal crates. Between waves, **R** spends them to patch damaged parts and rebuild destroyed ones. This is a stand-in until crew-driven repairs arrive in phase 2.
- **Effects:**
  - **Ocean:** Gerstner waves, fresnel sky reflection, subsurface tint, sun glitter and crest foam.
  - **Foam map:** a world-space map projects wakes, hull foam, splash rings and oil slicks onto the moving wave surface.
  - **Particles:** GPU-billboarded muzzle flashes, sparks, wood splinters, spray columns, fireballs and smoke plumes.
  - **Lighting and post:** dynamic light flashes, camera shake, bloom, and a war-torn colour grade with vignette, film grain and a red pulse when you're hit.
- **Audio.** All sound is synthesised with WebAudio; there are no asset files.

## Code map

```
src/
  core/      Game loop (fixed 60 Hz sim), input
  boat/      Part catalogue, designs, stats/damage (pure), physics, meshes, Boat entity
  weapons/   Weapon defs, firing state (pure), ballistics (pure), turrets, projectiles, harpoon
  world/     Waves (shared CPU/GPU), ocean shader, sky, islands/wrecks/scenery
  fx/        Particles, foam map, wakes, light flashes, effect recipes
  ai/        Enemy captain
  game/      Waves of enemies, loot, debris, shared World interface
  render/    Camera rig, post-processing, procedural textures
  ui/        DOM HUD
tests/       Unit tests for waves, ballistics, weapon state, boat stats/physics, hit tests
```

## Phase 2 hooks

- **Build mode.** Boats are already `BoatDesign` lists of `{ part, x, y, z, weapon }`. A Trailmakers-style orbit builder only needs to edit that list. `findDetached` already enforces structural connectivity.
- **Gun workshop.** A custom gun is a new `WeaponDef` built from a base type plus stat parts.
- **Crew repairs.** Parts carry `material` and a wood/metal `cost`, and the HUD schematic already shows per-part damage. Crew can be sent to specific parts instead of the current between-wave patch.
- **Bedrooms and crew.** Add a `bedroom` part kind. Crew count can then gate how many guns you can man and how fast repairs go.
