// Cloudflare Pages Function：GitHub OAuth 登入
//   /api/auth/login?return=/edit  → 跳去 GitHub 授權
//   /api/auth/callback             → GitHub 跳回來，換 token 後帶回網站
//
// 需要在 Cloudflare Pages 專案設定兩個環境變數：
//   GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET（建立 GitHub OAuth App 取得，詳見 SETUP.md）

type Env = {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
}

type Ctx = {
  request: Request
  params: Record<string, string | undefined>
  env: Env
}

export const onRequestGet = async ({ request, params, env }: Ctx): Promise<Response> => {
  const url = new URL(request.url)
  const action = params.action
  const clientId = env.GITHUB_CLIENT_ID
  const clientSecret = env.GITHUB_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return new Response(
      '尚未設定 GitHub 登入：請到 Cloudflare Pages → Settings → Variables and Secrets ' +
        '新增 GITHUB_CLIENT_ID 與 GITHUB_CLIENT_SECRET（教學見專案的 SETUP.md）',
      { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }

  if (action === 'login') {
    const ret = url.searchParams.get('return') || '/'
    const safe = ret.startsWith('/') && !ret.startsWith('//') ? ret.slice(0, 200) : '/'
    const redirectUri = `${url.origin}/api/auth/callback`
    const authorize =
      `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=public_repo&state=${encodeURIComponent(safe)}`
    return Response.redirect(authorize, 302)
  }

  if (action === 'callback') {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state') || '/'
    const safe = state.startsWith('/') && !state.startsWith('//') ? state.slice(0, 200) : '/'
    if (!code) return new Response('缺少授權碼，請重新登入', { status: 400 })
    try {
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: `${url.origin}/api/auth/callback`,
        }),
      })
      const data: { access_token?: string } = await r.json()
      if (!data.access_token) {
        return new Response('登入失敗，請回網站再試一次', { status: 401 })
      }
      // token 放在 URL fragment（#後面），不會被瀏覽器送給任何伺服器
      return Response.redirect(`${url.origin}${safe}#auth_token=${data.access_token}`, 302)
    } catch {
      return new Response('和 GitHub 交換權杖時失敗，請稍後再試', { status: 502 })
    }
  }

  return new Response('Not found', { status: 404 })
}
