import { describe, expect, it } from 'vitest';

import { appPromptKind, type AppPromptContext } from './appPromptKind';

const browser = (overrides: Partial<AppPromptContext>): AppPromptContext => ({
  isNativeApp: false,
  automated: false,
  mobileOS: null,
  hasIosApp: false,
  ...overrides,
});

describe('appPromptKind', () => {
  it('asks an iPhone or iPad browser without the app to install it', () => {
    expect(appPromptKind(browser({ mobileOS: 'ios' }))).toBe('install-phone');
  });

  it('offers to open the app to an iPhone or iPad browser that has it', () => {
    expect(appPromptKind(browser({ mobileOS: 'ios', hasIosApp: true }))).toBe('open-in-app');
  });

  it('shows a desktop browser without the app the QR code', () => {
    expect(appPromptKind(browser({}))).toBe('install-desktop');
  });

  it('leaves a desktop browser alone once the person has the app', () => {
    expect(appPromptKind(browser({ hasIosApp: true }))).toBeNull();
  });

  it('never shows inside the native app', () => {
    expect(appPromptKind(browser({ isNativeApp: true, mobileOS: 'ios' }))).toBeNull();
    expect(appPromptKind(browser({ isNativeApp: true, mobileOS: 'android' }))).toBeNull();
  });

  it('never shows on Android, which has no store listing yet', () => {
    expect(appPromptKind(browser({ mobileOS: 'android' }))).toBeNull();
    expect(appPromptKind(browser({ mobileOS: 'android', hasIosApp: true }))).toBeNull();
  });

  it('never shows to an automated browser', () => {
    expect(appPromptKind(browser({ automated: true }))).toBeNull();
    expect(appPromptKind(browser({ automated: true, mobileOS: 'ios' }))).toBeNull();
  });
});
