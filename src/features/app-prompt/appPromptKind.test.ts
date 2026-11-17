import { describe, expect, it } from 'vitest';

import { appPromptKind, type AppPromptContext } from './appPromptKind';

const browser = (overrides: Partial<AppPromptContext>): AppPromptContext => ({
  isNativeApp: false,
  automated: false,
  mobileOS: null,
  hasIosApp: false,
  hasAndroidApp: false,
  ...overrides,
});

describe('appPromptKind', () => {
  it('asks an iPhone or iPad browser without the app to install it', () => {
    expect(appPromptKind(browser({ mobileOS: 'ios' }))).toBe('install-phone');
  });

  it('offers to open the app to an iPhone or iPad browser that has it', () => {
    expect(appPromptKind(browser({ mobileOS: 'ios', hasIosApp: true }))).toBe('open-in-app');
  });

  it('asks an Android browser without the app to install it', () => {
    expect(appPromptKind(browser({ mobileOS: 'android' }))).toBe('install-phone');
  });

  it('offers to open the app to an Android browser that has it', () => {
    expect(appPromptKind(browser({ mobileOS: 'android', hasAndroidApp: true }))).toBe(
      'open-in-app',
    );
  });

  it('judges each phone by its own platform’s app', () => {
    expect(appPromptKind(browser({ mobileOS: 'android', hasIosApp: true }))).toBe('install-phone');
    expect(appPromptKind(browser({ mobileOS: 'ios', hasAndroidApp: true }))).toBe('install-phone');
  });

  it('shows a desktop browser without either app the QR codes', () => {
    expect(appPromptKind(browser({}))).toBe('install-desktop');
  });

  it('leaves a desktop browser alone once the person has either app', () => {
    expect(appPromptKind(browser({ hasIosApp: true }))).toBeNull();
    expect(appPromptKind(browser({ hasAndroidApp: true }))).toBeNull();
  });

  it('never shows inside the native app', () => {
    expect(appPromptKind(browser({ isNativeApp: true, mobileOS: 'ios' }))).toBeNull();
    expect(appPromptKind(browser({ isNativeApp: true, mobileOS: 'android' }))).toBeNull();
  });

  it('never shows to an automated browser', () => {
    expect(appPromptKind(browser({ automated: true }))).toBeNull();
    expect(appPromptKind(browser({ automated: true, mobileOS: 'ios' }))).toBeNull();
    expect(appPromptKind(browser({ automated: true, mobileOS: 'android' }))).toBeNull();
  });
});
