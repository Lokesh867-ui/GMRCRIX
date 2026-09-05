import { supabase } from './supabase.js';

const $ = id => document.getElementById(id);
const matchId = new URLSearchParams(location.search).get('id');

let match = null;
let innings = null;
let batting = [];
let bowling = [];

let state = {
  striker: null,
  non: null,
  bowler: null
};

const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

/* =========================
   AUTHENTICATION
========================= */

async function ensureAuth() {
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session) {
    location.href = 'admin.html';
    return false;
  }

  return true;
}

/* =========================
   GET DELIVERIES
========================= */

async function deliveries() {
  if (!innings) return [];

  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .eq('innings_id', innings.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    return [];
  }

  return data || [];
}

/* =========================
   CALCULATE SCORE
========================= */

function calc(d) {
  const runs = d.reduce(
    (sum, ball) => sum + Number(ball.total_runs || 0),
    0
  );

  const wickets = d.filter(
    ball => ball.wicket
  ).length;

  const legal = d.filter(
    ball => ball.legal_ball
  ).length;

  return {
    runs,
    wickets,
    legal,
    overs: `${Math.floor(legal / 6)}.${legal % 6}`
  };
}

/* =========================
   LOAD MATCH
========================= */

async function load() {

  const { data: m, error } = await supabase
    .from('matches')
    .select(`
      *,
      team_a:teams!matches_team_a_id_fkey(id,name),
      team_b:teams!matches_team_b_id_fkey(id,name)
    `)
    .eq('id', matchId)
    .single();

  if (error) {
    alert(error.message);
    return;
  }

  match = m;

  /*
    Find currently live innings.
  */

  const { data: i, error: inningsError } = await supabase
    .from('innings')
    .select('*')
    .eq('match_id', matchId)
    .eq('status', 'live')
    .order('innings_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inningsError) {
    alert(inningsError.message);
    return;
  }

  innings = i;

  if (!innings) {
    alert('There is no active innings.');
    location.href = `manage.html?id=${matchId}`;
    return;
  }

  /*
    LOAD PLAYERS

    This uses match_players if your Playing XI
    is stored there.
  */

  const { data: mp, error: mpError } = await supabase
    .from('match_players')
    .select(`
      team_id,
      players(id,name,role)
    `)
    .eq('match_id', matchId)
    .eq('is_playing_xi', true);

  if (mpError) {
    console.error(mpError);
    alert('Unable to load Playing XI: ' + mpError.message);
    return;
  }

  batting = (mp || [])
    .filter(x => x.team_id === innings.batting_team_id)
    .map(x => x.players)
    .filter(Boolean);

  bowling = (mp || [])
    .filter(x => x.team_id === innings.bowling_team_id)
    .map(x => x.players)
    .filter(Boolean);

  /*
    PAGE DETAILS
  */

  if ($('title')) {
    $('title').textContent =
      `${match.team_a.name} vs ${match.team_b.name}`;
  }

  if ($('inningsTitle')) {
    $('inningsTitle').textContent =
      `Innings ${innings.innings_no} · LIVE`;
  }

  if ($('target')) {
    $('target').textContent =
      innings.target || '—';
  }

  if ($('publicLink')) {
    $('publicLink').href =
      `match.html?id=${matchId}`;
  }

  await rebuildState();

  fillSelects();

  await refresh();
}

/* =========================
   REBUILD CURRENT STATE
========================= */

async function rebuildState() {

  const d = await deliveries();

  /*
    New innings.
  */

  if (!d.length) {
    state = {
      striker: null,
      non: null,
      bowler: null
    };
    return;
  }

  const last = d[d.length - 1];

  state = {
    striker: last.striker_id,
    non: last.non_striker_id,
    bowler: last.bowler_id
  };

  /*
    Strike changes for odd runs.

    Only batsman runs, byes and leg byes
    cause batsmen to change ends.
  */

  const runningRuns =
    Number(last.batsman_runs || 0) +
    Number(last.extras_byes || 0) +
    Number(last.extras_legbyes || 0);

  if (runningRuns % 2 !== 0) {
    [state.striker, state.non] =
      [state.non, state.striker];
  }

  /*
    Wicket.
  */

  if (last.wicket) {

    if (last.dismissed_player_id === last.striker_id) {
      state.striker = null;
    }

    if (last.dismissed_player_id === last.non_striker_id) {
      state.non = null;
    }
  }

  /*
    Over completed.
  */

  const legalBalls = d.filter(
    x => x.legal_ball
  ).length;

  if (
    legalBalls > 0 &&
    legalBalls % 6 === 0 &&
    last.legal_ball
  ) {

    [state.striker, state.non] =
      [state.non, state.striker];

    state.bowler = null;
  }
}

