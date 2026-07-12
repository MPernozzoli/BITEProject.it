import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type BucketConfig = {
  id: string
  public: boolean
  fileSizeLimit?: number
  allowedMimeTypes?: string[]
}

const REQUIRED_BUCKETS: BucketConfig[] = [
  {
    id: 'homepage-media',
    public: true,
    fileSizeLimit: 1024 * 1024 * 250,
    allowedMimeTypes: [
      'image/avif',
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-m4v',
    ],
  },
  {
    id: 'logbook-media',
    public: true,
    fileSizeLimit: 1024 * 1024 * 250,
  },
]

const jsonResponse = (data: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const authHeader = req.headers.get('Authorization')
  const accessToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : null

  if (!accessToken) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const {
    data: { user },
    error: userError,
  } = await adminClient.auth.getUser(accessToken)

  if (userError || !user?.id) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const { data: isAdmin, error: roleError } = await adminClient.rpc('has_role', {
    _user_id: user.id,
    _role: 'admin',
  })

  if (roleError || !isAdmin) {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const { data: buckets, error: listError } = await adminClient.storage.listBuckets()
  if (listError) {
    return jsonResponse({ error: listError.message }, 500)
  }

  const existingIds = new Set((buckets ?? []).map((bucket) => bucket.id))
  const results: Array<{ id: string; status: 'created' | 'updated' | 'unchanged' }> = []

  for (const bucket of REQUIRED_BUCKETS) {
    const options = {
      public: bucket.public,
      fileSizeLimit: bucket.fileSizeLimit,
      allowedMimeTypes: bucket.allowedMimeTypes,
    }

    if (!existingIds.has(bucket.id)) {
      const { error } = await adminClient.storage.createBucket(bucket.id, options)
      if (error) return jsonResponse({ error: error.message, bucket: bucket.id }, 500)
      results.push({ id: bucket.id, status: 'created' })
      continue
    }

    const { error } = await adminClient.storage.updateBucket(bucket.id, options)
    if (error) return jsonResponse({ error: error.message, bucket: bucket.id }, 500)
    results.push({ id: bucket.id, status: 'updated' })
  }

  return jsonResponse({ buckets: results })
})
