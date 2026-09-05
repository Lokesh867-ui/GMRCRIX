-- GMRCRIX COMPLETE FRESH DATABASE
create extension if not exists pgcrypto;

drop table if exists deliveries cascade;
drop table if exists innings cascade;
drop table if exists match_players cascade;
drop table if exists matches cascade;
drop table if exists players cascade;
drop table if exists teams cascade;

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  role text not null check (role in ('Batsman','Bowler','All-rounder','Wicketkeeper')),
  created_at timestamptz not null default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team_a_id uuid not null references teams(id) on delete restrict,
  team_b_id uuid not null references teams(id) on delete restrict,
  overs integer not null check (overs > 0),
  venue text,
  status text not null default 'scheduled'
    check (status in ('scheduled','toss','live','paused','innings_break','completed','cancelled')),
  toss_winner_id uuid references teams(id),
  toss_decision text check (toss_decision in ('bat','bowl')),
  current_innings integer not null default 0 check (current_innings between 0 and 2),
  winner_team_id uuid references teams(id),
  result_text text,
  created_at timestamptz not null default now(),
  check (team_a_id <> team_b_id)
);

create table match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  is_playing_xi boolean not null default false,
  is_captain boolean not null default false,
  is_substitute boolean not null default false,
  is_impact boolean not null default false,
  unique(match_id, player_id)
);

create table innings (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  innings_no integer not null check (innings_no in (1,2)),
  batting_team_id uuid not null references teams(id),
  bowling_team_id uuid not null references teams(id),
  status text not null default 'live' check (status in ('live','paused','completed')),
  target integer,
  created_at timestamptz not null default now(),
  unique(match_id, innings_no)
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  innings_id uuid not null references innings(id) on delete cascade,
  over_number integer not null check (over_number >= 0),
  ball_number integer not null check (ball_number between 1 and 6),
  striker_id uuid not null references players(id),
  non_striker_id uuid not null references players(id),
  bowler_id uuid not null references players(id),
  batsman_runs integer not null default 0 check (batsman_runs between 0 and 6),
  extras_wides integer not null default 0 check (extras_wides >= 0),
  extras_noballs integer not null default 0 check (extras_noballs >= 0),
  extras_byes integer not null default 0 check (extras_byes >= 0),
  extras_legbyes integer not null default 0 check (extras_legbyes >= 0),
  total_runs integer not null default 0,
  legal_ball boolean not null default true,
  wicket boolean not null default false,
  dismissal_type text,
  dismissed_player_id uuid references players(id),
  fielder_id uuid references players(id),
  commentary text,
  created_at timestamptz not null default now()
);

create index deliveries_innings_created on deliveries(innings_id, created_at);
create index players_team on players(team_id);

alter table teams enable row level security;
alter table players enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;
alter table innings enable row level security;
alter table deliveries enable row level security;

create policy "public read teams" on teams for select using (true);
create policy "public read players" on players for select using (true);
create policy "public read matches" on matches for select using (true);
create policy "public read match_players" on match_players for select using (true);
create policy "public read innings" on innings for select using (true);
create policy "public read deliveries" on deliveries for select using (true);

create policy "authenticated manage teams" on teams for all to authenticated using (true) with check (true);
create policy "authenticated manage players" on players for all to authenticated using (true) with check (true);
create policy "authenticated manage matches" on matches for all to authenticated using (true) with check (true);
create policy "authenticated manage match_players" on match_players for all to authenticated using (true) with check (true);
create policy "authenticated manage innings" on innings for all to authenticated using (true) with check (true);
create policy "authenticated manage deliveries" on deliveries for all to authenticated using (true) with check (true);
