import { createClient } from 'npm:@supabase/supabase-js@2'

const PIXEL_BYTES = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33,
  249, 4, 1, 0, 0, 1, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
])

function pixelResponse(): Response {
  return new Response(PIXEL_BYTES, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, max-age=0',
      'Content-Length': String(PIXEL_BYTES.byteLength),
    },
  })
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return pixelResponse()
  }

  const url = new URL(req.url)
  const deliveryId = url.searchParams.get('delivery')
  const token = url.searchParams.get('token')

  if (!deliveryId || !token) {
    return pixelResponse()
  }

  const supabase = createClient<any>(supabaseUrl, serviceRoleKey)

  // Incremento atomico lato database: le aperture arrivano concorrenti (proxy
  // immagini, client multipli, prefetch) e un read-modify-write ne perdeva una
  // parte imprecisata.
  const { error } = await supabase.rpc('newsletter_register_open', {
    p_delivery_id: deliveryId,
    p_token: token,
  })

  if (error) {
    console.error('Failed to register newsletter open', { deliveryId, error })
  }

  return pixelResponse()
})
