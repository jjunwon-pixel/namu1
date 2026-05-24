import { createClient }              from '@supabase/supabase-js'
import { Redis }                     from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'
import type { CancelBookingResponse, ApiError } from '@/types/namu'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)
const redis = Redis.fromEnv()

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<CancelBookingResponse | ApiError>> {

  const bookingId = params.id?.trim()
  if (!bookingId) return err(400, 'Booking ID is required')

  let cancelled_by: string
  let reason: string | undefined
  try {
    const body   = await req.json()
    cancelled_by = body.cancelled_by
    reason       = body.reason
  } catch { return err(400, 'Invalid JSON body') }

  if (!['customer', 'shop'].includes(cancelled_by)) {
    return err(400, 'cancelled_by must be "customer" or "shop"')
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, status, scheduled_at, cancel_deadline, customer_email, customer_lang, shop_id')
    .eq('id', bookingId)
    .single()

  if (!booking) return err(404, 'Booking not found')
  if (booking.status !== 'confirmed') {
    return err(400, 'Booking is not cancellable', 'NOT_CANCELLABLE')
  }

  const now         = new Date()
  const scheduledAt = new Date(booking.scheduled_at)

  if (cancelled_by === 'customer') {
    const deadline = new Date(booking.cancel_deadline)
    if (now > deadline) {
      return NextResponse.json<ApiError>(
        { error: 'Cancellation deadline has passed.', code: 'DEADLINE_PASSED', detail: deadline.toISOString() },
        { status: 400 }
      )
    }
  } else {
    const shopDeadline = new Date(scheduledAt.getTime() - 0.5 * 3600_000)
    if (now > shopDeadline) {
      return err(400, 'Shop can cancel up to 30 minutes before the appointment.', 'DEADLINE_PASSED')
    }
  }

  const newStatus = cancelled_by === 'customer' ? 'cancelled_by_customer' : 'cancelled_by_shop'

  const { error: updateErr } = await supabase
    .from('bookings')
    .update({ status: newStatus, cancel_reason: reason?.trim() || null, cancelled_at: now.toISOString() })
    .eq('id', bookingId)
    .eq('status', 'confirmed')

  if (updateErr) return err(500, 'Failed to cancel booking.')

  await redis.lpush('namu:notification_queue', JSON.stringify({
    booking_id:     bookingId,
    type:           'booking_cancelled',
    cancelled_by,
    customer_email: booking.customer_email,
    customer_lang:  booking.customer_lang,
  })).catch(e => console.error('[notification queue]', e))

  return NextResponse.json<CancelBookingResponse>({ success: true, status: newStatus }, { status: 200 })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, status, scheduled_at, cancel_deadline')
    .eq('id', params.id)
    .single()

  if (!booking) return err(404, 'Booking not found')

  const now           = new Date()
  const deadline      = new Date(booking.cancel_deadline)
  const isCancellable = booking.status === 'confirmed' && now < deadline
  const minutesLeft   = Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / 60_000))

  return NextResponse.json({
    booking_id:      booking.id,
    status:          booking.status,
    cancel_deadline: booking.cancel_deadline,
    is_cancellable:  isCancellable,
    minutes_left:    minutesLeft,
  })
}

function err(status: number, message: string, code?: string): NextResponse<ApiError> {
  return NextResponse.json<ApiError>({ error: message, code }, { status })
}