/* =========================
   PLAYER OPTIONS
========================= */

function opts(players) {

  return `
    <option value="">
      Select player
    </option>
  ` + players.map(player => `
    <option value="${player.id}">
      ${esc(player.name)} (${esc(player.role || '')})
    </option>
  `).join('');
}

function fillSelects() {

  if ($('striker')) {
    $('striker').innerHTML = opts(batting);
    $('striker').value = state.striker || '';
  }

  if ($('nonStriker')) {
    $('nonStriker').innerHTML = opts(batting);
    $('nonStriker').value = state.non || '';
  }

  if ($('bowler')) {
    $('bowler').innerHTML = opts(bowling);
    $('bowler').value = state.bowler || '';
  }
}

/* =========================
   REFRESH SCOREBOARD
========================= */

async function refresh() {

  const d = await deliveries();
  const c = calc(d);

  const rr = c.legal
    ? (c.runs / (c.legal / 6)).toFixed(2)
    : '0.00';

  if ($('score')) {
    $('score').textContent =
      `${c.runs}/${c.wickets}`;
  }

  if ($('rr')) {
    $('rr').textContent = rr;
  }

  if ($('overText')) {

    const maxBalls = Number(match.overs) * 6;

    let text = `Overs: ${c.overs}`;

    if (c.legal >= maxBalls) {
      text = `✓ ${match.overs} Overs Completed`;
    }

    $('overText').textContent = text;
  }

  /*
    Commentary
  */

  if ($('commentary')) {

    $('commentary').innerHTML =
      d.slice()
        .reverse()
        .map(x => `
          <div class="comment">
            <b>${x.over_number}.${x.ball_number}</b>
            — ${esc(x.commentary || 'Ball recorded')}
          </div>
        `)
        .join('') ||
      '<p class="muted">No deliveries yet.</p>';
  }

  if ($('battingStats')) {
    battingStats(d);
  }

  if ($('bowlingStats')) {
    bowlingStats(d);
  }
}

/* =========================
   BATTING STATISTICS
========================= */

function battingStats(d) {

  $('battingStats').innerHTML =
    batting.map(player => {

      const playerBalls = d.filter(
        x =>
          x.striker_id === player.id &&
          x.legal_ball
      ).length;

      const playerRuns = d
        .filter(x => x.striker_id === player.id)
        .reduce(
          (sum, x) =>
            sum + Number(x.batsman_runs || 0),
          0
        );

      const sr = playerBalls
        ? ((playerRuns * 100) / playerBalls).toFixed(1)
        : '0.0';

      return `
        <div class="item">
          <strong>
            ${esc(player.name)}
            ${state.striker === player.id ? '*' : ''}
          </strong>

          <span class="small">
            ${playerRuns} runs
            · ${playerBalls} balls
            · SR ${sr}
          </span>
        </div>
      `;

    }).join('');
}

/* =========================
   BOWLING STATISTICS
========================= */

function bowlingStats(d) {

  $('bowlingStats').innerHTML =
    bowling.map(player => {

      const mine = d.filter(
        x => x.bowler_id === player.id
      );

      const legal = mine.filter(
        x => x.legal_ball
      ).length;

      const runs = mine.reduce(
        (sum, x) =>
          sum + Number(x.total_runs || 0),
        0
      );

      const economy = legal
        ? (runs / (legal / 6)).toFixed(2)
        : '0.00';

      const wickets = mine.filter(
        x =>
          x.wicket &&
          [
            'Bowled',
            'Caught',
            'LBW',
            'Stumped',
            'Hit Wicket'
          ].includes(x.dismissal_type)
      ).length;

      return `
        <div class="item">

          <strong>
            ${esc(player.name)}
            ${state.bowler === player.id ? '*' : ''}
          </strong>

          <span class="small">
            ${Math.floor(legal / 6)}.${legal % 6} overs
            · ${runs} runs
            · ${wickets} wickets
            · ECO ${economy}
          </span>

        </div>
      `;

    }).join('');
}

