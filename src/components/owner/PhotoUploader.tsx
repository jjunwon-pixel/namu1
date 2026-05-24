'use client'
import { useState, useRef, useCallback } from 'react'

type UploadTargetKind =
  | 'therapist_profile'
  | 'therapist_gallery'
  | 'shop_cover'
  | 'shop_gallery'

interface PhotoUploaderProps {
  targetKind:  UploadTargetKind
  targetId:    string
  currentUrl?: string
  onSuccess?:  (url: string) => void
  label?:      string
}

interface UploadState {
  status:   'idle' | 'uploading' | 'success' | 'error'
  message:  string
  url?:     string
}

export default function PhotoUploader({
  targetKind, targetId, currentUrl, onSuccess, label = '사진 업로드',
}: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState]     = useState<UploadState>({ status: 'idle', message: '' })
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFile = useCallback(async (file: File) => {
    if (!['image/jpeg','image/jpg','image/png','image/webp'].includes(file.type)) {
      setState({ status: 'error', message: 'JPG, PNG, WEBP 파일만 가능합니다.' })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setState({ status: 'error', message: '파일 크기는 5MB 이하여야 합니다.' })
      return
    }

    const reader = new FileReader()
    reader.onload = e => setPreview(e.target?.result as string)
    reader.readAsDataURL(file)

    setState({ status: 'uploading', message: '업로드 중...' })

    const formData = new FormData()
    formData.append('file',        file)
    formData.append('target_kind', targetKind)
    formData.append('target_id',   targetId)

    try {
      const res  = await fetch('/api/upload/photo', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      setState({ status: 'success', message: '업로드 완료!', url: data.url })
      onSuccess?.(data.url)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '업로드 실패. 다시 시도해주세요.'
      setState({ status: 'error', message: msg })
      setPreview(currentUrl ?? null)
    }
  }, [targetKind, targetId, currentUrl, onSuccess])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const green     = '#1D9E75'
  const isLoading = state.status === 'uploading'

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>{label}</p>
      <div
        onClick={() => !isLoading && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        style={{
          position: 'relative', border: `2px dashed ${isDragging ? green : '#D1D5DB'}`,
          borderRadius: 12, background: isDragging ? '#E8F7F2' : '#FAFAFA',
          minHeight: 160, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          cursor: isLoading ? 'not-allowed' : 'pointer', overflow: 'hidden',
        }}
      >
        {preview && (
          <img src={preview} alt="preview" style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', opacity: isLoading ? 0.5 : 0.9,
          }} />
        )}
        {(!preview || isLoading) && (
          <div style={{ position: 'relative', textAlign: 'center', padding: 24 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>{isLoading ? '⏳' : '📷'}</div>
            <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>
              {isLoading ? '업로드 중...' : '클릭하거나 드래그하여 사진 추가'}
            </p>
            <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>JPG, PNG, WEBP · 최대 5MB</p>
          </div>
        )}
        <input
          ref={inputRef} type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
          disabled={isLoading}
        />
      </div>
      {state.message && (
        <p style={{
          marginTop: 8, fontSize: 12,
          color: state.status === 'error' ? '#EF4444' : state.status === 'success' ? green : '#6B7280',
        }}>
          {state.status === 'success' && '✓ '}
          {state.status === 'error'   && '⚠ '}
          {state.message}
        </p>
      )}
    </div>
  )
}