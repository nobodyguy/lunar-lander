# Feature ideas

Ideas for new features, most of them aimed at force sensor play. Nothing here is built yet.

## Why force sensor play needs more

With the force sensor, the player controls one thing: how hard they pull. The autopilot (`lander/autopilot.js`) does all the steering, so a round comes down to holding the right force at the right moment. That makes it good finger training, but the player has few decisions to make. The ideas below either give the pull more jobs or make the training side easier to see.

The story helps: the lander mines magnesium carbonate, which is climbing chalk. Several ideas build on that.

## Give the pull more to do

### Chalk cargo

After each landing, the lander loads chalk, gets heavier and takes off for the next pad.

- More weight means a higher hover point, so each takeoff in a mission needs more force than the last.
- A mission becomes a set of hangs, with rest while the lander is on the ground.
- On the throttle gauge, the green hover tick moves up as cargo is loaded.

**Where it fits:** `maxThrust()` in `lander/forcecontrols.js` already scales thrust so the hover point cancels gravity. Cargo adds a mass factor there.

### Pad choice by short pulls

The player picks the target pad instead of the autopilot. Before descent, a quick pull and release cycles through the pads.

- Small pads pay more, like the existing `smallLandingSurface` bonus, so the choice is risk against reward.

**Where it fits:** `forceInput.onPress` (`forcesensor/input.js`) already detects fresh pulls, and `drawTargetMarker` already marks the chosen pad.

### Hover gates

Glowing altitude bands where the player must hold steady for a few seconds, for example "hold between 200 and 260 m for 5 s."

- Each one is an isometric hang inside the game.
- The throttle gauge shades the force window the player has to stay in.

### Force-specific bonuses

New awards in `bonuspoints.js`:

- **Feather:** touch down with the throttle within ±5% of the hover point.
- **Full send:** reach more than 95% of max force during a late braking burn. This is the force version of the hoverslam. `isHoverslam` in `helpers/scoring.js` assumes an engine with no throttle, so it doesn't fit sensor play well.
- **Rock steady:** keep the force within a narrow band during a held hover.

## Make the training side visible

### Force graph after each round

The end screen shows force over time, with the hover line drawn in. Underneath:

- peak force
- time under tension
- total impulse in kg·s, which is roughly the fuel burned
- steadiness, measured as how far the force strayed from the hover point

### Session view and fatigue

Track peak force and steadiness across the rounds in a session, and point out when they drop, for example "Peak down 15% from round 1. Consider resting." The session could also begin with an optional Measure.

### Workout modes

Game modes built around common training protocols:

- **Repeaters:** a set of seven landings, each with a fixed time limit.
- **Max hangs:** short, heavy hovers.
- **Endurance:** unlimited fuel and a long hold over terrain that keeps rising.

## Lunar rover

### Rover phase after landing

After touchdown, a rover rolls out, drives to a chalk deposit and brings the load back to the lander. The pull is the rover's throttle:

- **Climbs** need hard, sustained pulls. Ease off too soon and the rover rolls back down.
- **Flats and descents** are rest, so the terrain itself becomes an interval workout.
- **Too much pull** is punished. In low gravity, too much speed over a crest launches the rover, and landing tilted past `crashAngle` flips it. As in a hover, the player has to hold back as well as pull hard.
- **No autopilot.** The rover only moves along one axis, so the player is fully in control.

The trip back is heavier with chalk on board, which ties in with [Chalk cargo](#chalk-cargo): drive, load, take off heavier, repeat.

**Where it fits:** `terrain.getGroundHeightAtX` already gives the slope, which is all the rover physics needs.

**First version:** one deposit on flat or gently rolling ground, there and back. If it plays well, add steeper hills, the chalk load and the takeoff afterwards.

**Open question:** should the rover run on the lander's fuel? A shared tank makes fuel wasted in flight cost the player on the ground, but it's harsher on easy difficulty.

### Other rover modes

- **Delivery:** the lander carries the rover slung underneath, so it's heavier and the load swings. The player has to set it down gently near a marked spot. This is a harder kind of hover.
- **Rescue:** a stranded rover sits somewhere on the terrain. Land within reach and it drives over. Closer landings score more.
- **Time trial:** drive a seeded course, which could also serve as the daily challenge. This is the most direct "pull to move" exercise and suits short sessions.
- **Keyboard and touch:** left and right drive, and up gives a small hop. The rover works without a sensor, but it's designed for force play.

## Bigger ideas

### Two sensors, no autopilot

One sensor per hand. Each hand fires one side thruster, and the combined force drives the main engine, so the lander tilts when one hand pulls harder than the other. It's a real two-handed strength exercise and an expert mode.

**Check first:** whether grip-connect can stream from two devices at once.

### Daily challenge for force mode

Give sensor runs their own result line and tally in the daily challenge, scored separately for each difficulty.

## Suggested order

1. Chalk cargo and the force graph. Both are small changes. Cargo turns a round into a series of decisions with steadily heavier pulls, and the graph shows what the sensor measures.
2. Rover phase after landing, first version.
3. Everything else, depending on how those play.
