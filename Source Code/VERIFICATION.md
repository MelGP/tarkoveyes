# Verification — Raid Notes 0.15.0

Verified on Windows, 2026-09-10.

- All 33 automated tests passed on the delivered source.
- All JavaScript entry points passed syntax checks.
- The packaged Electron 44.2.0 application launched successfully with the bundled maps, quest catalogs and production OCR dependencies.
- The dependency audit reported 0 known vulnerabilities after updating Electron. The production-only audit also reported 0.
- The packaged file count and SHA-256 verification are recorded after the final v0.15.0 build.
- All 13 maps contain a validated local loot-data file. The snapshot contains 5,633 container positions and 6,158 loose-loot positions; every referenced marker and item icon is bundled locally.
- Loot layers were visually checked on Customs with 509 containers and 416 loose-loot points. Clusters, floor filtering, cluster zoom and a loose-loot popup with item icons and values were exercised. Terminal was checked with an empty upstream dataset and shows the no-verified-data message without rendering guessed markers.
- Offline Tesseract OCR was exercised on a real Tarkov screenshot from the selected screenshots folder. The source and packaged dependency trees both completed recognition locally.
- The new Dashboard was visually checked with the real Seasonal/Kord Breach profile and displayed quest, objective and trader totals.
- My Raid was visually checked with active quests. It shows a compact quest list with persistent per-quest show/hide controls and numbered map markers, without route planning controls or a suggested route line.
- Map-layer badges were checked on Customs (PMC 11, Scav 18, Transit 4, Landmarks 9). The compact `Aa` transit sub-toggle rendered all four transit names and remained disabled while its parent layer was off.
- The sidebar was checked at 1280×720: the collapsed layers view fits without sidebar overflow, keeps a usable quest list, and the expanded view remains vertically scrollable with every control accessible.
- The v0.13.0 compact header, SVG icon system, item hotkey card, map toolbar and filters were visually checked at 1280×720.
- The Labs coordinate projection is rotated 90° so its vertical movement is no longer inverted; all Labs overlays use the same projection.
- Nine Labs keycard-door markers resolve directly from bundled locked-door POIs, use eight distinct keycard definitions and appear only on their matching floor. The keycard names have their own saved `Aa` layer toggle.
- Automatic position centering preserves the current zoom and clamps the viewport to the map bounds.
- Overlapping quest markers, log diagnostics, the per-slot loot threshold and the post-raid summary are covered by renderer integration checks.
- All three bundled item catalogs contain 5,312 translated items with validated IDs, flea statistics and trader prices. Exact and mildly noisy OCR item names are covered by matching tests. The inventory hotkey first scans an enlarged tile-sized crop, then expands around the cursor only when the first result is unclear; no Inspect screen is required.
- Inventory OCR was exercised on a real 1920×1080 Tarkov Gear screenshot. Starting from the hovered inventory area and expanding once resolved `ULTRA medical storage key` as the exact top match; the loading overlay is displayed only after capture so it cannot cover the source item.
- The Items dialog, manual search, screenshot-match cards, per-slot price calculation and explicit tarkov.dev refresh flow were checked in the renderer preview.
- Quest detail was visually checked with Favorites, objective state, chain navigation and the local note area.
- Objective target parsing and OCR review are tested with a `2 / 3` partial counter. Partial OCR results remain unconfirmed until reviewed; completion needs an explicit confirmation.
- Raid history and the manual Survived/Died/Run Through outcome survive restart in an isolated test store. The post-raid review is connected to the observer's raid-end transition.
- Personal map marker placement, editor save, edit and delete were exercised end-to-end in the renderer preview. The editor no longer relies on native prompt dialogs.
- Backup import/export, preview-before-apply catalog updates and new UI entry points are covered by validation and renderer integration checks.
- Existing tests continue to verify that screenshot position tracking reads filenames, old images are skipped, observed game files are unchanged and log modes remain isolated. The hover scanner is checked to use Electron's keyboard shortcut, cursor position and desktop crop APIs without game-process, input injection or low-level mouse-hook APIs.

The inspected live log archive contained overall quest lifecycle events but no reliable objective counters, marker-plant completion or raid survival result. Those details therefore remain user-reviewed through the Tasks screenshot and post-raid panel. Automated tests are not an anti-cheat certification or official approval.
