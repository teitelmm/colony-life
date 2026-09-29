# Salt & Scrap

A 3D top-down boat battle game in the browser, built with Three.js, TypeScript and Vite. You start in a leaky dinghy with an old machine gun on the bow and fight waves of raiders on a smoky, war-torn sea.

The game has two phases so far:
- **Phase 1** added sailing, the four starter weapons, enemy boats, and the water, damage and explosion effects.
- **Phase 2** added a Trailmakers-style 3D build mode, a gun workshop, fishing, crew and bunk cabins, and crew-driven repairs.

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
| **Left click** | Fire every manned gun |
| **R** | Send crew to repair everything that's damaged |
| **Click the damage diagram** | Order (or cancel) a repair on one block |
| **F (hold)** | Fish while stopped on a school (look for gulls and dark water) |
| **B** | Build mode, between waves only |
| **Enter** | Start the next wave now |
| **Right click** | Cut a harpoon line |
| **Wheel** | Zoom |
| **Esc / M** | Pause / mute (the pause screen has the graphics setting) |
| **`** (backtick) | Show frame rate, render resolution and quality tier |

In build mode:

| Input | Action |
| --- | --- |
| **Click** | Add the selected block against the face under the cursor |
| **Right-click** | Remove a block (half its materials come back) |
| **Right-drag, or Q / E** | Orbit the camera |
| **1 – 0** | Pick a part |
| **R** | Cycle a gun's facing |
| **Workshop** | Opens from the gun picker |

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
- **Salvage.** Wrecks drop floating wood and metal crates; sail through them to collect materials for building and repairs.
- **Effects:**
  - **Ocean:** Gerstner waves, fresnel sky reflection, subsurface tint, sun glitter and crest foam.
  - **Foam map:** a world-space map projects wakes, hull foam, splash rings and oil slicks onto the moving wave surface.
  - **Particles:** GPU-billboarded muzzle flashes, sparks, wood splinters, spray columns, fireballs and smoke plumes.
  - **Lighting and post:** dynamic light flashes, camera shake, bloom, and a war-torn colour grade with vignette, film grain and a red pulse when you're hit.
- **Audio.** All sound is synthesised with WebAudio; there are no asset files.

## Performance

The game adapts to the machine it runs on. Pick a graphics mode on the pause screen: **Auto** (the default), **Low**, **Medium** or **High**.

**Auto** watches the frame time:
- **Frames too slow** (averaging over 20 ms for 2 s): lower the internal render resolution in 10% steps, down to 60%, then drop to the next tier down.
- **Plenty of headroom** (under 13 ms for 5 s): step back up the same way.

| | Low | Medium | High |
|---|---|---|---|
| Shadows | off | 1024 | 2048 |
| Bloom | off | quarter-res | half-res |
| Anti-aliasing (MSAA) | off | 2× | 4× |
| Ocean grid | 180² | 240² | 320² |
| Particles | half | full | full |
| Pixel ratio | 1 | 1 | up to 1.5 |

Other optimisations:
- **Ocean shader:** the ripple and foam noise is baked once into a tiling texture, so the shader does four texture reads per pixel instead of about 30 procedural noise evaluations.
- **Final pass:** tone mapping, colour conversion and the grade share one full-screen pass.
- **Draw calls:** static geometry is batched per material. That covers each boat block, each gun, and each island with its ruins, and together with the gull changes it cuts the shadow and scene draw calls by about a third.
- **Physics:** water height and vertical velocity come from one wave inversion.
- **Ropes:** harpoon and fishing lines update their geometry in place.
- **HUD:** text refreshes 10 times a second, and cursor markers move by transform.

## Code map

```
src/
  core/      Game loop (fixed 60 Hz sim), input
  boat/      Part catalogue, designs, stats/damage (pure), physics, meshes, Boat entity
  weapons/   Weapon defs and registry, workshop recipes (pure), firing state, ballistics, turrets, projectiles, harpoon
  world/     Waves (shared CPU/GPU), ocean shader, sky, islands/wrecks/scenery
  fx/        Particles, foam map, wakes, light flashes, effect recipes
  ai/        Enemy captain
  game/      Waves of enemies, loot and survivors, debris, crew (pure), repairs, fishing, World
  build/     Build rules (pure: placement, removal, costs, performance) and the 3D build mode
  render/    Camera rig, post-processing, quality governor (pure), static batching, procedural textures
  ui/        DOM HUD, build palette, gun workshop
tests/       Unit tests for waves, ballistics, weapons, boat stats/physics, hit tests, build rules, crew, workshop
```

## What's in phase 2

- **Build mode.** Build between waves.
  - Orbit the boat and point at any face of any block to see a green or red ghost of the next block, then click to bolt it on.
  - Hull goes on the waterline; engines, guns, armour, cabins, bunks and net cranes go on deck, stacked up to three levels.
  - A block is refused, with the reason shown, if it would float free, overlap another block, exceed the size limit (8 m × 14 m), cut other blocks loose, or cost more than you have.
  - The live stats panel shows top speed, spare buoyancy, displacement, guns, bunks and armour.
  - Every edit rebuilds the real boat, so it floats and handles in the water as you build.
- **Gun workshop.** A custom gun is a base plus one choice for each part:
  - Base: machine gun, cannon or harpoon.
  - Barrel: short, standard or long.
  - Receiver: light, standard or heavy.
  - Ammo: ball, armour-piercing, incendiary or high-explosive.
  - Cooling (machine guns only): none, water jacket or fins.

  The workshop compares your design's stats against the stock gun. Saved designs appear in the gun picker and are kept in your browser.
- **Crew and bunks.**
  - You man the first gun yourself. Every other gun needs a gunner, or it holds fire.
  - The boat sleeps two; each bunk cabin adds two more.
  - Empty bunks attract a drifter every ~35 s if you have 4 food to spare.
  - Survivors from sunk enemy boats float in life rings. Sail through them to take them aboard if a bunk is free.
  - Everyone eats one food a minute. A starving crew works slowly and eventually deserts.
  - A gunner or repairer is killed if the block they're on is shot away.
- **Repairs.**
  - Press **R**, or click a block on the damage diagram, to send a crew member.
  - Crew put out fires, patch damage and rebuild blocks that were shot away, paying wood or metal by the block's material.
  - Repair orders take crew before guns do, so patching up mid-fight can silence your guns. That's the trade-off.
- **Fishing.** Fish schools appear as dark, restless water with gulls wheeling overhead. Stop on one and hold **F** to haul in food; now and then the net brings up wood or scrap metal too. A net crane makes hauls 50% faster, and an idle crew member doubles the rate.

