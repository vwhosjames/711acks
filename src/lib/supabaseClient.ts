import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_FILE_SIZE_BYTES,
  validateImageFileMetadata,
} from './supabaseStorage';

const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
const rawSupabaseUrl = viteEnv?.VITE_SUPABASE_URL;
const rawSupabaseAnonKey = viteEnv?.VITE_SUPABASE_ANON_KEY;

const supabaseUrl = rawSupabaseUrl?.trim();
const supabaseAnonKey = rawSupabaseAnonKey?.trim();

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('https://') &&
    !supabaseUrl.includes('your-project-ref') &&
    supabaseAnonKey !== 'your-supabase-anon-public-key'
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        // Memory-only auth session: prevents remember-me bypass and avoids
        // storing admin JWTs/refresh tokens in browser localStorage.
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * Generates or retrieves a persistent anonymous browser identifier for the Like system
 * (Section 10: Prevent casual repeated likes from the same browser/device without registration).
 * Note: Browser IDs can be cleared or changed and do not guarantee one vote per real person.
 */
export function getAnonymousBrowserId(): string {
  const STORAGE_KEY = '711acks_anon_browser_id';
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length >= 16) {
      return existing;
    }
    const randomBytes = new Uint8Array(16);
    window.crypto.getRandomValues(randomBytes);
    const generated =
      'anon_' +
      Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    localStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch {
    return 'anon_fallback_' + Math.random().toString(36).slice(2, 18);
  }
}

export interface ValidatedOptimizedImage {
  valid: boolean;
  error?: string;
  dataUrl?: string;
  blob?: Blob;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
}

/**
 * Validates and optimizes an image file (MIME type, size limit <= 5MB,
 * dimensions 120px–6000px, and canvas compression returning both preview dataUrl and Blob)
 * per Section 12 & Section 23 requirements.
 */
export async function validateAndOptimizeImageFile(
  file: File
): Promise<ValidatedOptimizedImage> {
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return {
      valid: false,
      error: 'Unsupported format. Please upload a JPG, PNG, or WebP image.',
    };
  }

  if (file.size <= 0 || file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error:
        file.size <= 0
          ? 'Selected image file is empty.'
          : `File size (${(file.size / (1024 * 1024)).toFixed(
              1
            )}MB) exceeds the 5MB maximum limit.`,
    };
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () =>
      resolve({ valid: false, error: 'Failed to read the selected image file.' });
    reader.onload = () => {
      const img = new Image();
      img.onerror = () =>
        resolve({ valid: false, error: 'The selected file is not a valid image.' });
      img.onload = () => {
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;

        const dimCheck = validateImageFileMetadata({
          mimeType: file.type,
          sizeBytes: file.size,
          width: naturalWidth,
          height: naturalHeight,
        });
        if (!dimCheck.valid) {
          resolve({ valid: false, error: dimCheck.error });
          return;
        }

        try {
          const maxDim = 1200;
          let width = naturalWidth;
          let height = naturalHeight;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({
              valid: true,
              dataUrl: reader.result as string,
              blob: file,
              mimeType: file.type,
              sizeBytes: file.size,
              width,
              height,
            });
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.86);
          canvas.toBlob(
            (blob) => {
              const finalBlob = blob || file;
              const finalMime = blob ? 'image/jpeg' : file.type;
              resolve({
                valid: true,
                dataUrl: optimizedDataUrl,
                blob: finalBlob,
                mimeType: finalMime,
                sizeBytes: finalBlob.size,
                width,
                height,
              });
            },
            'image/jpeg',
            0.86
          );
        } catch {
          resolve({
            valid: true,
            dataUrl: reader.result as string,
            blob: file,
            mimeType: file.type,
            sizeBytes: file.size,
            width: naturalWidth,
            height: naturalHeight,
          });
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
