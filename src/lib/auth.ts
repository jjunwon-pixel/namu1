import { createBrowserClient } from '@supabase/auth-helpers-nextjs'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

export async function signInWithGoogle() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${appUrl}/auth/callback`,
    },
  })
  if (error) console.error('Google 로그인 오류:', error)
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) console.error('로그아웃 오류:', error)
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}
