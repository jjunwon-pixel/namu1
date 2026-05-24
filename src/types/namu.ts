export type Lang = 'ko' | 'en' | 'vi' | 'zh' | 'ja'

export type BookingStatus =
  | 'confirmed'
  | 'completed'
  | 'cancelled_by_customer'
  | 'cancelled_by_shop'
  | 'noshow'

export type ShopStatus = 'pending' | 'active' | 'suspended'
export type NotifChannel = 'zalo' | 'whatsapp' | 'sms'
export type NotifType =
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'booking_reminder'
  | 'noshow_warning'

export interface CreateBookingRequest {
  therapist_id:   string
  service_id:     string
  scheduled_at:   string
  customer_name:  string
  customer_phone: string
  customer_email?: string
  customer_lang:  Lang
  notes?:         string
}

export interface CreateBookingResponse {
  success:         true
  booking_id:      string
  cancel_deadline: string
  ends_at:         string
}

export interface CancelBookingRequest {
  cancelled_by: 'customer' | 'shop'
  reason?:      string
}

export interface CancelBookingResponse {
  success: true
  status:  'cancelled_by_customer' | 'cancelled_by_shop'
}

export interface TimeSlot {
  time:      string
  available: boolean
  reason?:   'booked' | 'break' | 'shop_closed'
}

export interface ApiError {
  error:   string
  code?:   string
  detail?: string
}