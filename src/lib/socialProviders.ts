/**
 * Social sign-in provider registry.
 *
 * Which buttons appear on the login form is controlled by the
 * `VITE_SOCIAL_PROVIDERS` env var (comma-separated ids, e.g.
 * `github,google,apple,authentik`). A provider is only rendered when it is
 * both listed here AND its backend credentials are configured — keeping the
 * UI in sync with what the IdP can actually service.
 *
 * `kind` selects the better-auth entry point:
 *   - `social`  → POST /api/auth/sign-in/social  (built-in providers)
 *   - `oauth2`  → POST /api/auth/sign-in/oauth2   (genericOAuth plugin, e.g. Authentik)
 */
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faApple, faGithub, faGoogle } from '@fortawesome/free-brands-svg-icons';
import { faKey } from '@fortawesome/free-solid-svg-icons';

export interface SocialProvider {
  /** Provider id (`github`/`google`/`apple`) or genericOAuth providerId (`authentik`). */
  id: string;
  /** Human-readable name shown as "Continue with {label}". */
  label: string;
  icon: IconDefinition;
  kind: 'social' | 'oauth2' | 'meteor-oauth';
  /** Path for Meteor OAuth endpoints (only for meteor-oauth kind). */
  meteorPath?: string;
}

const REGISTRY: Record<string, Omit<SocialProvider, 'id'>> = {
  github: {
    label: 'GitHub',
    icon: faGithub,
    kind: 'meteor-oauth',
    meteorPath: '/auth/github',
  },
  google: { 
    label: 'Google', 
    icon: faGoogle, 
    kind: 'meteor-oauth',
    meteorPath: '/auth/google'
  },
  apple: { 
    label: 'Apple', 
    icon: faApple, 
    kind: 'meteor-oauth',
    meteorPath: '/auth/apple'
  },
  
};

const DEFAULT_PROVIDERS = 'github';

/** Resolve the ordered list of social providers enabled for this deployment. */
export function getEnabledSocialProviders(): SocialProvider[] {
  const raw =
    (import.meta as { env?: Record<string, string> }).env?.VITE_SOCIAL_PROVIDERS ??
    DEFAULT_PROVIDERS;
  return raw
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id): id is keyof typeof REGISTRY => id in REGISTRY)
    .map((id) => ({ id, ...REGISTRY[id] }));
}
