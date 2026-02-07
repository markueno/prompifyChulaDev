import { atom } from 'nanostores';

export interface Profile {
  username: string;
  bio: string;
  avatar: string;
  /** Display name shown in header when set */
  nickname: string;
  /** Email (editable in profile page) */
  email: string;
  /** GitHub repository / account (editable) */
  githubAccount: string;
  /** Vercel account (editable) */
  vercelAccount: string;
}

// Initialize with stored profile or defaults
const storedProfile = typeof window !== 'undefined' ? localStorage.getItem('bolt_profile') : null;
const initialProfile: Profile = storedProfile
  ? { ...defaultProfile(), ...JSON.parse(storedProfile) }
  : defaultProfile();

function defaultProfile(): Profile {
  return {
    username: '',
    bio: '',
    avatar: '',
    nickname: '',
    email: '',
    githubAccount: '',
    vercelAccount: '',
  };
}

export const profileStore = atom<Profile>(initialProfile);

export const updateProfile = (updates: Partial<Profile>) => {
  profileStore.set({ ...profileStore.get(), ...updates });

  // Persist to localStorage
  if (typeof window !== 'undefined') {
    localStorage.setItem('bolt_profile', JSON.stringify(profileStore.get()));
  }
};
