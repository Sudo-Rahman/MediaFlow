import { describe, expect, it } from 'vitest';

import {
  getAccountAvatarAlt,
  getAccountDisplayLines,
  getAccountInitials,
} from './AccountMenu.svelte';

describe('AccountMenu display helpers', () => {
  it('shows name and email on separate lines when a display name exists', () => {
    expect(getAccountDisplayLines({
      email: 'rahman@example.com',
      name: 'Rahman Yilmaz',
      avatarUrl: 'https://example.com/avatar.png',
    })).toEqual({
      primary: 'Rahman Yilmaz',
      secondary: 'rahman@example.com',
    });
  });

  it('shows only the email when the account has no name', () => {
    expect(getAccountDisplayLines({
      email: 'keturdu71880@gmail.com',
      avatarUrl: 'https://example.com/avatar.png',
    })).toEqual({
      primary: 'keturdu71880@gmail.com',
      secondary: null,
    });
  });

  it('treats a blank name as missing', () => {
    expect(getAccountDisplayLines({
      email: 'apple@example.com',
      name: '   ',
    })).toEqual({
      primary: 'apple@example.com',
      secondary: null,
    });
  });

  it('uses the display name for initials when present', () => {
    expect(getAccountInitials({ email: 'rahman@example.com', name: 'Rahman Yilmaz' })).toBe('RY');
  });

  it('uses the email for initials when the name is missing', () => {
    expect(getAccountInitials({ email: 'keturdu71880@gmail.com' })).toBe('KE');
  });

  it('uses the name or email as avatar alt text', () => {
    expect(getAccountAvatarAlt({ email: 'rahman@example.com', name: 'Rahman Yilmaz' })).toBe('Rahman Yilmaz');
    expect(getAccountAvatarAlt({ email: 'keturdu71880@gmail.com' })).toBe('keturdu71880@gmail.com');
  });
});
