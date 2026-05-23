-- ============================================================
-- NAMU DB Schema v2.0
-- Timezone: Asia/Ho_Chi_Minh (UTC+7) 고정
-- 모든 TIMESTAMPTZ는 UTC로 저장, 출력 시 +07:00 변환
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- 한/영 풀텍스트 검색
CREATE EXTENSION IF NOT EXISTS "btree_gist";    -- 시간 겹침 exclusion constraint

-- ============================================================
-- 1. SHOPS
-- ============================================================
CREATE TABLE shops (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 기본 정보
  name             TEXT        NOT NULL,
  slug             TEXT        UNIQUE,                          -- URL용: namu-spa-danang
  google_place_id  TEXT        UNIQUE,

  -- 다국어 이름
  name_vi          TEXT,
  name_ko          TEXT,
  name_en          TEXT,
  name_zh          TEXT,
  name_ja          TEXT,

  -- 주소
  address          TEXT        NOT NULL,
  address_en       TEXT,
  latitude         NUMERIC(10,7),
  longitude        NUMERIC(10,7),
  city             TEXT        NOT NULL DEFAULT 'danang',       -- danang | hoian | hochiminh

  -- 오너 정보
  owner_name       TEXT        NOT NULL,
  owner_phone      TEXT        NOT NULL,
  owner_zalo_id    TEXT,
  owner_auth_id    UUID,                                        -- supabase auth.users.id (Phase 1)

  -- 미디어
  cover_photo_url  TEXT,
  photo_urls       TEXT[]      DEFAULT '{}',

  -- 다국어 소개
  description_vi   TEXT,
  description_ko   TEXT,
  description_en   TEXT,
  description_zh   TEXT,
  description_ja   TEXT,

  -- 운영 상태
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','active','suspended')),
  timezone         TEXT        NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',

  -- 메타
  activated_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shops_status    ON shops (status);
CREATE INDEX idx_shops_city      ON shops (city);
CREATE INDEX idx_shops_location  ON shops USING gist (point(longitude, latitude));
CREATE INDEX idx_shops_name_trgm ON shops USING gin (name gin_trgm_ops);

-- ============================================================
-- 2. SHOP_HOURS (영업시간)
-- ============================================================
CREATE TABLE shop_hours (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id       UUID    NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  day_of_week   INT     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=일, 6=토
  is_open       BOOLEAN NOT NULL DEFAULT true,
  open_time     TIME    NOT NULL DEFAULT '09:00',
  close_time    TIME    NOT NULL DEFAULT '22:00',
  break_start   TIME,                              -- NULL = 브레이크 없음
  break_end     TIME,
  UNIQUE (shop_id, day_of_week),
  -- 브레이크 시간 논리 검증
  CONSTRAINT break_time_check CHECK (
    (break_start IS NULL AND break_end IS NULL) OR
    (break_start IS NOT NULL AND break_end IS NOT NULL AND break_start < break_end)
  ),
  CONSTRAINT open_close_check CHECK (open_time < close_time)
);

-- 파일럿 3개 샵용 기본 영업시간 생성 함수
CREATE OR REPLACE FUNCTION insert_default_shop_hours(p_shop_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO shop_hours (shop_id, day_of_week, is_open, open_time, close_time, break_start, break_end)
  SELECT
    p_shop_id,
    d,
    true,
    '09:00'::TIME,
    '22:00'::TIME,
    '12:30'::TIME,
    '13:30'::TIME
  FROM generate_series(0, 6) AS d;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3. SERVICES (메뉴)
-- ============================================================
CREATE TABLE services (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id       UUID    NOT NULL REFERENCES shops(id) ON DELETE CASCADE,

  -- 다국어 메뉴명
  name_vi       TEXT    NOT NULL,
  name_ko       TEXT,
  name_en       TEXT,
  name_zh       TEXT,
  name_ja       TEXT,

  -- 상세
  duration_min  INT     NOT NULL CHECK (duration_min IN (30, 60, 90, 120)),
  price_vnd     INT     NOT NULL CHECK (price_vnd > 0),
  description   TEXT,

  -- 운영
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_services_shop ON services (shop_id, is_active, sort_order);

-- ============================================================
-- 4. THERAPISTS (테라피스트)
-- ============================================================
CREATE TABLE therapists (
  id               UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id          UUID    NOT NULL REFERENCES shops(id) ON DELETE CASCADE,

  name             TEXT    NOT NULL,

  -- 다국어 소개
  bio_vi           TEXT,
  bio_ko           TEXT,
  bio_en           TEXT,
  bio_zh           TEXT,
  bio_ja           TEXT,

  -- 미디어
  photo_url        TEXT,

  -- 전문 메뉴 (service.id 배열)
  specialty_ids    UUID[]  NOT NULL DEFAULT '{}',

  -- 통계 (배치 갱신)
  rebooking_rate   NUMERIC(4,1) NOT NULL DEFAULT 0 CHECK (rebooking_rate BETWEEN 0 AND 100),
  review_count     INT     NOT NULL DEFAULT 0,
  avg_rating       NUMERIC(3,2) NOT NULL DEFAULT 0,

  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_therapists_shop ON therapists (shop_id, is_active);

-- ============================================================
-- 5. ATTENDANCE (출근 체크)
-- ============================================================
CREATE TABLE attendance (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  therapist_id  UUID    NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  date          DATE    NOT NULL,
  is_working    BOOLEAN NOT NULL DEFAULT false,
  checked_at    TIMESTAMPTZ,
  note          TEXT,                                           -- 메모 (예: 오후만 출근)
  UNIQUE (therapist_id, date)
);

CREATE INDEX idx_attendance_date ON attendance (date, is_working);

-- ============================================================
-- 6. CUSTOMERS (고객 + 노쇼/블랙리스트 관리)
-- ============================================================
CREATE TABLE customers (
  id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone           TEXT    NOT NULL UNIQUE,
  name            TEXT,
  country_code    TEXT,                                         -- KR | EN | CN | JP | VN
  preferred_lang  TEXT    NOT NULL DEFAULT 'en'
                          CHECK (preferred_lang IN ('ko','en','vi','zh','ja')),

  -- 신뢰도 관리
  noshow_count    INT     NOT NULL DEFAULT 0,
  total_bookings  INT     NOT NULL DEFAULT 0,
  is_blacklisted  BOOLEAN NOT NULL DEFAULT false,
  blacklisted_at  TIMESTAMPTZ,
  blacklist_reason TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 노쇼 3회 시 자동 블랙리스트 트리거
CREATE OR REPLACE FUNCTION auto_blacklist_on_noshow()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.noshow_count >= 3 AND NOT NEW.is_blacklisted THEN
    NEW.is_blacklisted    := true;
    NEW.blacklisted_at    := NOW();
    NEW.blacklist_reason  := '노쇼 3회 자동 차단';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customers_auto_blacklist
  BEFORE UPDATE OF noshow_count ON customers
  FOR EACH ROW EXECUTE FUNCTION auto_blacklist_on_noshow();

-- ============================================================
-- 7. BOOKINGS (예약) — 핵심 테이블
-- ============================================================
CREATE TABLE bookings (
  id               UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 관계
  shop_id          UUID    NOT NULL REFERENCES shops(id),
  therapist_id     UUID    NOT NULL REFERENCES therapists(id),
  service_id       UUID    NOT NULL REFERENCES services(id),
  customer_id      UUID    REFERENCES customers(id),

  -- 고객 정보 (비회원도 저장)
  customer_name    TEXT    NOT NULL,
  customer_phone   TEXT    NOT NULL,
  customer_lang    TEXT    NOT NULL DEFAULT 'en'
                           CHECK (customer_lang IN ('ko','en','vi','zh','ja')),

  -- 예약 시간 (UTC 저장)
  scheduled_at     TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,              -- scheduled_at + duration (자동 계산)
  duration_min     INT     NOT NULL CHECK (duration_min IN (30,60,90,120)),

  -- 금액
  price_vnd        INT     NOT NULL CHECK (price_vnd > 0),

  -- 상태
  status           TEXT    NOT NULL DEFAULT 'confirmed'
                           CHECK (status IN (
                             'confirmed',
                             'completed',
                             'cancelled_by_customer',
                             'cancelled_by_shop',
                             'noshow'
                           )),

  -- 취소 정보
  cancel_deadline  TIMESTAMPTZ NOT NULL,              -- scheduled_at - 2h (자동 계산)
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,

  -- 기타
  notes            TEXT,
  internal_note    TEXT,                              -- 오너 내부 메모
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 인덱스 ────────────────────────────────────────────────────
CREATE INDEX idx_bookings_therapist_time
  ON bookings (therapist_id, scheduled_at)
  WHERE status = 'confirmed';

CREATE INDEX idx_bookings_shop_date
  ON bookings (shop_id, scheduled_at DESC);

CREATE INDEX idx_bookings_customer
  ON bookings (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

-- ── 시간 겹침 방지 Exclusion Constraint ──────────────────────
-- 같은 테라피스트의 confirmed 예약은 시간이 겹칠 수 없음
-- (btree_gist 익스텐션 필요)
ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    therapist_id WITH =,
    tstzrange(scheduled_at, ends_at, '[)') WITH &&
  )
  WHERE (status = 'confirmed');

-- ── 자동 계산 트리거 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION bookings_auto_calc()
RETURNS TRIGGER AS $$
BEGIN
  -- ends_at = scheduled_at + duration
  NEW.ends_at         := NEW.scheduled_at + (NEW.duration_min || ' minutes')::INTERVAL;
  -- cancel_deadline = scheduled_at - 2시간
  NEW.cancel_deadline := NEW.scheduled_at - INTERVAL '2 hours';

  -- 과거 시간 예약 방지
  IF NEW.scheduled_at < NOW() THEN
    RAISE EXCEPTION 'scheduled_at cannot be in the past';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_before_insert
  BEFORE INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_auto_calc();

-- 완료 시 고객 통계 갱신
CREATE OR REPLACE FUNCTION bookings_after_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- 노쇼 처리 → customer.noshow_count 증가
  IF NEW.status = 'noshow' AND OLD.status != 'noshow' AND NEW.customer_id IS NOT NULL THEN
    UPDATE customers
    SET noshow_count  = noshow_count + 1,
        updated_at    = NOW()
    WHERE id = NEW.customer_id;
  END IF;

  -- 완료 처리 → customer.total_bookings 증가
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.customer_id IS NOT NULL THEN
    UPDATE customers
    SET total_bookings = total_bookings + 1,
        updated_at     = NOW()
    WHERE id = NEW.customer_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_after_update
  AFTER UPDATE OF status ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_after_status_change();

-- ============================================================
-- 8. NOTIFICATION_LOGS (알림 발송 로그)
-- ============================================================
CREATE TABLE notification_logs (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id  UUID    REFERENCES bookings(id) ON DELETE SET NULL,

  channel     TEXT    NOT NULL CHECK (channel IN ('zalo','whatsapp','sms')),
  recipient   TEXT    NOT NULL,
  type        TEXT    NOT NULL CHECK (type IN (
                'booking_confirmed',
                'booking_cancelled',
                'booking_reminder',
                'noshow_warning'
              )),
  lang        TEXT,

  -- 발송 결과
  status      TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','failed')),
  error_msg   TEXT,
  retry_count INT     NOT NULL DEFAULT 0,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_booking  ON notification_logs (booking_id);
CREATE INDEX idx_notif_status   ON notification_logs (status, created_at)
  WHERE status IN ('pending','failed');

-- ============================================================
-- 9. REVIEWS (리뷰)
-- ============================================================
CREATE TABLE reviews (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id    UUID    NOT NULL UNIQUE REFERENCES bookings(id),
  shop_id       UUID    NOT NULL REFERENCES shops(id),
  therapist_id  UUID    NOT NULL REFERENCES therapists(id),

  rating        INT     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  country       TEXT,
  lang          TEXT,

  is_visible    BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviews_shop       ON reviews (shop_id, is_visible, created_at DESC);
CREATE INDEX idx_reviews_therapist  ON reviews (therapist_id, is_visible);

-- 리뷰 등록 시 테라피스트 avg_rating 자동 갱신
CREATE OR REPLACE FUNCTION update_therapist_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE therapists
  SET avg_rating   = (SELECT AVG(rating) FROM reviews WHERE therapist_id = NEW.therapist_id AND is_visible = true),
      review_count = (SELECT COUNT(*)    FROM reviews WHERE therapist_id = NEW.therapist_id AND is_visible = true)
  WHERE id = NEW.therapist_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reviews_after_insert
  AFTER INSERT OR UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_therapist_rating();

-- ============================================================
-- 10. STORAGE BUCKETS (Supabase Storage)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('namu-photos', 'namu-photos', true, 5242880,  -- 5MB
   ARRAY['image/jpeg','image/jpg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: 인증된 오너만 업로드 가능
CREATE POLICY "owner_upload_photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'namu-photos');

CREATE POLICY "public_read_photos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'namu-photos');

-- ============================================================
-- 11. ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE shops             ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_hours        ENABLE ROW LEVEL SECURITY;
ALTER TABLE services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapists        ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers         ENABLE ROW LEVEL SECURITY;

-- 공개 읽기 (active 샵만)
CREATE POLICY "public_read_shops"
  ON shops FOR SELECT TO public
  USING (status = 'active');

CREATE POLICY "public_read_shop_hours"
  ON shop_hours FOR SELECT TO public
  USING (EXISTS (SELECT 1 FROM shops WHERE shops.id = shop_hours.shop_id AND shops.status = 'active'));

CREATE POLICY "public_read_services"
  ON services FOR SELECT TO public
  USING (is_active = true AND EXISTS (SELECT 1 FROM shops WHERE shops.id = services.shop_id AND shops.status = 'active'));

CREATE POLICY "public_read_therapists"
  ON therapists FOR SELECT TO public
  USING (is_active = true);

CREATE POLICY "public_read_attendance"
  ON attendance FOR SELECT TO public
  USING (true);

CREATE POLICY "public_read_reviews"
  ON reviews FOR SELECT TO public
  USING (is_visible = true);

-- 오너: 자기 샵 데이터만 수정 가능
CREATE POLICY "owner_manage_shop"
  ON shops FOR ALL TO authenticated
  USING (owner_auth_id = auth.uid())
  WITH CHECK (owner_auth_id = auth.uid());

CREATE POLICY "owner_manage_bookings"
  ON bookings FOR ALL TO authenticated
  USING (shop_id IN (SELECT id FROM shops WHERE owner_auth_id = auth.uid()));

-- 서비스롤: 모든 테이블 전체 접근 (API server-side)
-- service_role은 RLS를 bypass하므로 별도 정책 불필요

-- ============================================================
-- 12. UPDATED_AT 자동 갱신
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shops_updated_at
  BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 13. 개발용 시드 데이터
-- ============================================================
DO $$
DECLARE
  shop1_id UUID := uuid_generate_v4();
  shop2_id UUID := uuid_generate_v4();
  shop3_id UUID := uuid_generate_v4();
  svc1_id  UUID := uuid_generate_v4();
  svc2_id  UUID := uuid_generate_v4();
  t1_id    UUID := uuid_generate_v4();
  t2_id    UUID := uuid_generate_v4();
BEGIN

  -- 샵 3개 삽입
  INSERT INTO shops (id, name, name_ko, name_en, address, city, owner_name, owner_phone, status, latitude, longitude)
  VALUES
    (shop1_id, 'Namu Spa Đà Nẵng', '나무 스파 다낭', 'Namu Spa Da Nang',
     '123 Nguyễn Văn Linh, Đà Nẵng', 'danang', 'Nguyễn Văn An', '+84901111111', 'active', 16.0671, 108.2089),
    (shop2_id, 'Hội An Relaxation', '호이안 릴렉세이션', 'Hoi An Relaxation',
     '45 Trần Phú, Hội An', 'hoian', 'Trần Thị Bình', '+84902222222', 'active', 15.8801, 108.3380),
    (shop3_id, 'Saigon Body & Soul', '사이공 바디앤소울', 'Saigon Body & Soul',
     '88 Lê Lợi, Quận 1, TP.HCM', 'hochiminh', 'Lê Văn Cường', '+84903333333', 'pending', 10.7769, 106.7009);

  -- 영업시간 (7일 모두)
  PERFORM insert_default_shop_hours(shop1_id);
  PERFORM insert_default_shop_hours(shop2_id);

  -- 서비스
  INSERT INTO services (id, shop_id, name_vi, name_ko, name_en, duration_min, price_vnd)
  VALUES
    (svc1_id, shop1_id, 'Massage Toàn Thân', '전신 마사지', 'Full Body Massage', 60, 300000),
    (svc2_id, shop1_id, 'Massage Thái Lan', '타이 마사지', 'Thai Massage', 90, 450000);

  -- 테라피스트
  INSERT INTO therapists (id, shop_id, name, bio_ko, bio_en, specialty_ids, rebooking_rate)
  VALUES
    (t1_id, shop1_id, 'Linh', '10년 경력 전신 마사지 전문', '10 years full body specialist',
     ARRAY[svc1_id, svc2_id], 87.5),
    (t2_id, shop1_id, 'Mai', '아로마 & 타이 마사지 전문', 'Aroma & Thai massage expert',
     ARRAY[svc2_id], 92.0);

  -- 출근 체크 (오늘)
  INSERT INTO attendance (therapist_id, date, is_working, checked_at)
  VALUES
    (t1_id, CURRENT_DATE, true,  NOW()),
    (t2_id, CURRENT_DATE, false, NOW());

END $$;