import { createClient } from 'npm:@supabase/supabase-js@2'
import { PUBLIC_SITE_URL } from '../_shared/email-config.ts'

function redirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return redirect(PUBLIC_SITE_URL)
  }

  const url = new URL(req.url)
  const deliveryId = url.searchParams.get('delivery')
  const token = url.searchParams.get('token')
  const target = url.searchParams.get('url')

  if (!deliveryId || !token || !target) {
    return redirect(PUBLIC_SITE_URL)
  }

  let decodedTarget = PUBLIC_SITE_URL
  try {
    const nextUrl = decodeURIComponent(target)
    const parsed = new URL(nextUrl)
    decodedTarget =
      parsed.protocol === 'http:' || parsed.protocol === 'https:'
        ? parsed.toString()
        : PUBLIC_SITE_URL
  } catch {
    decodedTarget = PUBLIC_SITE_URL
  }

  const supabase = createClient<any>(supabaseUrl, serviceRoleKey)
  const { data: delivery } = await supabase
    .from('newsletter_deliveries')
    .select('id, click_count, tracker_token')
    .eq('id', deliveryId)
    .eq('tracker_token', token)
    .maybeSingle()

  if (!delivery) {
    return redirect(decodedTarget)
  }

  const now = new Date().toISOString()
  const payload: Record<string, string | number> = {
    status: 'clicked',
    click_count: (delivery.click_count ?? 0) + 1,
    last_clicked_at: now,
    last_clicked_url: decodedTarget,
  }

  if (!delivery.click_count) {
    payload.first_clicked_at = now
  }

  await supabase
    .from('newsletter_deliveries')
    .update(payload)
    .eq('id', delivery.id)

  return redirect(decodedTarget)
})
