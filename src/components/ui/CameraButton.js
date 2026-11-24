'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A "Camera" button that opens the camera, not the file manager.
 *
 * - Phones and tablets: a file input with `capture`, which the phone opens
 *   straight in its camera app.
 * - Laptops and desktops ignore `capture` and would show the file picker, so
 *   there the button opens the webcam inside the page instead (getUserMedia),
 *   with a "Take photo" button. If there is no camera or access is refused,
 *   it says so and offers the file picker.
 *
 * `onFiles(files)` receives an array of image Files.
 */
const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

export default function CameraButton({ onFiles, disabled = false, className = '', children }) {
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const close = useCallback(() => {
    stopStream();
    setOpen(false);
    setError('');
  }, [stopStream]);

  // Always release the camera when the button goes away.
  useEffect(() => stopStream, [stopStream]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const handleClick = async () => {
    if (disabled) return;
    if (isTouchDevice() || !navigator.mediaDevices?.getUserMedia) {
      inputRef.current?.click();
      return;
    }

    setOpen(true);
    setError('');
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow the camera in your browser (the icon in the address bar), or choose a photo instead.'
          : 'No camera was found on this device. You can choose a photo instead.'
      );
    } finally {
      setStarting(false);
    }
  };

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
        onFiles([file]);
        close();
      },
      'image/jpeg',
      0.9
    );
  };

  const chooseInstead = () => {
    close();
    inputRef.current?.click();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label="Take a photo with the camera"
        title="Take a photo"
        className={className}
      >
        {children}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = '';
          if (files.length) onFiles(files);
        }}
        className="hidden"
      />

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Take a photo"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="font-semibold text-gray-900">Take a photo</p>
              <button
                type="button"
                onClick={close}
                aria-label="Close the camera"
                className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {error ? (
              <div className="space-y-4 p-6 text-center">
                <p className="text-sm text-gray-700">{error}</p>
                <button
                  type="button"
                  onClick={chooseInstead}
                  className="min-h-[44px] rounded-lg bg-blue-600 px-5 font-semibold text-white hover:bg-blue-700"
                >
                  Choose a photo
                </button>
              </div>
            ) : (
              <>
                <div className="relative aspect-[4/3] bg-black">
                  <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
                  {starting && (
                    <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                      Starting the camera...
                    </p>
                  )}
                </div>
                <div className="flex justify-center gap-3 p-4">
                  <button
                    type="button"
                    onClick={close}
                    className="min-h-[44px] rounded-lg border-2 border-gray-200 px-5 font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={takePhoto}
                    disabled={starting}
                    className="min-h-[44px] rounded-lg bg-blue-600 px-6 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Take photo
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
