import { createClient } from '@supabase/supabase-js'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)
const redis = Redis.fromEnv()

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const bookingId = id?.trim()
  if (!bookingId) {
    return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 })
  }

  let cancelled_by: string
  let reason: string | undefined
  try {
    const body = await req.json()
    cancelled_by = body.cancelled_by
    reason = body.reason
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!['customer', 'shop'].includes(cancelled_by)) {
    return NextResponse.json({ error: 'cancelled_by must be customer or shop' }, { status: 400 })
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, status, scheduled_at, cancel_deadline, customer_email, customer_lang')
    .eq('id', bookingId)
    .single()

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (booking.status !== 'confirmed') {
    return NextResponse.json({ error: 'Booking is not cancellable' }, { status: 400 })
  }

  const now = new Date()
  const scheduledAt = new Date(booking.scheduled_at)

  if (cancelled_by === 'customer') {
    const deadline = new Date(booking.cancel_deadline)
    if (now > deadline) {
      return NextResponse.json({ error: 'Cancellation deadline has passed.', code: 'DEADLINE_PASSED' }, { status: 400 })
    }
  } else {
    const shopDeadline = new Date(scheduledAt.getTime() - 0.5 * 3600000)
    if (now > shopDeadline) {
      return NextResponse.json({ error: 'Shop can cancel up to 30 minutes before.' }, { status: 400 })
    }
  }

  const newStatus = cancelled_by === 'customer' ? 'cancelled_by_customer' : 'cancelled_by_shop'

  const { error: updateErr } = await supabase
    .from('bookings')
    .update({ status: newStatus, cancel_reason: reason || null, cancelled_at: now.toISOString() })
    .eq('id', bookingId)
    .eq('status', 'confirmed')

  if (updateErr) {
    return NextResponse.json({ error: 'Failed to cancel booking.' }, { status: 500 })
  }

  await redis.lpush('namu:notification_queue', JSON.stringify({
    booking_id: bookingId,
    type: 'booking_cancelled',
    cancelled_by,
    customer_email: booking.customer_email,
    customer_lang: booking.customer_lang,
  })).catch(e => console.error('[notification queue]', e))

  return NextResponse.json({ success: true, status: newStatus }, { status: 200 })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, status, scheduled_at, cancel_deadline')
    .eq('id', id)
    .single()

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const now = new Date()
  const deadline = new Date(booking.cancel_deadline)
  const isCancellable = booking.status === 'confirmed' && now < deadline
  const minutesLeft = Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / 60000))

  return NextResponse.json({
    booking_id: booking.id,
    status: booking.status,
    cancel_deadline: booking.cancel_deadline,
    is_cancellable: isCancellable,
    minutes_left: minutesLeft,
  })
}
