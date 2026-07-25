import { createClient } from 'npm:@supabase/supabase-js@2'
import { PUBLIC_SITE_URL } from '../_shared/email-config.ts'

function redirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': 'no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
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

  let decodedTarget: string | null = null
  try {
    const parsed = new URL(decodeURIComponent(target))
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      decodedTarget = parsed.toString()
    }
  } catch {
    decodedTarget = null
  }

  if (!decodedTarget) {
    return redirect(PUBLIC_SITE_URL)
  }

  const supabase = createClient<any>(supabaseUrl, serviceRoleKey)

  // Fail closed. Se la coppia delivery/token non corrisponde a una consegna
  // reale, questo endpoint diventerebbe un open redirect sul dominio del
  // progetto: utilizzabile per phishing e dannoso per la reputazione del
  // dominio mittente. Il redirect verso `decodedTarget` avviene solo dopo che
  // il click e' stato registrato su una delivery esistente.
  const { data: registered, error } = await supabase.rpc('newsletter_register_click', {
    p_delivery_id: deliveryId,
    p_token: token,
    p_url: decodedTarget,
  })

  if (error) {
    console.error('Failed to register newsletter click', { deliveryId, error })
    return redirect(PUBLIC_SITE_URL)
  }

  if (registered !== true) {
    console.warn('Rejected newsletter click for unknown delivery/token', { deliveryId })
    return redirect(PUBLIC_SITE_URL)
  }

  return redirect(decodedTarget)
})
