import { createClient } from '@supabase/supabase-js'

export const BUCKET         = 'namu-photos'
export const MAX_SIZE_MB    = 5
export const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024
export const ALLOWED_TYPES  = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

export type UploadTarget =
  | { kind: 'therapist_profile'; id: string }
  | { kind: 'therapist_gallery'; id: string }
  | { kind: 'shop_cover';        id: string }
  | { kind: 'shop_gallery';      id: string }

export interface UploadResult {
  publicUrl: string
  path:      string
}

export async function uploadPhotoServer(
  fileBuffer: Buffer,
  mimeType:   string,
  target:     UploadTarget
): Promise<UploadResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  validateMimeType(mimeType)

  const ext  = mimeTypeToExt(mimeType)
  const path = buildPath(target, ext)

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, fileBuffer, { contentType: mimeType, upsert: true })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { publicUrl: data.publicUrl, path }
}

export async function deletePhoto(path: string): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw new Error(`Delete failed: ${error.message}`)
}

export async function listPhotos(prefix: string): Promise<string[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const { data, error } = await supabase.storage.from(BUCKET).list(prefix)
  if (error || !data) return []

  return data
    .filter(f => f.name !== '.emptyFolderPlaceholder')
    .map(f => {
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(`${prefix}/${f.name}`)
      return urlData.publicUrl
    })
}

function buildPath(target: UploadTarget, ext: string): string {
  const ts = Date.now()
  switch (target.kind) {
    case 'therapist_profile': return `therapists/${target.id}/profile.${ext}`
    case 'therapist_gallery': return `therapists/${target.id}/gallery/${ts}.${ext}`
    case 'shop_cover':        return `shops/${target.id}/cover.${ext}`
    case 'shop_gallery':      return `shops/${target.id}/gallery/${ts}.${ext}`
  }
}

function mimeTypeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg',
    'image/png': 'png',  'image/webp': 'webp',
  }
  return map[mime] ?? 'jpg'
}

function validateMimeType(mime: string) {
  if (!ALLOWED_TYPES.includes(mime)) {
    throw new Error(`Unsupported file type: ${mime}`)
  }
}