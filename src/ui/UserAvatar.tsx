import { Avatar } from '@mieweb/ui';
import React from 'react';

interface UserAvatarProps {
  name: string;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export const UserAvatar: React.FC<UserAvatarProps> = ({ name, src, size }) => (
  <Avatar name={name} src={src ?? undefined} size={size} />
);
