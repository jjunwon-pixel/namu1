export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div style={{ maxWidth: 430, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>예약 #{id}</h1>
    </div>
  )
}
