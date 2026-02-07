import { useState, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { profileStore, updateProfile } from '~/lib/stores/profile';
import { toast } from 'react-toastify';
import { debounce } from '~/utils/debounce';

export default function ProfileTab() {
  const profile = useStore(profileStore);
  const [isUploading, setIsUploading] = useState(false);

  type ProfileField = 'username' | 'bio' | 'nickname' | 'email' | 'githubAccount' | 'vercelAccount';
  const debouncedUpdate = useCallback(
    debounce((field: ProfileField, value: string) => {
      updateProfile({ [field]: value });
      const label =
        field === 'githubAccount'
          ? 'GitHub account link'
          : field === 'vercelAccount'
            ? 'Vercel account link'
            : field === 'nickname'
              ? 'Username (shown in header)'
              : field === 'username'
                ? 'Official name'
                : field.charAt(0).toUpperCase() + field.slice(1);
      toast.success(`${label} updated`);
    }, 1000),
    []
  );

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setIsUploading(true);

      // Convert the file to base64
      const reader = new FileReader();

      reader.onloadend = () => {
        const base64String = reader.result as string;
        updateProfile({ avatar: base64String });
        setIsUploading(false);
        toast.success('Profile picture updated');
      };

      reader.onerror = () => {
        console.error('Error reading file:', reader.error);
        setIsUploading(false);
        toast.error('Failed to update profile picture');
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error uploading avatar:', error);
      setIsUploading(false);
      toast.error('Failed to update profile picture');
    }
  };

  const handleProfileUpdate = (field: ProfileField, value: string) => {
    updateProfile({ [field]: value });
    debouncedUpdate(field, value);
  };

  const inputClass = classNames(
    'w-full pl-11 pr-4 py-2.5 rounded-xl',
    'bg-white dark:bg-gray-800/50',
    'border border-gray-200 dark:border-gray-700/50',
    'text-gray-900 dark:text-white',
    'placeholder-gray-400 dark:placeholder-gray-500',
    'focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50',
    'transition-all duration-300 ease-out'
  );
  const iconClass = 'w-5 h-5 text-gray-400 dark:text-gray-500 transition-colors group-focus-within:text-purple-500';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="space-y-6">
        {/* 1. Profile picture */}
        <div>
          <div className="flex items-start gap-6 mb-6">
            <div
              className={classNames(
                'w-24 h-24 rounded-full overflow-hidden',
                'bg-gray-100 dark:bg-gray-800/50',
                'flex items-center justify-center',
                'ring-1 ring-gray-200 dark:ring-gray-700',
                'relative group',
                'transition-all duration-300 ease-out',
                'hover:ring-purple-500/30 dark:hover:ring-purple-500/30',
                'hover:shadow-lg hover:shadow-purple-500/10'
              )}
            >
              {profile.avatar ? (
                <img
                  src={profile.avatar}
                  alt="Profile"
                  className={classNames(
                    'w-full h-full object-cover',
                    'transition-all duration-300 ease-out',
                    'group-hover:scale-105 group-hover:brightness-90'
                  )}
                />
              ) : (
                <div className="i-ph:robot-fill w-16 h-16 text-gray-400 dark:text-gray-500 transition-colors group-hover:text-purple-500/70 transform -translate-y-1" />
              )}

              <label
                className={classNames(
                  'absolute inset-0',
                  'flex items-center justify-center',
                  'bg-black/0 group-hover:bg-black/40',
                  'cursor-pointer transition-all duration-300 ease-out',
                  isUploading ? 'cursor-wait' : ''
                )}
              >
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarUpload}
                  disabled={isUploading}
                />
                {isUploading ? (
                  <div className="i-ph:spinner-gap w-6 h-6 text-white animate-spin" />
                ) : (
                  <div className="i-ph:camera-plus w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-all duration-300 ease-out transform group-hover:scale-110" />
                )}
              </label>
            </div>

            <div className="flex-1 pt-1">
              <label className="block text-base font-medium text-gray-900 dark:text-gray-100 mb-1">
                Profile Picture
              </label>
              <p className="text-sm text-gray-500 dark:text-gray-400">Upload a profile picture or avatar</p>
            </div>
          </div>
        </div>

        {/* 2. Username (shown in header) - top field */}
        <div>
          <div className="relative group">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2">
              <div className={`i-ph:at ${iconClass}`} />
            </div>
            <input
              type="text"
              value={profile.nickname}
              onChange={e => handleProfileUpdate('nickname', e.target.value)}
              className={inputClass}
              placeholder="Username (shown in header)"
            />
          </div>
        </div>

        {/* 3. About - Official name and Bio */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">About</h3>
          <div className="space-y-4">
            <div className="relative group">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2">
                <div className={`i-ph:user-circle-fill ${iconClass}`} />
              </div>
              <input
                type="text"
                value={profile.username}
                onChange={e => handleProfileUpdate('username', e.target.value)}
                className={inputClass}
                placeholder="Official name"
              />
            </div>
            <div className="relative group">
              <div className="absolute left-3.5 top-3">
                <div className={`i-ph:text-aa ${iconClass}`} />
              </div>
              <textarea
                value={profile.bio}
                onChange={e => handleProfileUpdate('bio', e.target.value)}
                className={classNames(inputClass, 'resize-none h-32')}
                placeholder="Bio"
              />
            </div>
          </div>
        </div>

        {/* 4. Account */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Account</h3>
          <div className="space-y-4">
            <div className="relative group">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2">
                <div className={`i-ph:envelope-simple ${iconClass}`} />
              </div>
              <input
                type="email"
                value={profile.email}
                onChange={e => handleProfileUpdate('email', e.target.value)}
                className={inputClass}
                placeholder="Email"
              />
            </div>
            <div className="relative group">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2">
                <div className={`i-ph:github-logo ${iconClass}`} />
              </div>
              <input
                type="url"
                value={profile.githubAccount}
                onChange={e => handleProfileUpdate('githubAccount', e.target.value)}
                className={inputClass}
                placeholder="GitHub account link (e.g. https://github.com/username)"
              />
            </div>
            <div className="relative group">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2">
                <div className={`i-ph:cloud-arrow-up ${iconClass}`} />
              </div>
              <input
                type="url"
                value={profile.vercelAccount}
                onChange={e => handleProfileUpdate('vercelAccount', e.target.value)}
                className={inputClass}
                placeholder="Vercel account link (e.g. https://vercel.com/username)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