/* =========================
   SAVE PLAYERS
========================= */

if ($('savePlayers')) {

  $('savePlayers').onclick = () => {

    const striker = $('striker').value;
    const non = $('nonStriker').value;
    const bowler = $('bowler').value;

    if (!striker || !non || !bowler) {
      alert('Select striker, non-striker and bowler.');
      return;
    }

    if (striker === non) {
      alert('Striker and non-striker cannot be the same.');
      return;
    }

    state = {
      striker,
      non,
      bowler
    };

    alert('Players selected successfully.');
  };
}

/* =========================
   RECORD BALL
========================= */

async function record(x) {

  /*
    Prevent scoring when paused.
  */

  if (match.status === 'paused') {
    alert('Match is currently paused.');
    return;
  }

  /*
    Check active innings.
  */

  if (!innings || innings.status !== 'live') {
    alert('There is no active innings.');
    return;
  }

  /*
    Check striker, non-striker and bowler.
  */

  if (
    !state.striker ||
    !state.non ||
    !state.bowler
  ) {
    alert(
      'Select striker, non-striker and bowler first.'
    );
    return;
  }

  const existing = await deliveries();
  const current = calc(existing);

  const maximumBalls =
    Number(match.overs) * 6;

  /*
    Prevent scoring after overs completed.
  */

  if (current.legal >= maximumBalls) {

    alert(
      `${match.overs} overs are already completed.`
    );

    return;
  }

  /*
    Wide and no-ball are not legal balls.
  */

  const legalBall =
    !x.wide && !x.noBall;

  const totalRuns =
    Number(x.bat || 0) +
    Number(x.wide || 0) +
    Number(x.noBall || 0) +
    Number(x.bye || 0) +
    Number(x.legBye || 0);

  /*
    Current over and ball number.
  */

  const overNumber =
    Math.floor(current.legal / 6);

  const ballNumber =
    (current.legal % 6) + 1;

  const row = {

    innings_id: innings.id,

    over_number: overNumber,

    ball_number: ballNumber,

    striker_id: state.striker,

    non_striker_id: state.non,

    bowler_id: state.bowler,

    batsman_runs: Number(x.bat || 0),

    extras_wides: Number(x.wide || 0),

    extras_noballs: Number(x.noBall || 0),

    extras_byes: Number(x.bye || 0),

    extras_legbyes: Number(x.legBye || 0),

    total_runs: totalRuns,

    legal_ball: legalBall,

    wicket: !!x.wicket,

    dismissal_type: x.dismissal || null,

    dismissed_player_id: x.dismissed || null,

    fielder_id: x.fielder || null,

    commentary: x.commentary || ''
  };

  const { error } = await supabase
    .from('deliveries')
    .insert(row);

  if (error) {
    alert(error.message);
    return;
  }

  /*
    NEW BATSMAN AFTER WICKET
  */

  if (x.wicket) {

    if (x.dismissed === state.striker) {
      state.striker = x.newBatsman || null;
    }

    if (x.dismissed === state.non) {
      state.non = x.newBatsman || null;
    }

  } else {

    /*
      Change strike on odd running runs.
    */

    const runningRuns =
      Number(x.bat || 0) +
      Number(x.bye || 0) +
      Number(x.legBye || 0);

    if (runningRuns % 2 !== 0) {
      [state.striker, state.non] =
        [state.non, state.striker];
    }
  }

  const updated = await deliveries();
  const updatedCalc = calc(updated);

  /*
    CHECK TARGET BEFORE MAXIMUM OVERS.
  */

  if (innings.innings_no === 2 && innings.target) {

    if (updatedCalc.runs >= Number(innings.target)) {

      await refresh();

      await finishSecond(true);

      return;
    }
  }

  /*
    MAXIMUM OVERS COMPLETED
  */

  if (updatedCalc.legal >= maximumBalls) {

    await refresh();

    await oversCompleted(updatedCalc);

    return;
  }

  /*
    NORMAL OVER COMPLETED
  */

  if (
    legalBall &&
    updatedCalc.legal > 0 &&
    updatedCalc.legal % 6 === 0
  ) {

    /*
      Change batsmen at end of over.
    */

    [state.striker, state.non] =
      [state.non, state.striker];

    /*
      Force admin to select new bowler.
    */

    state.bowler = null;

    alert(
      '✓ Over completed.\n\nSelect a new bowler.'
    );
  }

  fillSelects();

  await refresh();
}

