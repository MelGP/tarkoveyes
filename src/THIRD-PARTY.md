# Third-party notices

## Map artwork

Author: Shebuka and contributors to https://github.com/the-hideout/tarkov-dev-svg-maps

CC BY-NC-SA 4.0, with upstream specific-use restrictions on cheating, radars/ESP and automation. The complete upstream README is retained at `licenses/MAPS-README.md` and the map notice at `licenses/MAPS-LICENSE.md`. Used here as a standalone noncommercial quest/map companion, not a game-process reader or enemy radar. Map file is distributed unmodified; floor layers are toggled at display time. No map authorship is claimed.

Source snapshot: https://github.com/QTtrash/tarkov-map/tree/main/public/maps (commit `3b4baefe9af7a28d78859cf74cec5a370cfe0a02`, retrieved 2026-09-06). Includes SVG maps, Icebreaker/Labyrinth raster floors and per-map POI bundles.

## Data and map metadata

Source: tarkov.dev contributors, https://github.com/the-hideout/tarkov-dev and https://json.tarkov.dev/

Normalized maps, per-map POIs and regular/PvE quest snapshots from Raid Signal, generated 2026-08-28. See `licenses/DATA-SOURCES.json` for source endpoints and `licenses/UPSTREAM-NOTICES.md` for MIT attribution. Keys and item names supplemented 2026-09-05 from `regular/tasks`, `pve/tasks`, and `regular/items_en`. Item names, flea statistics and trader sell prices are reduced snapshots from the official `json.tarkov.dev/{regular|pve|pvp-season}/items`, `items_en`, `traders` and `traders_en` endpoints, refreshed by explicit user action. Refreshing or redistributing data remains subject to upstream data/API terms.

Labs keycard item icons are bundled from `https://assets.tarkov.dev/{item-id}-icon.webp` and shown unchanged so map door markers match the in-game items.

Loot container and loose-loot positions were generated 2026-09-10 from the `regular/maps` snapshot. Container marker artwork is copied unchanged from the tarkov.dev interactive-map assets. The 314 item icons used for loose-loot markers are bundled from `https://assets.tarkov.dev/{item-id}-icon.webp`. TarkovEyes normalizes these records into local per-map files and does not query loot data while the app is running.

## Raid Signal parser references

https://github.com/QTtrash/tarkov-map — Apache License 2.0, included at `licenses/Raid-Signal-LICENSE`. Screenshot grammar, quaternion direction and map/lifecycle log formats in `core.cjs` were adapted from its Rust parser references. Our JavaScript file observer, state storage and UI are new implementations. Preserve this notice in derivatives.

## TarkovMonitor format reference

https://github.com/the-hideout/TarkovMonitor — GPL-3.0. Its public documentation and log models were used to confirm the meaning of Tarkov `ChatMessageReceived` quest lifecycle message types. TarkovEyes contains an independent, minimal JavaScript parser that retains only quest ID, lifecycle status, event ID and timestamp; no TarkovMonitor source code is distributed.

## Electron

Electron and Chromium notices are included in the executable distribution as `LICENSE` and `LICENSES.chromium.html`; npm dependency versions are locked in `source/package-lock.json`.

## Offline OCR

Tesseract.js and tesseract.js-core, Apache License 2.0, https://github.com/naptha/tesseract.js and https://github.com/naptha/tesseract.js-core. English trained data is bundled from `@tesseract.js-data/eng`, derived from the Tesseract tessdata project. OCR runs locally only after the user chooses an image.

Escape from Tarkov is owned by Battlestate Games. This project is unofficial and unaffiliated. No official approval is claimed.


## Battle Pass spawn markers

Reference maps, spawn locations and photographs: © 2026 Perofunyang.
Source: https://github.com/perofunyang/battlepass_interactive_map/tree/5aa75a875892d601276efeec29106960eca9594f
Licensed under Creative Commons Attribution-NonCommercial 4.0 International: https://creativecommons.org/licenses/by-nc/4.0/ (full text: licenses/BATTLEPASS-MAP.txt).
Adaptations: source image coordinates converted and manually aligned approximately to the existing tactical artwork, with separate registration of detached floor diagrams; unrelated transit/temporary entries excluded; floor and category filters, marker grouping, local photos and approximate-position notices added. These are not verified world-coordinate positions.
Item names and document icons: tarkov.dev (https://tarkov.dev); Escape from Tarkov game artwork remains property of Battlestate Games.
Reference map positions are from Perofunyang, not from tarkov.dev world-coordinate loot data.

