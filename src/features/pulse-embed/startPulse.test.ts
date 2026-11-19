import { describe, expect, it } from 'vitest';

import type { PulseTeamSettings } from '../../lib/api';
import {
  isIPadAgent,
  pulseSettingFor,
  pulseSettingsOnFor,
  startPulse,
  type StartPulseDecision,
  type StartPulseFacts,
} from './startPulse';

/** An iPhone in the TimeHuddle app with Pulse's plugin, the setting on, and the type offered. */
const IPHONE: StartPulseFacts = {
  isNativeApp: true,
  isMobileBrowser: false,
  pluginAvailable: true,
  info: { supported: true, contract: { major: 1, minor: 1 }, platform: 'ios' },
  isIPad: false,
  runtimePaused: false,
  settingOn: true,
  type: 'ticket.video',
  supportedTypes: ['ticket.video', 'clock.session', 'huddle.post', 'library.video'],
};

const decide = (over: Partial<StartPulseFacts>) => startPulse({ ...IPHONE, ...over });
const link = (reason: StartPulseDecision['reason']): StartPulseDecision => ({
  mode: 'link',
  reason,
});

describe('startPulse', () => {
  it('opens Pulse in the app on an iPhone when every check passes', () => {
    expect(decide({})).toEqual({ mode: 'embed', reason: 'embed' });
  });

  it.each<[string, Partial<StartPulseFacts>, StartPulseDecision]>([
    ['the app has no Pulse plugin', { pluginAvailable: false }, link('no-plugin')],
    ["the plugin's info can't be read", { info: null }, link('no-plugin')],
    [
      'the plugin speaks another contract major',
      { info: { supported: true, contract: { major: 2 as 1, minor: 0 }, platform: 'ios' } },
      link('contract'),
    ],
    [
      'Pulse is unsupported on this OS',
      {
        info: {
          supported: false,
          unsupportedReason: 'os',
          contract: { major: 1, minor: 1 },
          platform: 'ios',
        },
      },
      link('unsupported'),
    ],
    [
      'the plugin reports an iPad',
      {
        info: {
          supported: false,
          unsupportedReason: 'ipad',
          contract: { major: 1, minor: 1 },
          platform: 'ios',
        },
      },
      link('ipad'),
    ],
    ['the device is an iPad', { isIPad: true }, link('ipad')],
    [
      'Android, before its plugin ships (PR4)',
      { info: { supported: true, contract: { major: 1, minor: 1 }, platform: 'android' } },
      link('platform'),
    ],
    ['Pulse is paused for everyone', { runtimePaused: true }, link('runtime-paused')],
    ["the team's setting is off", { settingOn: false }, link('setting-off')],
    [
      "the server doesn't offer the kind",
      { type: 'clock.wrapup', supportedTypes: ['ticket.video'] },
      link('type-unsupported'),
    ],
    ['the type list has not loaded', { supportedTypes: null }, link('type-unsupported')],
  ])('keeps the link in the app when %s', (_name, over, expected) => {
    expect(decide(over)).toEqual(expected);
  });

  it("keeps a phone's browser on the link, whatever else holds", () => {
    expect(decide({ isNativeApp: false, isMobileBrowser: true })).toEqual({
      mode: 'link',
      reason: 'mobile-browser',
    });
  });

  it('gives a computer the QR code or a file upload', () => {
    expect(decide({ isNativeApp: false, isMobileBrowser: false })).toEqual({
      mode: 'qr-or-file',
      reason: 'desktop',
    });
  });
});

describe('pulseSettingFor', () => {
  const on: PulseTeamSettings = {
    pulseInApp: true,
    pulseClockInOut: false,
    pulseSharedDevice: false,
  };
  const off: PulseTeamSettings = {
    pulseInApp: false,
    pulseClockInOut: true,
    pulseSharedDevice: false,
  };
  const teams = { teamOn: on, teamOff: off };

  it("uses the place's own team", () => {
    expect(pulseSettingFor(teams, 'teamOn')).toBe(true);
    expect(pulseSettingFor(teams, 'teamOff')).toBe(false);
    expect(pulseSettingFor(teams, 'teamOff', 'pulseClockInOut')).toBe(true);
  });

  it('is off for a team the list does not name, or before the list loads', () => {
    expect(pulseSettingFor(teams, 'elsewhere')).toBe(false);
    expect(pulseSettingFor(teams, 'constructor')).toBe(false);
    expect(pulseSettingFor(null, 'teamOn')).toBe(false);
  });

  it('is on for a place with no team when any team has it on', () => {
    expect(pulseSettingFor(teams, null)).toBe(true);
    expect(pulseSettingFor({ teamOff: off }, null)).toBe(false);
    expect(pulseSettingFor({}, null)).toBe(false);
  });
});

describe('pulseSettingsOnFor', () => {
  const settings = (pulseInApp: boolean, pulseClockInOut: boolean): PulseTeamSettings => ({
    pulseInApp,
    pulseClockInOut,
    pulseSharedDevice: false,
  });
  const teams = {
    both: settings(true, true),
    appOnly: settings(true, false),
    clockOnly: settings(false, true),
  };

  it('needs only "Pulse in the app" for a type that is not a clock button', () => {
    for (const type of ['ticket.video', 'clock.session', 'huddle.post'] as const) {
      expect(pulseSettingsOnFor(teams, 'appOnly', type)).toBe(true);
      expect(pulseSettingsOnFor(teams, 'clockOnly', type)).toBe(false);
    }
    expect(pulseSettingsOnFor(teams, null, 'library.video')).toBe(true);
  });

  it('needs "Clock in and out with Pulse" as well for the clock buttons (Gate 0b)', () => {
    for (const type of ['clock.wrapup', 'clock.plan'] as const) {
      expect(pulseSettingsOnFor(teams, 'both', type)).toBe(true);
      expect(pulseSettingsOnFor(teams, 'appOnly', type)).toBe(false);
      expect(pulseSettingsOnFor(teams, 'clockOnly', type)).toBe(false);
      expect(pulseSettingsOnFor(teams, 'elsewhere', type)).toBe(false);
      expect(pulseSettingsOnFor(null, 'both', type)).toBe(false);
    }
  });

  it('feeds startPulse: a clock button with only "Pulse in the app" on keeps the link', () => {
    const facts = (teamId: string): Partial<StartPulseFacts> => ({
      type: 'clock.wrapup',
      supportedTypes: ['clock.wrapup'],
      settingOn: pulseSettingsOnFor(teams, teamId, 'clock.wrapup'),
    });
    expect(decide(facts('appOnly'))).toEqual(link('setting-off'));
    expect(decide(facts('both'))).toEqual({ mode: 'embed', reason: 'embed' });
  });
});

describe('isIPadAgent', () => {
  it("tells an iPad from an iPhone and a Mac, including iPadOS's desktop agent", () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
    expect(isIPadAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5)).toBe(true);
    expect(isIPadAgent(mac, 5)).toBe(true);
    expect(isIPadAgent(mac, 0)).toBe(false);
    expect(isIPadAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(false);
  });
});
