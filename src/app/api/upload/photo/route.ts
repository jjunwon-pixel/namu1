import { createClient }              from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { uploadPhotoServer, MAX_SIZE_BYTES, ALLOWED_TYPES } from '@/lib/storage/upload'
import type { UploadTarget } from '@/lib/storage/upload'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return err(400, 'Invalid multipart form data')
  }

  const file       = formData.get('file')        as File | null
  const targetKind = formData.get('target_kind') as string | null
  const targetId   = formData.get('target_id')   as string | null

  if (!file || !targetKind || !targetId) {
    return err(400, 'Missing required fields: file, target_kind, target_id')
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return err(400, `Unsupported type: ${file.type}. Allowed: jpeg, png, webp`)
  }

  if (file.size > MAX_SIZE_BYTES) {
    return err(413, `File too large. Max 5MB.`)
  }

  const validKinds = ['therapist_profile', 'therapist_gallery', 'shop_cover', 'shop_gallery']
  if (!validKinds.includes(targetKind)) {
    return err(400, `Invalid target_kind.`)
  }

  const target: UploadTarget = { kind: targetKind as UploadTarget['kind'], id: targetId }

  if (targetKind.startsWith('therapist')) {
    const { data } = await supabase.from('therapists').select('id').eq('id', targetId).single()
    if (!data) return err(404, 'Therapist not found')
  } else {
    const { data } = await supabase.from('shops').select('id').eq('id', targetId).single()
    if (!data) return err(404, 'Shop not found')
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  let result: { publicUrl: string; path: string }
  try {
    result = await uploadPhotoServer(buffer, file.type, target)
  } catch (e) {
    console.error('[upload/photo]', e)
    return err(500, 'Upload failed. Please try again.')
  }

  if (targetKind === 'therapist_profile') {
    await supabase.from('therapists').update({ photo_url: result.publicUrl }).eq('id', targetId)
  } else if (targetKind === 'shop_cover') {
    await supabase.from('shops').update({ cover_photo_url: result.publicUrl }).eq('id', targetId)
  }

  return NextResponse.json({ success: true, url: result.publicUrl, path: result.path }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const { path, target_id, target_kind } = await req.json()
  if (!path) return err(400, 'path is required')

  const { deletePhoto } = await import('@/lib/storage/upload')
  try {
    await deletePhoto(path)
  } catch {
    return err(500, 'Delete failed')
  }

  if (target_id && target_kind === 'shop_cover') {
    await supabase.from('shops').update({ cover_photo_url: null }).eq('id', target_id)
  }

  return NextResponse.json({ success: true })
}

function err(status: number, message: string) {
  return NextResponse.json({ error: message }, { status })
}