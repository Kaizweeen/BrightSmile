-- Review fix: issueCode and resendCode used to count-then-insert and read-then-insert as two
-- separate steps, so parallel requests could all see the same stale count/row and all send a
-- paid text past the limit (spec 10.3: at most 3 codes per mobile and 10 per IP per rolling
-- hour, resend allowed after 60 seconds). This locks per mobile and per IP for the whole
-- decide-then-insert sequence so only one caller in a race can proceed.
--
-- security invoker (like the other booking functions): the app only ever calls this with the
-- server's secret key (service_role), which bypasses RLS regardless, so there is no need for
-- definer's extra privilege.
create function public.issue_otp(
  p_id uuid,
  p_mobile text,
  p_ip text,
  p_code_hash text,
  p_booking jsonb,
  p_now timestamptz,
  p_expires_at timestamptz,
  p_resend_of uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_mobile text;
  v_old_expires timestamptz;
  v_old_verified timestamptz;
  v_newest timestamptz;
  v_mobile_count int;
  v_ip_count int;
begin
  -- Always lock mobile then ip, in that order, so two racing callers never deadlock.
  perform pg_advisory_xact_lock(hashtext('otp:mobile:' || p_mobile));
  perform pg_advisory_xact_lock(hashtext('otp:ip:' || p_ip));

  if p_resend_of is not null then
    select mobile, expires_at, verified_at into v_old_mobile, v_old_expires, v_old_verified
    from public.otp_requests
    where id = p_resend_of;

    if v_old_mobile is null or v_old_mobile <> p_mobile or v_old_verified is not null or v_old_expires <= p_now then
      return jsonb_build_object('status', 'gone');
    end if;

    -- 60 second resend wait (OTP.resendMs in src/lib/codes.ts), measured from the newest code
    -- for this mobile, not just the row being resent: a resend chain must not shrink the wait.
    select max(created_at) into v_newest from public.otp_requests where mobile = p_mobile;
    if v_newest is not null and v_newest > p_now - interval '60 seconds' then
      return jsonb_build_object(
        'status', 'wait',
        'wait_seconds', ceil(extract(epoch from (v_newest + interval '60 seconds' - p_now)))
      );
    end if;

    update public.otp_requests set expires_at = p_now where id = p_resend_of;
  end if;

  -- Rolling-hour limits (OTP.perMobilePerHour = 3, OTP.perIpPerHour = 10 in src/lib/codes.ts).
  select count(*) into v_mobile_count
  from public.otp_requests
  where mobile = p_mobile and created_at > p_now - interval '1 hour';
  if v_mobile_count >= 3 then
    return jsonb_build_object('status', 'limited');
  end if;

  select count(*) into v_ip_count
  from public.otp_requests
  where ip = p_ip and created_at > p_now - interval '1 hour';
  if v_ip_count >= 10 then
    return jsonb_build_object('status', 'limited');
  end if;

  insert into public.otp_requests (id, mobile, ip, code_hash, booking, created_at, expires_at)
  values (p_id, p_mobile, p_ip, p_code_hash, p_booking, p_now, p_expires_at);

  return jsonb_build_object('status', 'ok');
end;
$$;
revoke execute on function public.issue_otp(uuid, text, text, text, jsonb, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.issue_otp(uuid, text, text, text, jsonb, timestamptz, timestamptz, uuid) to service_role;