/* =========================
   OVERS COMPLETED
========================= */

async function oversCompleted(score) {

  /*
    FIRST INNINGS
  */

  if (innings.innings_no === 1) {

    await completeFirstInnings(score);

    return;
  }

  /*
    SECOND INNINGS
  */

  if (innings.innings_no === 2) {

    await finishSecond(false);

    return;
  }
}

/* =========================
   COMPLETE FIRST INNINGS
========================= */

async function completeFirstInnings(score) {

  const target = score.runs + 1;

  /*
    Complete first innings.
  */

  const { error: firstError } = await supabase
    .from('innings')
    .update({
      status: 'completed'
    })
    .eq('id', innings.id);

  if (firstError) {
    alert(firstError.message);
    return;
  }

  /*
    Check whether innings 2 already exists.
  */

  const { data: existingSecond, error: checkError } =
    await supabase
      .from('innings')
      .select('*')
      .eq('match_id', matchId)
      .eq('innings_no', 2)
      .maybeSingle();

  if (checkError) {
    alert(checkError.message);
    return;
  }

  /*
    If second innings does not exist,
    create it.
  */

  if (!existingSecond) {

    const { error: secondError } =
      await supabase
        .from('innings')
        .insert({

          match_id: matchId,

          innings_no: 2,

          /*
            Teams change roles.
          */

          batting_team_id:
            innings.bowling_team_id,

          bowling_team_id:
            innings.batting_team_id,

          target: target,

          status: 'live'
        });

    if (secondError) {
      alert(secondError.message);
      return;
    }

  } else {

    /*
      If innings 2 exists,
      make sure it becomes live.
    */

    const { error: activateError } =
      await supabase
        .from('innings')
        .update({
          status: 'live',
          target: target
        })
        .eq('id', existingSecond.id);

    if (activateError) {
      alert(activateError.message);
      return;
    }
  }

  /*
    Update match to innings 2.
  */

  const { error: matchError } =
    await supabase
      .from('matches')
      .update({
        status: 'live',
        current_innings: 2
      })
      .eq('id', matchId);

  if (matchError) {
    alert(matchError.message);
    return;
  }

  alert(
    `✓ ${match.overs} Overs Completed!\n\n` +
    `INNINGS 1 COMPLETED\n\n` +
    `Score: ${score.runs}/${score.wickets}\n` +
    `Target: ${target}\n\n` +
    `Starting Innings 2...`
  );

  /*
    Reload scorer.

    load() will now find the
    second innings as active.
  */

  location.href = `scorer.html?id=${matchId}`;
}

/* =========================
   FIRST INNINGS SCORE
========================= */

async function firstScore() {

  const { data: firstInnings, error } =
    await supabase
      .from('innings')
      .select('id')
      .eq('match_id', matchId)
      .eq('innings_no', 1)
      .maybeSingle();

  if (error || !firstInnings) {
    return 0;
  }

  const { data } =
    await supabase
      .from('deliveries')
      .select('total_runs')
      .eq('innings_id', firstInnings.id);

  return (data || []).reduce(
    (sum, ball) =>
      sum + Number(ball.total_runs || 0),
    0
  );
}

/* =========================
   FINISH SECOND INNINGS
========================= */

