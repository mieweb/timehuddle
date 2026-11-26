/**
 * AboutPage — which TimeHuddle this is: the app's build and the server's.
 *
 * Reached from the version number (Settings, the More sheet) and the account
 * menu. Kept off What's new so readers of the notes don't scroll past it.
 */
import React from 'react';

import { AppPage } from '../../ui/AppPage';
import { BuildDetails } from './BuildDetails';

const text = {
  subtitle: 'Which version of TimeHuddle you’re running, and its server.',
};

export const AboutPage: React.FC = () => (
  <AppPage subtitle={text.subtitle}>
    <BuildDetails />
  </AppPage>
);
