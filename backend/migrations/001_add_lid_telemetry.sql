alter table public.telemetry
  add column if not exists lid_distance_cm double precision,
  add column if not exists tamper boolean not null default false;