async function finishSecond(targetReached = false) {

  if (!innings) return;

  const currentDeliveries =
    await deliveries();

  const score =
    calc(currentDeliveries);

  const firstRuns =
    await firstScore();

  const battingTeam =
    innings.batting_team_id;

  const bowlingTeam =
    innings.bowling_team_id;

  const battingName =
    battingTeam === match.team_a.id
      ? match.team_a.name
      : match.team_b.name;

  const bowlingName =
    bowlingTeam === match.team_a.id
      ? match.team_a.name
      : match.team_b.name;

  let winnerTeamId = null;
  let resultText = '';

  /*
    CHASING TEAM WINS
  */

  if (score.runs > firstRuns) {

    winnerTeamId = battingTeam;

    const wicketsRemaining =
      10 - score.wickets;

    resultText =
      `${battingName} won by ` +
      `${wicketsRemaining} wicket(s)`;

  }

  /*
    FIRST BATTING TEAM WINS
  */

  else if (score.runs < firstRuns) {

    winnerTeamId = bowlingTeam;

    resultText =
      `${bowlingName} won by ` +
      `${firstRuns - score.runs} run(s)`;

  }

  /*
    TIE
  */

  else {

    resultText =
      'Match tied';
  }

  /*
    Complete innings 2.
  */

  const { error: inningsError } =
    await supabase
      .from('innings')
      .update({
        status: 'completed'
      })
      .eq('id', innings.id);

  if (inningsError) {
    alert(inningsError.message);
    return;
  }

  /*
    Complete match.
  */

  const updateData = {
    status: 'completed',
    winner_team_id: winnerTeamId,
    result_text: resultText
  };

  const { error: matchError } =
    await supabase
      .from('matches')
      .update(updateData)
      .eq('id', matchId);

  if (matchError) {
    alert(matchError.message);
    return;
  }

  match.status = 'completed';

  alert(
    targetReached
      ? `TARGET REACHED!\n\n${resultText}`
      : `MATCH COMPLETED!\n\n${resultText}`
  );

  location.href =
    `match.html?id=${matchId}`;
}

/* =========================
   RUN BUTTONS
========================= */

document
  .querySelectorAll('[data-run]')
  .forEach(button => {

    button.onclick = () => {

      const runs =
        Number(button.dataset.run);

      record({
        bat: runs,

        commentary:
          runs === 0
            ? 'Dot ball'
            : `${runs} run(s)`
      });

    };
  });

/* =========================
   WIDE
========================= */

if ($('wide')) {

  $('wide').onclick = () => {

    const runs = Number(
      prompt(
        'Enter total wide runs',
        '1'
      )
    );

    if (!runs || runs < 1) {
      alert('Invalid wide runs.');
      return;
    }

    record({
      wide: runs,
      commentary: `${runs} wide run(s)`
    });
  };
}

/* =========================
   NO BALL
========================= */

if ($('noBall')) {

  $('noBall').onclick = () => {

    const batRuns = Number(
      prompt(
        'Bat runs from this no-ball',
        '0'
      )
    );

    if (
      Number.isNaN(batRuns) ||
      batRuns < 0
    ) {
      alert('Invalid runs.');
      return;
    }

    record({
      noBall: 1,
      bat: batRuns,
      commentary:
        `No ball + ${batRuns} bat run(s)`
    });
  };
}

/* =========================
   BYES
========================= */

if ($('bye')) {

  $('bye').onclick = () => {

    const runs = Number(
      prompt('Bye runs', '1')
    );

    if (!runs || runs < 1) {
      alert('Invalid bye runs.');
      return;
    }

    record({
      bye: runs,
      commentary: `${runs} bye run(s)`
    });
  };
}

/* =========================
   LEG BYES
========================= */

if ($('legBye')) {

  $('legBye').onclick = () => {

    const runs = Number(
      prompt('Leg bye runs', '1')
    );

    if (!runs || runs < 1) {
      alert('Invalid leg-bye runs.');
      return;
    }

    record({
      legBye: runs,
      commentary:
        `${runs} leg-bye run(s)`
    });
  };
}

/* =========================
   WICKET
========================= */

