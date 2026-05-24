import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

const supabase = createClientComponentClient()

// 구글 로그인
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  })
  if (error) console.error('Google 로그인 오류:', error)
}

// 로그아웃
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) console.error('로그아웃 오류:', error)
}

// 현재 로그인한 유저 가져오기
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}