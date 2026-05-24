'use client'
import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { signInWithGoogle } from '@/lib/auth'

function detectWebView(): { isWebView: boolean; appName: string } {
  const ua = navigator.userAgent
  if (/KAKAOTALK/i.test(ua))    return { isWebView: true, appName: '카카오톡' }
  if (/NAVER/i.test(ua))        return { isWebView: true, appName: '네이버' }
  if (/Line\//i.test(ua))       return { isWebView: true, appName: 'LINE' }
  if (/Instagram/i.test(ua))    return { isWebView: true, appName: 'Instagram' }
  if (/FBAN|FBAV/i.test(ua))    return { isWebView: true, appName: 'Facebook' }
  if (/MicroMessenger/i.test(ua)) return { isWebView: true, appName: 'WeChat' }
  // Generic Android WebView
  if (/wv\)/.test(ua) || /WebView/i.test(ua)) return { isWebView: true, appName: '앱 내 브라우저' }
  return { isWebView: false, appName: '' }
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

export default function BookingPage() {
  const [user, setUser]         = useState<User | null>(null)
  const [loading, setLoading]   = useState(true)
  const [webView, setWebView]   = useState<{ isWebView: boolean; appName: string } | null>(null)
  const [copied, setCopied]     = useState(false)
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  useEffect(() => {
    setWebView(detectWebView())
    supabase.auth.getUser().then(({ data: { user } }: { data: { user: User | null } }) => {
      setUser(user)
      setLoading(false)
    })
  }, [])

  function copyUrl() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <p>로딩 중...</p>
    </div>
  )

  // 인앱 브라우저(웹뷰) 감지 시
  if (webView?.isWebView) {
    const browser = isIOS() ? 'Safari' : 'Chrome'
    return (
      <div style={{
        maxWidth: 430, margin: '0 auto', padding: 24,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui'
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🌿</div>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: '#1D9E75', marginBottom: 8 }}>NAMU</h1>

        <div style={{
          background: '#FFF7ED', border: '1.5px solid #FED7AA',
          borderRadius: 16, padding: 20, width: '100%', marginBottom: 24,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#92400E', marginBottom: 8 }}>
            {webView.appName}에서는 구글 로그인이 불가해요
          </p>
          <p style={{ fontSize: 13, color: '#B45309', lineHeight: 1.6 }}>
            구글 로그인은 {webView.appName} 내부 브라우저에서<br/>
            지원되지 않아요. 아래 버튼으로 주소를 복사한 뒤<br/>
            <strong>{browser}</strong>에서 열어주세요.
          </p>
        </div>

        <button
          onClick={copyUrl}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: copied ? '#D1FAE5' : '#1D9E75',
            color: copied ? '#065F46' : 'white',
            border: 'none', borderRadius: 12, padding: '14px 24px',
            cursor: 'pointer', fontSize: 15, fontWeight: 600, width: '100%',
            transition: 'background 0.2s',
          }}
        >
          {copied ? '✓ 복사됨!' : `${browser}에서 열기 — 주소 복사`}
        </button>

        <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 16, textAlign: 'center' }}>
          주소를 복사한 뒤 {browser} 주소창에 붙여넣기 해주세요
        </p>
      </div>
    )
  }

  // 로그인 안 된 경우
  if (!user) return (
    <div style={{
      maxWidth: 430, margin: '0 auto', padding: 24,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui'
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🌿</div>
      <h1 style={{ fontSize: 24, fontWeight: 900, color: '#1D9E75', marginBottom: 8 }}>NAMU</h1>
      <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 32, textAlign: 'center' }}>
        베트남 마사지 예약 플랫폼<br/>Find your therapist, feel Vietnam
      </p>
      <button
        onClick={signInWithGoogle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'white', border: '1.5px solid #E5E7EB',
          borderRadius: 12, padding: '14px 24px', cursor: 'pointer',
          fontSize: 15, fontWeight: 600, color: '#374151',
          boxShadow: '0 1px 6px rgba(0,0,0,0.08)', width: '100%',
          justifyContent: 'center',
        }}
      >
        <img src="https://www.google.com/favicon.ico" width={20} height={20} alt="google" />
        구글로 로그인하여 예약하기
      </button>
      <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 16, textAlign: 'center' }}>
        로그인 후 이메일로 예약 확인을 받을 수 있어요
      </p>
    </div>
  )

  // 로그인 된 경우
  return (
    <div style={{ maxWidth: 430, margin: '0 auto', fontFamily: 'system-ui' }}>
      {/* 헤더 */}
      <div style={{
        background: '#1D9E75', padding: '16px', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <span style={{ fontSize: 18, fontWeight: 900, color: 'white' }}>🌿 NAMU</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>{user.email}</span>
      </div>

      <div style={{ padding: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>예약하기</h2>

        {/* 샵 선택 안내 */}
        <div style={{
          background: '#F3F4F6', borderRadius: 12, padding: 20,
          textAlign: 'center', color: '#6B7280'
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏪</div>
          <p style={{ fontSize: 14 }}>구글 지도에서 샵을 선택하면<br/>예약 화면이 열려요</p>
        </div>
      </div>
    </div>
  )
}