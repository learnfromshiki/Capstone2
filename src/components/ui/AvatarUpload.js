'use client';

import { useRef, useState } from 'react';
import Avatar from './Avatar';
import { uploadProfileImage } from '@/lib/imageUpload';
import { supabase } from '@/lib/supabaseClient';
import { useDialog } from './Dialog';

/**
 * Profile picture with a "Change photo" button. The new picture is uploaded to
 * the profile-images bucket and the address is saved on the person's profile,
 * so it shows everywhere they appear.
 */
export default function AvatarUpload({ userId, url, name, email, onChange, size = 'lg' }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const { showAlert, showToast } = useDialog();

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !userId) return;

    setUploading(true);
    try {
      const { url: uploadedUrl, error } = await uploadProfileImage(file);
      if (error) throw error;

      const { error: saveError } = await supabase
        .from('profiles')
        .update({ avatar_url: uploadedUrl, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (saveError) throw saveError;

      if (onChange) onChange(uploadedUrl);
      showToast('Profile picture updated.', 'success');
    } catch (error) {
      showAlert(error.message || 'Could not update your profile picture.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar src={url} name={name} email={email} size={size} />

      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="min-h-[44px] rounded-lg border-2 border-blue-200 px-4 font-semibold text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : url ? 'Change photo' : 'Upload photo'}
        </button>
        <p className="mt-1 text-xs text-gray-500">JPG, PNG, GIF or WebP, up to 2MB.</p>
      </div>
    </div>
  );
}