if ($('wicket')) {

  $('wicket').onclick = () => {

    if (
      !state.striker ||
      !state.non
    ) {
      alert('Select batsmen first.');
      return;
    }

    const dismissedOptions = `
      <option value="${state.striker}">
        ${esc(
          batting.find(
            p => p.id === state.striker
          )?.name || 'Striker'
        )}
      </option>

      <option value="${state.non}">
        ${esc(
          batting.find(
            p => p.id === state.non
          )?.name || 'Non-striker'
        )}
      </option>
    `;

    const availablePlayers =
      batting.filter(
        p =>
          p.id !== state.striker &&
          p.id !== state.non
      );

    const newPlayerOptions =
      availablePlayers.map(p => `
        <option value="${p.id}">
          ${esc(p.name)}
        </option>
      `).join('');

    const dismissed =
      prompt(
        'Who is out?\n\n1 = Striker\n2 = Non-striker',
        '1'
      );

    let dismissedId;

    if (dismissed === '1') {
      dismissedId = state.striker;
    } else if (dismissed === '2') {
      dismissedId = state.non;
    } else {
      return;
    }

    const dismissal =
      prompt(
        'Dismissal type\nBowled / Caught / LBW / Run Out / Stumped',
        'Bowled'
      );

    if (!dismissal) return;

    /*
      Simple new batsman selection.
    */

    const availableNames =
      availablePlayers
        .map(
          (p, index) =>
            `${index + 1}. ${p.name}`
        )
        .join('\n');

    if (!availableNames) {

      /*
        No players remaining.
        Record wicket and finish innings.
      */

      record({
        wicket: true,
        dismissed: dismissedId,
        dismissal,
        commentary: `WICKET! ${dismissal}`
      });

      return;
    }

    const playerChoice = Number(
      prompt(
        `Select new batsman:\n\n${availableNames}`,
        '1'
      )
    );

    const newBatsman =
      availablePlayers[playerChoice - 1];

    if (!newBatsman) {
      alert('Invalid batsman.');
      return;
    }

    record({
      wicket: true,

      dismissed: dismissedId,

      newBatsman: newBatsman.id,

      dismissal,

      commentary:
        `WICKET! ${dismissal}`
    });
  };
}

/* =========================
   UNDO LAST BALL
========================= */

if ($('undo')) {

  $('undo').onclick =
    async () => {

      const d =
        await deliveries();

      const last =
        d[d.length - 1];

      if (!last) {
        alert('No ball available to undo.');
        return;
      }

      if (
        !confirm(
          'Undo the last ball?'
        )
      ) {
        return;
      }

      const { error } =
        await supabase
          .from('deliveries')
          .delete()
          .eq('id', last.id);

      if (error) {
        alert(error.message);
        return;
      }

      await rebuildState();

      fillSelects();

      await refresh();
    };
}

/* =========================
   PAUSE MATCH
========================= */

if ($('pauseMatch')) {

  $('pauseMatch').onclick =
    async () => {

      const { error } =
        await supabase
          .from('matches')
          .update({
            status: 'paused'
          })
          .eq('id', matchId);

      if (error) {
        alert(error.message);
        return;
      }

      await supabase
        .from('innings')
        .update({
          status: 'paused'
        })
        .eq('id', innings.id);

      match.status = 'paused';

      alert('Match paused.');
    };
}

/* =========================
   RESUME MATCH
========================= */

if ($('resumeMatch')) {

  $('resumeMatch').onclick =
    async () => {

      const { error } =
        await supabase
          .from('matches')
          .update({
            status: 'live'
          })
          .eq('id', matchId);

      if (error) {
        alert(error.message);
        return;
      }

      await supabase
        .from('innings')
        .update({
          status: 'live'
        })
        .eq('id', innings.id);

      match.status = 'live';

      alert('Match resumed.');
    };
}

/* =========================
   MANUAL END INNINGS
========================= */

if ($('endInnings')) {

  $('endInnings').onclick =
    async () => {

      if (
        !confirm(
          'Are you sure you want to end this innings?'
        )
      ) {
        return;
      }

      const d = await deliveries();
      const score = calc(d);

      if (innings.innings_no === 1) {

        await completeFirstInnings(score);

      } else {

        await finishSecond(false);

      }
    };
}

/* =========================
   END MATCH
========================= */

if ($('endMatch')) {

  $('endMatch').onclick =
    async () => {

      if (
        !confirm(
          'End this match now?'
        )
      ) {
        return;
      }

      if (innings.innings_no === 2) {

        await finishSecond(false);

        return;
      }

      const { error } =
        await supabase
          .from('matches')
          .update({
            status: 'completed',
            result_text:
              'Match ended by administrator'
          })
          .eq('id', matchId);

      if (error) {
        alert(error.message);
        return;
      }

      location.href =
        `match.html?id=${matchId}`;
    };
}

/* =========================
   START APPLICATION
========================= */

(async () => {

  const authenticated =
    await ensureAuth();

  if (!authenticated) return;

  if (!matchId) {
    alert('Match ID is missing.');
    location.href = 'admin.html';
    return;
  }

  await load();

})();