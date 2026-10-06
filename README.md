# Lunar Lander
*You are a space traveler who set out for the Moon to mine a new, low-gravity type of magnesium carbonate.*

## About

A plain JavaScript, HTML, and CSS game. Its one dependency, [grip-connect](https://github.com/Stevie-Ray/hangtime-grip-connect), talks to Bluetooth force sensors.

## Credits

This project is based on [ehmorris/lunar-lander](https://github.com/ehmorris/lunar-lander). Huge thanks to the original authors for the game this builds on.

**Code and design: Edwin Morris**

**Music and sound: Max Kotelchuck**

Thanks to all Github contributors

And thanks to [this guide](http://students.cs.ucl.ac.uk/schoolslab/projects/HT5/) for help with the basics

## Running

[Online demo](https://nobodyguy.github.io/lunar-lander/)

`npm start` serves the game at http://localhost:8000, bundling on each request. See `launch.json` to run it from VS Code.

The built game is an installable PWA: use the browser's Install (or Add to Home Screen) option to run it fullscreen and offline, with the screen kept on. The service worker (`sw.js`) is only registered by `npm run build`, so `npm start` never serves cached files; try it with `npm run preview`. A new release is downloaded in the background and takes over on the next launch.

`npm test` runs the unit tests, and `npm run sim` prints how the force sensor autopilot fares on each difficulty in a headless simulation (`npm run sim -- 200` for more runs).

## Force sensor controls

In Settings, Controls → Force sensor flies the lander with a Bluetooth force sensor or hanging scale (Tindeq Progressor by default) through the Web Bluetooth API, so it needs Chrome or Edge, or [Bluefy](https://apps.apple.com/app/id1492822055) on iPhone and iPad, where the game points players to it. Pulling fires the main engine, with thrust following the pull; an autopilot (`lander/autopilot.js`) works the steering thrusters to reach the nearest pad and level out for touchdown. A fresh pull also plays again after a round.

- **Max force**: the pull that gives full thrust. Measure sets it from your hardest pull over three seconds.
- **Hover point**: the share of max force that holds the lander still.
- **Curve**: linear, or exponential for finer control over light pulls.
- **Lower threshold**: pulls under this are ignored. Once on, the engine stays on until the pull drops below 70% of it.
- **Difficulty**: sets gravity, fuel, pad size, touchdown tolerance, autopilot strength and, on hard, random gusts and brief engine failures (`helpers/rules.js`).

The round holds still while the sensor isn't streaming, including if it drops out mid-flight.

To try it without a sensor, open the game with `?sensor-sim` and pick the Simulator device: hold the up arrow to pull.

