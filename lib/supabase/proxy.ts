import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { hasAdminPermission, normalizeAdminRole, resolvePermissionForAdminApi } from '@/lib/admin-rbac'
import { enforceRequestRateLimit, extractClientIp } from '@/lib/request-rate-limit'

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)

  let supabaseResponse = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  const rebuildResponse = () => {
    const nextResponse = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })
    for (const cookie of supabaseResponse.cookies.getAll()) {
      const { name, value, ...options } = cookie
      nextResponse.cookies.set(name, value, options)
    }
    supabaseResponse = nextResponse
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({
            request: {
              headers: requestHeaders,
            },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getUser() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  if (pathname.startsWith('/api/admin')) {
    const requiredPermission = resolvePermissionForAdminApi(pathname)
    if (!requiredPermission) {
      return NextResponse.json(
        { ok: false, error: 'Admin API route permission is not configured.' },
        { status: 403 },
      )
    }

    if (!user?.email) {
      return NextResponse.json({ ok: false, error: 'Unauthorized admin request.' }, { status: 401 })
    }

    let adminActor: { id: string; role: string; is_active: boolean } | null = null
    const byEmail = await supabase
      .from('admin_users')
      .select('id, role, is_active')
      .eq('email', user.email)
      .maybeSingle()

    if (byEmail.data) {
      adminActor = {
        id: String(byEmail.data.id),
        role: normalizeAdminRole(byEmail.data.role),
        is_active: Boolean(byEmail.data.is_active),
      }
    } else {
      const byId = await supabase
        .from('admin_users')
        .select('id, role, is_active')
        .eq('id', user.id)
        .maybeSingle()
      if (byId.data) {
        adminActor = {
          id: String(byId.data.id),
          role: normalizeAdminRole(byId.data.role),
          is_active: Boolean(byId.data.is_active),
        }
      }
    }

    if (!adminActor || !adminActor.is_active) {
      return NextResponse.json(
        { ok: false, error: 'Admin account is inactive or not registered.' },
        { status: 403 },
      )
    }

    if (!hasAdminPermission(adminActor.role, requiredPermission)) {
      return NextResponse.json({ ok: false, error: 'Insufficient role permission.' }, { status: 403 })
    }

    requestHeaders.set('x-admin-id', adminActor.id)
    requestHeaders.set('x-admin-role', adminActor.role)
    rebuildResponse()
  }

  if (
    pathname.startsWith('/api/admin') ||
    pathname.startsWith('/api/miniapp') ||
    pathname.startsWith('/api/pay') ||
    pathname.startsWith('/api/charity')
  ) {
    const scope = pathname.startsWith('/api/admin') ? 'admin' : 'mini'
    const rateIdentifier =
      scope === 'admin'
        ? requestHeaders.get('x-admin-id') || user?.id || extractClientIp(request.headers)
        : extractClientIp(request.headers)

    const rate = enforceRequestRateLimit({
      scope,
      method: request.method,
      identifier: rateIdentifier,
      bucket: pathname,
    })

    if (!rate.ok) {
      const limited = NextResponse.json(
        { ok: false, error: 'Too many requests. Please retry shortly.' },
        { status: 429 },
      )
      limited.headers.set('Retry-After', String(rate.retryAfterSeconds))
      limited.headers.set('X-RateLimit-Limit', String(rate.limit))
      limited.headers.set('X-RateLimit-Remaining', String(rate.remaining))
      limited.headers.set('X-RateLimit-Reset', String(Math.floor(rate.resetAt / 1000)))
      return limited
    }

    supabaseResponse.headers.set('X-RateLimit-Limit', String(rate.limit))
    supabaseResponse.headers.set('X-RateLimit-Remaining', String(rate.remaining))
    supabaseResponse.headers.set('X-RateLimit-Reset', String(Math.floor(rate.resetAt / 1000)))
  }

  if (
    // if the user is not logged in and the app path, in this case, /protected, is accessed, redirect to the login page
    request.nextUrl.pathname.startsWith('/protected') &&
    !user
  ) {
    // no user, potentially respond by redirecting the user to the login page
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse
}
