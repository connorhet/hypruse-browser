import { HOST_NAME } from '../shared/protocol';
import { chromeBrowserApi, chromeScriptRunner } from './chrome';
import { createDispatcher, type Dispatch } from './dispatch';
import { createTabEvents, watchTabs } from './events';
import { buildHello } from './hello';
import { createFrameRunner, createPageRunner } from './inject';
import { createPageHandlers } from './page';
import { NativeConnection } from './port';
import { createSiteHandlers } from './sites';
import { createTabHandlers } from './tabs';
import { createStagingHandlers, Staging } from './uploads';

const RECONNECT_ALARM = 'hypruse-browser-reconnect';

const version = chrome.runtime.getManifest().version;
const api = chromeBrowserApi();
const log = (message: string) => console.debug(`[hypruse-browser] ${message}`);
const staging = new Staging();

const dispatch = createDispatcher(
  {
    ping: () => Promise.resolve({ extension: version }),
    ...createTabHandlers(api),
    ...createSiteHandlers(api),
    ...createPageHandlers({
      api,
      run: createPageRunner(chromeScriptRunner(), version),
      runFrames: createFrameRunner(chromeScriptRunner(), version),
      staging,
    }),
    ...createStagingHandlers(staging),
  },
  { log },
);

const connection = new NativeConnection({
  connect: () => chrome.runtime.connectNative(HOST_NAME),
  hello: () => buildHello(version, navigator),
  onMessage: (message, reply) => {
    void dispatch(message).then((response) => {
      if (response) reply(response);
    });
  },
  lastError: () => chrome.runtime.lastError?.message,
  log,
});

watchTabs(
  chrome.tabs,
  createTabEvents((event) => connection.send(event)),
);

// Listeners are registered at the top level so Chrome can wake the worker for them. An open
// native port keeps the worker alive; the alarm brings the connection back if it drops.
chrome.runtime.onStartup.addListener(() => connection.ensure());
chrome.runtime.onInstalled.addListener(() => connection.ensure());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) connection.ensure();
});
void chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
connection.ensure();

declare global {
  // Runs one request by hand, for the end to end tests and the service worker console:
  // await __hypruseDispatch({ id: 'x', op: 'tabs.list' })
  var __hypruseDispatch: Dispatch | undefined;
}
globalThis.__hypruseDispatch = dispatch;
