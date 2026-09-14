/*
 * The renderer's mutable module state.
 *
 * app.js was 6,800 lines because everything that reads any of this had to live
 * beside it. Module bindings are live for readers, so a module that imports
 * `quests` sees every later change without doing anything - which is what lets
 * the rest of the renderer be split up at all.
 *
 * What a reader may NOT do is rebind an import, so every name that is assigned
 * somewhere carries a setter. That is the whole asymmetry: 13 of these are
 * read-only after load and need nothing, 38 are assigned and have a set*.
 */

export let W = 1062.4827;
export let H = 535.17401;
export let bridge = window.companion;
export let data;
export let observer = {};
export let quests = [];
export let allData;
export let specialTracks = null;
export let questWiki = {};
export let itemCatalog = null;
export let itemScanRunning = false;
export let itemHotkeyState = { enabled: true, registered: false, accelerator: 'Shift+F8' };
export let lastItemResults = [];
export let lastItemResultsScanned = false;
export let pois = [];
export let allPois = [];
export let lootData = null;
export let lootRenderTimer = null;
export let labKeycards = [];
export let keyCatalog = {};
export let traderCatalog = {};
export let questImages = {};
export let bossCatalog = {};
export let bossSpawnRates = null;
export let unknownQuestDetails = [];
export let mapDefinition;
export let mapDefinitions = [];
export let currentMapId = 'customs';
export let selected = null;
export let mapLoadToken = 0;
export let myRaidOpen = false;
export let activityUnread = 0;
export let ocrSelection = [];
export let ocrQuests = [];
export let markerAdding = false;
export let markerDraftPosition = null;
export let editingMarkerId = null;
export let lastRaidState = 'unknown';
export let mapFocus = false;
export let detailsCollapsed = true;
export let commandMatches = [];
export let commandIndex = 0;
export let view = { x: 0, y: 0, w: W, h: H };
export let floor = 'Ground_Level';
export let currentFix = null;
export let confirmedFix = null;
export let lastFixTime = 0;
export let toastTimer;

export function assignW(value) {
  W = value;
}
export function assignH(value) {
  H = value;
}
export function assignBridge(value) {
  bridge = value;
}
export function assignData(value) {
  data = value;
}
export function assignObserver(value) {
  observer = value;
}
export function assignQuests(value) {
  quests = value;
}
export function assignAllData(value) {
  allData = value;
}
export function assignItemCatalog(value) {
  itemCatalog = value;
}
export function assignItemScanRunning(value) {
  itemScanRunning = value;
}
export function assignItemHotkeyState(value) {
  itemHotkeyState = value;
}
export function assignLastItemResults(value) {
  lastItemResults = value;
}
export function assignLastItemResultsScanned(value) {
  lastItemResultsScanned = value;
}
export function assignPois(value) {
  pois = value;
}
export function assignAllPois(value) {
  allPois = value;
}
export function assignLootData(value) {
  lootData = value;
}
export function assignLootRenderTimer(value) {
  lootRenderTimer = value;
}
export function assignUnknownQuestDetails(value) {
  unknownQuestDetails = value;
}
export function assignMapDefinition(value) {
  mapDefinition = value;
}
export function assignCurrentMapId(value) {
  currentMapId = value;
}
export function assignSelected(value) {
  selected = value;
}
export function assignMyRaidOpen(value) {
  myRaidOpen = value;
}
export function assignActivityUnread(value) {
  activityUnread = value;
}
export function assignOcrSelection(value) {
  ocrSelection = value;
}
export function assignOcrQuests(value) {
  ocrQuests = value;
}
export function assignMarkerAdding(value) {
  markerAdding = value;
}
export function assignMarkerDraftPosition(value) {
  markerDraftPosition = value;
}
export function assignEditingMarkerId(value) {
  editingMarkerId = value;
}
export function assignLastRaidState(value) {
  lastRaidState = value;
}
export function assignMapFocus(value) {
  mapFocus = value;
}
export function assignDetailsCollapsed(value) {
  detailsCollapsed = value;
}
export function assignCommandMatches(value) {
  commandMatches = value;
}
export function assignCommandIndex(value) {
  commandIndex = value;
}
export function assignView(value) {
  view = value;
}
export function assignFloor(value) {
  floor = value;
}
export function assignCurrentFix(value) {
  currentFix = value;
}
export function assignConfirmedFix(value) {
  confirmedFix = value;
}
export function assignLastFixTime(value) {
  lastFixTime = value;
}
export function assignToastTimer(value) {
  toastTimer = value;
}
export function assignMapDefinitions(value) {
  mapDefinitions = value;
}
export function assignQuestImages(value) {
  questImages = value;
}
export function assignBossSpawnRates(value) {
  bossSpawnRates = value;
}
export function assignBossCatalog(value) {
  bossCatalog = value;
}
export function assignTraderCatalog(value) {
  traderCatalog = value;
}
export function assignKeyCatalog(value) {
  keyCatalog = value;
}
export function assignLabKeycards(value) {
  labKeycards = value;
}
export function assignSpecialTracks(value) {
  specialTracks = value;
}
export function assignQuestWiki(value) {
  questWiki = value;
}
export function assignMapLoadToken(value) {
  mapLoadToken = value;
}
