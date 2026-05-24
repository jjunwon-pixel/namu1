import type { CreateBookingRequest } from '@/types/namu'

const VALID_LANGS  = ['ko', 'en', 'vi', 'zh', 'ja'] as const
const PHONE_REGEX  = /^\+[1-9]\d{7,14}$/
const MIN_ADVANCE  = 30 * 60 * 1000
const MAX_ADVANCE  = 30 * 24 * 60 * 60 * 1000

export function validateCreateBooking(body: unknown): {
  data?: CreateBookingRequest
  error?: string
} {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid request body' }
  }

  const b = body as Record<string, unknown>

  const required = ['therapist_id','service_id','scheduled_at','customer_name','customer_phone']
  for (const field of required) {
    if (!b[field] || typeof b[field] !== 'string' || !(b[field] as string).trim()) {
      return { error: `Missing or invalid field: ${field}` }
    }
  }

  const phone = (b.customer_phone as string).trim()
  if (!PHONE_REGEX.test(phone)) {
    return { error: 'customer_phone must be E.164 format (e.g. +84901234567)' }
  }

  const scheduledAt = new Date(b.scheduled_at as string)
  if (isNaN(scheduledAt.getTime())) {
    return { error: 'scheduled_at is not a valid ISO 8601 datetime' }
  }

  const now  = Date.now()
  const diff = scheduledAt.getTime() - now
  if (diff < MIN_ADVANCE) {
    return { error: 'Booking must be at least 30 minutes in advance' }
  }
  if (diff > MAX_ADVANCE) {
    return { error: 'Booking cannot be more than 30 days in advance' }
  }

  const lang = (b.customer_lang as string) || 'en'
  if (!VALID_LANGS.includes(lang as typeof VALID_LANGS[number])) {
    return { error: `customer_lang must be one of: ${VALID_LANGS.join(', ')}` }
  }

  return {
    data: {
      therapist_id:   (b.therapist_id  as string).trim(),
      service_id:     (b.service_id    as string).trim(),
      scheduled_at:   scheduledAt.toISOString(),
      customer_name:  (b.customer_name as string).trim(),
      customer_phone: phone,
      customer_lang:  lang as CreateBookingRequest['customer_lang'],
      notes:          typeof b.notes === 'string' ? b.notes.trim() : undefined,
    }
  }
}