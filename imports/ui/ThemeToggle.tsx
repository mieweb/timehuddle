import { faMoon, faSun } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Tooltip } from '@mieweb/ui';
import React from 'react';

import { useTheme } from '../lib/useTheme';

export const ThemeToggle: React.FC = () => {
  const { theme, toggle } = useTheme();

  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <Tooltip content={label} placement="bottom" delay={140}>
      <Button
        variant="outline"
        size="icon"
        aria-label={label}
        onClick={toggle}
      >
        <FontAwesomeIcon icon={theme === 'dark' ? faSun : faMoon} className="text-sm" />
      </Button>
    </Tooltip>
  );
};
