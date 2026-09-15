import { supabase } from './supabase.js';

const $ = id => document.getElementById(id);

const matchId =
  new URLSearchParams(location.search).get('id');

let match = null;
let innings = null;

let batting = [];
let bowling = [];

let state = {
  striker: null,
  non: null,
  bowler: null
};

/* ESCAPE HTML */
const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

/* =========================================================
   SHOW ERROR
========================================================= */

function showPageError(message) {
  if ($('title')) $('title').textContent = 'Scorer Error';
  if ($('inningsTitle')) $('inningsTitle').textContent = message;
  if ($('score')) $('score').textContent = '—';
  if ($('rr')) $('rr').textContent = '—';
  if ($('target')) $('target').textContent = '—';

  console.error(message);
}

/* =========================================================
   AUTHENTICATION
========================================================= */

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

/* =========================================================
   GET DELIVERIES
========================================================= */

async function deliveries() {
  if (!innings) return [];

  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .eq('innings_id', innings.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Unable to load deliveries:', error);
    return [];
  }

  return data || [];
}

/* =========================================================
   PREVIOUS OVER BOWLER
========================================================= */

async function getPreviousOverBowler() {
  const d = await deliveries();

  if (!d.length) return null;

  const legalBalls =
    d.filter(x => x.legal_ball).length;

  if (legalBalls < 6) return null;

  const currentOver =
    Math.floor(legalBalls / 6);

  const previousOver =
    currentOver - 1;

  const previousBalls =
    d.filter(x =>
      x.over_number === previousOver &&
      x.legal_ball &&
      x.bowler_id
    );

  if (!previousBalls.length) return null;

  return previousBalls[0].bowler_id;
}

/* =========================================================
   CHECK BOWLER RULE
========================================================= */

async function checkBowlerRule(bowlerId) {
  if (!bowlerId) return true;

  const previousOverBowler =
    await getPreviousOverBowler();

  if (!previousOverBowler) return true;

  return previousOverBowler !== bowlerId;
}

/* =========================================================
   CALCULATE SCORE
========================================================= */

function calc(d) {
  const runs =
    d.reduce(
      (sum, ball) =>
        sum + Number(ball.total_runs || 0),
      0
    );

  const wickets =
    d.filter(ball => ball.wicket).length;

  const legal =
    d.filter(ball => ball.legal_ball).length;

  return {
    runs,
    wickets,
    legal,
    overs:
      `${Math.floor(legal / 6)}.${legal % 6}`
  };
}

/* =========================================================
   LOAD MATCH
========================================================= */

async function load() {

  if (!matchId) {
    showPageError('Match ID is missing.');
    return;
  }

  const { data: m, error } =
    await supabase
      .from('matches')
      .select(`
        *,
        team_a:teams!matches_team_a_id_fkey(id,name),
        team_b:teams!matches_team_b_id_fkey(id,name)
      `)
      .eq('id', matchId)
      .single();

  if (error || !m) {
    showPageError(
      'Unable to load match: ' +
      (error?.message || 'Match not found')
    );
    return;
  }

  match = m;

  const { data: i, error: inningsError } =
    await supabase
      .from('innings')
      .select('*')
      .eq('match_id', matchId)
      .eq('status', 'live')
      .order('innings_no', {
        ascending: false
      })
      .limit(1)
      .maybeSingle();

  if (inningsError) {
    showPageError(
      'Unable to load innings: ' +
      inningsError.message
    );
    return;
  }

  innings = i;

  if (!innings) {
    showPageError(
      'There is no active innings.'
    );

    setTimeout(() => {
      location.href =
        `manage.html?id=${matchId}`;
    }, 1500);

    return;
  }

  const {
    data: mp,
    error: mpError
  } = await supabase
    .from('match_players')
    .select(`
      team_id,
      players(id,name,role)
    `)
    .eq('match_id', matchId)
    .eq('is_playing_xi', true);

  if (mpError) {
    showPageError(
      'Unable to load Playing XI: ' +
      mpError.message
    );
    return;
  }

  batting = (mp || [])
    .filter(
      x =>
        x.team_id ===
        innings.batting_team_id
    )
    .map(x => x.players)
    .filter(Boolean);

  bowling = (mp || [])
    .filter(
      x =>
        x.team_id ===
        innings.bowling_team_id
    )
    .map(x => x.players)
    .filter(Boolean);

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

/* =========================================================
   REBUILD PLAYER STATE
========================================================= */

async function rebuildState() {

  if (
    innings.striker_id ||
    innings.non_striker_id ||
    innings.bowler_id
  ) {

    state = {
      striker:
        innings.striker_id || null,

      non:
        innings.non_striker_id || null,

      bowler:
        innings.bowler_id || null
    };

    return;
  }

  const d = await deliveries();

  if (!d.length) {

    state = {
      striker: null,
      non: null,
      bowler: null
    };

    return;
  }

  const last =
    d[d.length - 1];

  state = {
    striker:
      last.striker_id || null,

    non:
      last.non_striker_id || null,

    bowler:
      last.bowler_id || null
  };

  const runningRuns =
    Number(last.batsman_runs || 0) +
    Number(last.extras_byes || 0) +
    Number(last.extras_legbyes || 0);

  if (runningRuns % 2 !== 0) {
    [state.striker, state.non] =
      [state.non, state.striker];
  }

  if (last.wicket) {

    if (
      last.dismissed_player_id ===
      state.striker
    ) {
      state.striker = null;
    }

    if (
      last.dismissed_player_id ===
      state.non
    ) {
      state.non = null;
    }
  }

  const legalBalls =
    d.filter(x => x.legal_ball).length;

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

/* =========================================================
   PLAYER OPTIONS
========================================================= */

function opts(players) {

  return `
    <option value="">Select player</option>

    ${players.map(player => `
      <option value="${player.id}">
        ${esc(player.name)}
        ${player.role
          ? ` (${esc(player.role)})`
          : ''}
      </option>
    `).join('')}
  `;
}

/* =========================================================
   FILL SELECTS
========================================================= */

function fillSelects() {

  if ($('striker')) {

    $('striker').innerHTML =
      opts(batting);

    $('striker').value =
      state.striker || '';
  }

  if ($('nonStriker')) {

    $('nonStriker').innerHTML =
      opts(batting);

    $('nonStriker').value =
      state.non || '';
  }

  if ($('bowler')) {

    $('bowler').innerHTML =
      opts(bowling);

    $('bowler').value =
      state.bowler || '';
  }
}

/* =========================================================
   SAVE CURRENT STATE
========================================================= */

async function saveCurrentState() {

  if (!innings || !innings.id) {

    alert(
      'ERROR: Active innings ID is missing.'
    );

    return false;
  }

  if (
    !state.striker ||
    !state.non ||
    !state.bowler
  ) {

    return false;
  }

  const bowlerAllowed =
    await checkBowlerRule(
      state.bowler
    );

  if (!bowlerAllowed) {

    alert(
      'INVALID BOWLER\n\n' +
      'The same bowler cannot bowl consecutive overs.\n\n' +
      'Please select a different bowler.'
    );

    return false;
  }

  const {
    data,
    error
  } = await supabase
    .from('innings')
    .update({
      striker_id: state.striker,
      non_striker_id: state.non,
      bowler_id: state.bowler
    })
    .eq('id', innings.id)
    .select(
      'id,striker_id,non_striker_id,bowler_id'
    )
    .single();

  if (error) {

    console.error(
      'SAVE PLAYER ERROR:',
      error
    );

    alert(
      'FAILED TO SAVE PLAYERS\n\n' +
      error.message
    );

    return false;
  }

  innings.striker_id =
    data.striker_id;

  innings.non_striker_id =
    data.non_striker_id;

  innings.bowler_id =
    data.bowler_id;

  state.striker =
    data.striker_id;

  state.non =
    data.non_striker_id;

  state.bowler =
    data.bowler_id;

  return true;
}

/* =========================================================
   REFRESH SCOREBOARD
========================================================= */

async function refresh() {

  if (!innings || !match) return;

  const d =
    await deliveries();

  const c =
    calc(d);

  const rr =
    c.legal
      ? (
          c.runs /
          (c.legal / 6)
        ).toFixed(2)
      : '0.00';

  if ($('score')) {
    $('score').textContent =
      `${c.runs}/${c.wickets}`;
  }

  if ($('rr')) {
    $('rr').textContent = rr;
  }

  if ($('overText')) {

    const maxBalls =
      Number(match.overs) * 6;

    let text =
      `Overs: ${c.overs}`;

    if (c.legal >= maxBalls) {

      text =
        `✓ ${match.overs} Overs Completed`;
    }

    $('overText').textContent =
      text;
  }

  if ($('commentary')) {

    $('commentary').innerHTML =
      d.slice()
        .reverse()
        .map(x => `
          <div class="comment">
            <b>
              ${x.over_number}.${x.ball_number}
            </b>
            —
            ${esc(
              x.commentary ||
              'Ball recorded'
            )}
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

/* =========================================================
   BATTING STATISTICS
========================================================= */

function battingStats(d) {

  $('battingStats').innerHTML =
    batting.map(player => {

      const playerBalls =
        d.filter(
          x =>
            x.striker_id === player.id &&
            x.legal_ball
        ).length;

      const playerRuns =
        d.filter(
          x =>
            x.striker_id === player.id
        ).reduce(
          (sum, x) =>
            sum +
            Number(
              x.batsman_runs || 0
            ),
          0
        );

      const fours =
        d.filter(
          x =>
            x.striker_id === player.id &&
            Number(
              x.batsman_runs || 0
            ) === 4
        ).length;

      const sixes =
        d.filter(
          x =>
            x.striker_id === player.id &&
            Number(
              x.batsman_runs || 0
            ) === 6
        ).length;

      const sr =
        playerBalls
          ? (
              playerRuns *
              100 /
              playerBalls
            ).toFixed(1)
          : '0.0';

      return `
        <div class="item">

          <strong>
            ${esc(player.name)}
            ${state.striker === player.id
              ? ' *'
              : ''}
          </strong>

          <span class="small">
            ${playerRuns} runs ·
            ${playerBalls} balls ·
            ${fours} fours ·
            ${sixes} sixes ·
            SR ${sr}
          </span>

        </div>
      `;

    }).join('');
}

/* =========================================================
   BOWLING STATISTICS
========================================================= */

function bowlingStats(d) {

  $('bowlingStats').innerHTML =
    bowling.map(player => {

      const mine =
        d.filter(
          x =>
            x.bowler_id === player.id
        );

      const legal =
        mine.filter(
          x => x.legal_ball
        ).length;

      const runs =
        mine.reduce(
          (sum, x) =>
            sum +
            Number(
              x.total_runs || 0
            ),
          0
        );

      const economy =
        legal
          ? (
              runs /
              (legal / 6)
            ).toFixed(2)
          : '0.00';

      const wickets =
        mine.filter(
          x =>
            x.wicket &&
            [
              'Bowled',
              'Caught',
              'LBW',
              'Stumped',
              'Hit Wicket'
            ].includes(
              x.dismissal_type
            )
        ).length;

      return `
        <div class="item">

          <strong>
            ${esc(player.name)}
            ${state.bowler === player.id
              ? ' *'
              : ''}
          </strong>

          <span class="small">
            ${Math.floor(legal / 6)}.${legal % 6}
            overs ·
            ${runs} runs ·
            ${wickets} wickets ·
            ECO ${economy}
          </span>

        </div>
      `;

    }).join('');
}

/* =========================================================
   SAVE PLAYERS BUTTON
========================================================= */

if ($('savePlayers')) {

  $('savePlayers').addEventListener(
    'click',
    async () => {

      const striker =
        $('striker')?.value || '';

      const non =
        $('nonStriker')?.value || '';

      const bowler =
        $('bowler')?.value || '';

      if (
        !striker ||
        !non ||
        !bowler
      ) {

        alert(
          'Please select:\n\n' +
          '✓ Striker\n' +
          '✓ Non-striker\n' +
          '✓ Bowler'
        );

        return;
      }

      if (striker === non) {

        alert(
          'Striker and non-striker ' +
          'cannot be the same player.'
        );

        return;
      }

      const bowlerAllowed =
        await checkBowlerRule(
          bowler
        );

      if (!bowlerAllowed) {

        alert(
          'INVALID BOWLER\n\n' +
          'The same bowler cannot bowl consecutive overs.'
        );

        return;
      }

      state = {
        striker,
        non,
        bowler
      };

      const saved =
        await saveCurrentState();

      if (!saved) return;

      fillSelects();

      await refresh();

      alert(
        '✓ PLAYERS SAVED SUCCESSFULLY'
      );
    }
  );
}

/* =========================================================
   RECORD BALL
========================================================= */

async function record(x) {

  if (match.status === 'paused') {

    alert(
      'Match is currently paused.'
    );

    return;
  }

  if (
    !innings ||
    innings.status !== 'live'
  ) {

    alert(
      'There is no active innings.'
    );

    return;
  }

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

  const bowlerAllowed =
    await checkBowlerRule(
      state.bowler
    );

  if (!bowlerAllowed) {

    alert(
      'ILLEGAL BOWLER\n\n' +
      'The same bowler cannot bowl consecutive overs.\n\n' +
      'Select a different bowler.'
    );

    return;
  }

  const existing =
    await deliveries();

  const current =
    calc(existing);

  const maximumBalls =
    Number(match.overs) * 6;

  if (
    current.legal >= maximumBalls
  ) {

    alert(
      `${match.overs} overs are already completed.`
    );

    return;
  }

  const legalBall =
    !x.wide &&
    !x.noBall;

  const totalRuns =
    Number(x.bat || 0) +
    Number(x.wide || 0) +
    Number(x.noBall || 0) +
    Number(x.bye || 0) +
    Number(x.legBye || 0);

  const overNumber =
    Math.floor(
      current.legal / 6
    );

  const ballNumber =
    (current.legal % 6) + 1;

  const row = {

    innings_id: innings.id,

    over_number: overNumber,

    ball_number: ballNumber,

    striker_id:
      state.striker,

    non_striker_id:
      state.non,

    bowler_id:
      state.bowler,

    batsman_runs:
      Number(x.bat || 0),

    extras_wides:
      Number(x.wide || 0),

    extras_noballs:
      Number(x.noBall || 0),

    extras_byes:
      Number(x.bye || 0),

    extras_legbyes:
      Number(x.legBye || 0),

    total_runs:
      totalRuns,

    legal_ball:
      legalBall,

    wicket:
      !!x.wicket,

    dismissal_type:
      x.dismissal || null,

    dismissed_player_id:
      x.dismissed || null,

    fielder_id:
      x.fielder || null,

    commentary:
      x.commentary || ''
  };

  const {
    error
  } =
    await supabase
      .from('deliveries')
      .insert(row);

  if (error) {

    alert(
      'Unable to save ball:\n\n' +
      error.message
    );

    console.error(error);

    return;
  }

  /* RUN STRIKE CHANGE */

  const runningRuns =
    Number(x.bat || 0) +
    Number(x.bye || 0) +
    Number(x.legBye || 0);

  if (runningRuns % 2 !== 0) {

    [state.striker, state.non] =
      [state.non, state.striker];
  }

  /* WICKET */

  if (x.wicket) {

    if (
      state.striker === x.dismissed
    ) {
      state.striker = null;
    }

    if (
      state.non === x.dismissed
    ) {
      state.non = null;
    }
  }

  /* OVER COMPLETE */

  const newLegal =
    current.legal +
    (legalBall ? 1 : 0);

  const overCompleted =
    legalBall &&
    newLegal > 0 &&
    newLegal % 6 === 0;

  if (overCompleted) {

    [state.striker, state.non] =
      [state.non, state.striker];

    state.bowler = null;
  }

  /* SAVE STATE */

  if (
    state.striker &&
    state.non &&
    state.bowler
  ) {

    const stateSaved =
      await saveCurrentState();

    if (!stateSaved) return;

  } else {

    const {
      error: partialStateError
    } =
      await supabase
        .from('innings')
        .update({
          striker_id:
            state.striker || null,

          non_striker_id:
            state.non || null,

          bowler_id:
            state.bowler || null
        })
        .eq('id', innings.id);

    if (partialStateError) {

      alert(
        'Unable to save current player state:\n\n' +
        partialStateError.message
      );

      return;
    }

    innings.striker_id =
      state.striker || null;

    innings.non_striker_id =
      state.non || null;

    innings.bowler_id =
      state.bowler || null;
  }

  fillSelects();

  await refresh();

  const updatedDeliveries =
    await deliveries();

  const score =
    calc(updatedDeliveries);

  /* =====================================================
     SECOND INNINGS
  ===================================================== */

  if (innings.innings_no === 2) {

    const firstRuns =
      await firstScore();

    /* TARGET REACHED */

    if (score.runs > firstRuns) {

      await finishSecond(true);

      return;
    }

    /* 10 WICKETS */

    if (score.wickets >= 10) {

      await finishSecond(false);

      return;
    }

    /* OVERS COMPLETE */

    if (
      score.legal >= maximumBalls
    ) {

      await finishSecond(false);

      return;
    }

    /* NEW BATSMAN */

    if (
      x.wicket &&
      (!state.striker ||
       !state.non)
    ) {

      alert(
        'Wicket recorded.\n\n' +
        'Select the new batsman.'
      );

      return;
    }

    /* NEW BOWLER */

    if (overCompleted) {

      alert(
        `Over ${Math.floor(newLegal / 6)} completed.\n\n` +
        'Select a different bowler.'
      );

      return;
    }

    return;
  }

  /* =====================================================
     FIRST INNINGS
  ===================================================== */

  if (score.wickets >= 10) {

    await oversCompleted(score);

    return;
  }

  if (
    score.legal >= maximumBalls
  ) {

    await oversCompleted(score);

    return;
  }

  if (
    x.wicket &&
    (!state.striker ||
     !state.non)
  ) {

    alert(
      'Wicket recorded.\n\n' +
      'Select the new batsman.'
    );

    return;
  }

  if (overCompleted) {

    alert(
      `Over ${Math.floor(newLegal / 6)} completed.\n\n` +
      'Select a different bowler.'
    );
  }
}

/* =========================================================
   OVERS COMPLETED
========================================================= */

async function oversCompleted(score) {

  if (innings.innings_no === 1) {

    await completeFirstInnings(score);

    return;
  }

  if (innings.innings_no === 2) {

    await finishSecond(false);
  }
}

/* =========================================================
   COMPLETE FIRST INNINGS
========================================================= */

async function completeFirstInnings(score) {

  const target =
    score.runs + 1;

  const {
    error: firstError
  } =
    await supabase
      .from('innings')
      .update({
        status: 'completed'
      })
      .eq('id', innings.id);

  if (firstError) {

    alert(firstError.message);

    return;
  }

  const {
    data: existingSecond,
    error: checkError
  } =
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

  if (!existingSecond) {

    const {
      error: secondError
    } =
      await supabase
        .from('innings')
        .insert({

          match_id:
            matchId,

          innings_no:
            2,

          batting_team_id:
            innings.bowling_team_id,

          bowling_team_id:
            innings.batting_team_id,

          target,

          status:
            'live',

          striker_id:
            null,

          non_striker_id:
            null,

          bowler_id:
            null
        });

    if (secondError) {

      alert(secondError.message);

      return;
    }

  } else {

    const {
      error: activateError
    } =
      await supabase
        .from('innings')
        .update({

          status: 'live',

          target,

          striker_id: null,

          non_striker_id: null,

          bowler_id: null

        })
        .eq(
          'id',
          existingSecond.id
        );

    if (activateError) {

      alert(
        activateError.message
      );

      return;
    }
  }

  const {
    error: matchError
  } =
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

  location.href =
    `scorer.html?id=${matchId}`;
}

/* =========================================================
   FIRST INNINGS SCORE
========================================================= */

async function firstScore() {

  const {
    data: firstInnings,
    error
  } =
    await supabase
      .from('innings')
      .select('id')
      .eq('match_id', matchId)
      .eq('innings_no', 1)
      .maybeSingle();

  if (error || !firstInnings) {
    return 0;
  }

  const {
    data
  } =
    await supabase
      .from('deliveries')
      .select('total_runs')
      .eq(
        'innings_id',
        firstInnings.id
      );

  return (data || []).reduce(
    (sum, ball) =>
      sum +
      Number(
        ball.total_runs || 0
      ),
    0
  );
}

/* =========================================================
   FINISH SECOND INNINGS
========================================================= */

async function finishSecond(
  targetReached = false
) {

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

  if (score.runs > firstRuns) {

    winnerTeamId =
      battingTeam;

    const wicketsRemaining =
      Math.max(
        0,
        10 - score.wickets
      );

    resultText =
      `${battingName} won by ` +
      `${wicketsRemaining} wicket(s)`;

  } else if (
    score.runs < firstRuns
  ) {

    winnerTeamId =
      bowlingTeam;

    resultText =
      `${bowlingName} won by ` +
      `${firstRuns - score.runs} run(s)`;

  } else {

    resultText =
      'Match tied';
  }

  const {
    error: inningsError
  } =
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

  const updateData = {

    status: 'completed',

    winner_team_id:
      winnerTeamId,

    result_text:
      resultText,

    completed_at:
      new Date().toISOString()
  };

  const {
    error: matchError
  } =
    await supabase
      .from('matches')
      .update(updateData)
      .eq('id', matchId);

  if (matchError) {

    alert(matchError.message);

    return;
  }

  match.status =
    'completed';

  alert(
    targetReached
      ? `TARGET REACHED!\n\n${resultText}`
      : `MATCH COMPLETED!\n\n${resultText}`
  );

  location.href =
    `match.html?id=${matchId}`;
}

/* =========================================================
   UNDO LAST BALL
========================================================= */

async function undoLastBall() {

  if (!innings) {

    alert(
      'There is no active innings.'
    );

    return;
  }

  if (match.status === 'paused') {

    alert(
      'Resume the match before using UNDO.'
    );

    return;
  }

  const d =
    await deliveries();

  if (!d.length) {

    alert(
      'There is no ball to undo.'
    );

    return;
  }

  const lastBall =
    d[d.length - 1];

  const confirmed =
    confirm(
      'UNDO LAST BALL?\n\n' +
      `Ball: ${lastBall.over_number}.${lastBall.ball_number}\n` +
      `Runs: ${lastBall.total_runs || 0}\n` +
      `${lastBall.wicket ? 'WICKET\n' : ''}\n` +
      'This ball will be permanently deleted.'
    );

  if (!confirmed) return;

  const {
    error
  } =
    await supabase
      .from('deliveries')
      .delete()
      .eq('id', lastBall.id);

  if (error) {

    alert(
      'Unable to undo ball:\n\n' +
      error.message
    );

    return;
  }

  /* REBUILD STATE FROM REMAINING BALLS */

  const remaining =
    await deliveries();

  if (!remaining.length) {

    state = {
      striker: null,
      non: null,
      bowler: null
    };

  } else {

    let rebuilt = {
      striker: null,
      non: null,
      bowler: null
    };

    for (
      let i = 0;
      i < remaining.length;
      i++
    ) {

      const ball =
        remaining[i];

      rebuilt.striker =
        ball.striker_id || null;

      rebuilt.non =
        ball.non_striker_id || null;

      rebuilt.bowler =
        ball.bowler_id || null;

      const runningRuns =
        Number(
          ball.batsman_runs || 0
        ) +
        Number(
          ball.extras_byes || 0
        ) +
        Number(
          ball.extras_legbyes || 0
        );

      if (
        runningRuns % 2 !== 0
      ) {

        [
          rebuilt.striker,
          rebuilt.non
        ] =
        [
          rebuilt.non,
          rebuilt.striker
        ];
      }

      if (ball.wicket) {

        if (
          rebuilt.striker ===
          ball.dismissed_player_id
        ) {

          rebuilt.striker = null;
        }

        if (
          rebuilt.non ===
          ball.dismissed_player_id
        ) {

          rebuilt.non = null;
        }
      }

      const legalCount =
        remaining
          .slice(0, i + 1)
          .filter(
            x => x.legal_ball
          ).length;

      if (
        ball.legal_ball &&
        legalCount > 0 &&
        legalCount % 6 === 0
      ) {

        [
          rebuilt.striker,
          rebuilt.non
        ] =
        [
          rebuilt.non,
          rebuilt.striker
        ];

        rebuilt.bowler = null;
      }
    }

    state = rebuilt;
  }

  const {
    error: stateError
  } =
    await supabase
      .from('innings')
      .update({

        striker_id:
          state.striker || null,

        non_striker_id:
          state.non || null,

        bowler_id:
          state.bowler || null
      })
      .eq('id', innings.id);

  if (stateError) {

    alert(
      'Ball deleted, but player state could not be restored:\n\n' +
      stateError.message
    );

    return;
  }

  innings.striker_id =
    state.striker;

  innings.non_striker_id =
    state.non;

  innings.bowler_id =
    state.bowler;

  fillSelects();

  await refresh();

  alert(
    '✓ LAST BALL UNDONE SUCCESSFULLY'
  );
}

/* =========================================================
   UNDO BUTTON
========================================================= */

if ($('undo')) {

  $('undo').onclick =
    async () => {

      await undoLastBall();

    };
}

/* =========================================================
   END INNINGS
========================================================= */

async function endCurrentInnings() {

  if (!innings) {

    alert(
      'There is no active innings.'
    );

    return;
  }

  const d =
    await deliveries();

  const score =
    calc(d);

  const confirmed =
    confirm(
      `END INNINGS?\n\n` +
      `Current Score: ${score.runs}/${score.wickets}\n` +
      `Overs: ${score.overs}\n\n` +
      `Do you want to end this innings?`
    );

  if (!confirmed) return;

  if (
    innings.innings_no === 1
  ) {

    await completeFirstInnings(
      score
    );

    return;
  }

  if (
    innings.innings_no === 2
  ) {

    await finishSecond(false);

    return;
  }
}

/* =========================================================
   END INNINGS BUTTON
========================================================= */

if ($('endInnings')) {

  $('endInnings').onclick =
    async () => {

      await endCurrentInnings();

    };
}

/* =========================================================
   END MATCH
========================================================= */

async function endMatchManually() {

  if (!innings) {

    alert(
      'There is no active innings.'
    );

    return;
  }

  const d =
    await deliveries();

  const score =
    calc(d);

  const confirmed =
    confirm(
      `END MATCH NOW?\n\n` +
      `Current Innings: ${innings.innings_no}\n` +
      `Score: ${score.runs}/${score.wickets}\n` +
      `Overs: ${score.overs}\n\n` +
      `This will mark the match as COMPLETED.\n\n` +
      `Continue?`
    );

  if (!confirmed) return;

  /* =====================================================
     IF SECOND INNINGS
  ===================================================== */

  if (
    innings.innings_no === 2
  ) {

    await finishSecond(false);

    return;
  }

  /* =====================================================
     IF FIRST INNINGS
  ===================================================== */

  const {
    error: inningsError
  } =
    await supabase
      .from('innings')
      .update({
        status: 'completed'
      })
      .eq('id', innings.id);

  if (inningsError) {

    alert(
      'Unable to end innings:\n\n' +
      inningsError.message
    );

    return;
  }

  const {
    error: matchError
  } =
    await supabase
      .from('matches')
      .update({

        status: 'completed',

        winner_team_id: null,

        result_text:
          'Match ended manually — No result',

        completed_at:
          new Date().toISOString()

      })
      .eq('id', matchId);

  if (matchError) {

    alert(
      'Unable to end match:\n\n' +
      matchError.message
    );

    return;
  }

  alert(
    '✓ MATCH ENDED\n\n' +
    'Result: No result'
  );

  location.href =
    `match.html?id=${matchId}`;
}

/* =========================================================
   END MATCH BUTTON
========================================================= */

if ($('endMatch')) {

  $('endMatch').onclick =
    async () => {

      await endMatchManually();

    };
}

/* =========================================================
   RUN BUTTONS
========================================================= */

document
  .querySelectorAll('[data-run]')
  .forEach(button => {

    button.onclick =
      () => {

        const runs =
          Number(
            button.dataset.run
          );

        record({

          bat: runs,

          commentary:
            runs === 0
              ? 'Dot ball'
              : `${runs} run(s)`
        });
      };
  });

/* =========================================================
   WIDE
========================================================= */

if ($('wide')) {

  $('wide').onclick =
    () => {

      const runs =
        Number(
          prompt(
            'Enter total wide runs',
            '1'
          )
        );

      if (
        !Number.isFinite(runs) ||
        runs < 1
      ) {

        alert(
          'Invalid wide runs.'
        );

        return;
      }

      record({

        wide: runs,

        commentary:
          `${runs} wide run(s)`
      });
    };
}

/* =========================================================
   NO BALL
========================================================= */

if ($('noBall')) {

  $('noBall').onclick =
    () => {

      const batRuns =
        Number(
          prompt(
            'Bat runs from this no-ball',
            '0'
          )
        );

      if (
        !Number.isFinite(batRuns) ||
        batRuns < 0
      ) {

        alert(
          'Invalid runs.'
        );

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

/* =========================================================
   BYE
========================================================= */

if ($('bye')) {

  $('bye').onclick =
    () => {

      const runs =
        Number(
          prompt(
            'Enter bye runs',
            '1'
          )
        );

      if (
        !Number.isFinite(runs) ||
        runs < 1
      ) {

        alert(
          'Invalid bye runs.'
        );

        return;
      }

      record({

        bye: runs,

        commentary:
          `${runs} bye run(s)`
      });
    };
}

/* =========================================================
   LEG BYE
========================================================= */

if ($('legBye')) {

  $('legBye').onclick =
    () => {

      const runs =
        Number(
          prompt(
            'Enter leg-bye runs',
            '1'
          )
        );

      if (
        !Number.isFinite(runs) ||
        runs < 1
      ) {

        alert(
          'Invalid leg-bye runs.'
        );

        return;
      }

      record({

        legBye: runs,

        commentary:
          `${runs} leg-bye run(s)`
      });
    };
}

/* =========================================================
   WICKET MODAL
========================================================= */

function openWicketModal() {

  if (
    !state.striker &&
    !state.non
  ) {

    alert(
      'No batsman is currently selected.'
    );

    return;
  }

  const striker =
    batting.find(
      p =>
        p.id === state.striker
    );

  const nonStriker =
    batting.find(
      p =>
        p.id === state.non
    );

  const modal =
    $('modal');

  const body =
    $('modalBody');

  if (!modal || !body) return;

  body.innerHTML = `

    <div class="wicket-section">

      <h3>
        Who was dismissed?
      </h3>

      <label class="wicket-option">

        <input
          type="radio"
          name="dismissedPlayer"
          value="${striker?.id || ''}"
        >

        <span>

          <strong>
            ${esc(
              striker?.name ||
              'Striker'
            )}
          </strong>

          <small>
            Striker
          </small>

        </span>

      </label>

      <label class="wicket-option">

        <input
          type="radio"
          name="dismissedPlayer"
          value="${nonStriker?.id || ''}"
        >

        <span>

          <strong>
            ${esc(
              nonStriker?.name ||
              'Non-striker'
            )}
          </strong>

          <small>
            Non-striker
          </small>

        </span>

      </label>

    </div>

    <div class="wicket-section">

      <h3>
        Dismissal type
      </h3>

      <select id="dismissalType">

        <option value="Bowled">
          Bowled
        </option>

        <option value="Caught">
          Caught
        </option>

        <option value="LBW">
          LBW
        </option>

        <option value="Stumped">
          Stumped
        </option>

        <option value="Run Out">
          Run Out
        </option>

        <option value="Hit Wicket">
          Hit Wicket
        </option>

        <option value="Obstructing the Field">
          Obstructing the Field
        </option>

        <option value="Hit the Ball Twice">
          Hit the Ball Twice
        </option>

        <option value="Retired Out">
          Retired Out
        </option>

      </select>

    </div>
  `;

  modal.classList.remove(
    'hidden'
  );
}

/* =========================================================
   CLOSE WICKET MODAL
========================================================= */

function closeWicketModal() {

  const modal =
    $('modal');

  if (modal) {

    modal.classList.add(
      'hidden'
    );
  }
}

/* =========================================================
   WICKET BUTTON
========================================================= */

if ($('wicket')) {

  $('wicket').onclick =
    () => {

      openWicketModal();

    };
}

/* =========================================================
   WICKET CONFIRM
========================================================= */

if ($('modalConfirm')) {

  $('modalConfirm').onclick =
    async () => {

      const selected =
        document.querySelector(
          'input[name="dismissedPlayer"]:checked'
        );

      if (
        !selected ||
        !selected.value
      ) {

        alert(
          'Please select the dismissed batsman.'
        );

        return;
      }

      const dismissal =
        $('dismissalType')?.value ||
        'Bowled';

      const dismissedId =
        selected.value;

      const dismissedPlayer =
        batting.find(
          p =>
            p.id === dismissedId
        );

      closeWicketModal();

      await record({

        wicket: true,

        dismissed:
          dismissedId,

        dismissal,

        commentary:
          `Wicket — ` +
          `${dismissedPlayer?.name || 'Batsman'} ` +
          `(${dismissal})`
      });
    };
}

/* =========================================================
   WICKET CANCEL
========================================================= */

if ($('modalCancel')) {

  $('modalCancel').onclick =
    () => {

      closeWicketModal();

    };
}

/* =========================================================
   CLICK OUTSIDE MODAL
========================================================= */

if ($('modal')) {

  $('modal').addEventListener(
    'click',
    event => {

      if (
        event.target ===
        $('modal')
      ) {

        closeWicketModal();
      }
    }
  );
}

/* =========================================================
   PAUSE MATCH
========================================================= */

if ($('pauseMatch')) {

  $('pauseMatch').onclick =
    async () => {

      const confirmed =
        confirm(
          'Pause this match?'
        );

      if (!confirmed) return;

      const {
        error
      } =
        await supabase
          .from('matches')
          .update({
            status: 'paused'
          })
          .eq('id', matchId);

      if (error) {

        alert(
          'Unable to pause match:\n\n' +
          error.message
        );

        return;
      }

      match.status =
        'paused';

      alert(
        '✓ Match paused.'
      );

      await refresh();
    };
}

/* =========================================================
   RESUME MATCH
========================================================= */

if ($('resumeMatch')) {

  $('resumeMatch').onclick =
    async () => {

      const {
        error
      } =
        await supabase
          .from('matches')
          .update({
            status: 'live'
          })
          .eq('id', matchId);

      if (error) {

        alert(
          'Unable to resume match:\n\n' +
          error.message
        );

        return;
      }

      match.status =
        'live';

      alert(
        '✓ Match resumed.'
      );

      await refresh();
    };
}

/* =========================================================
   INITIALIZE
========================================================= */

(async function init() {

  const authenticated =
    await ensureAuth();

  if (!authenticated) return;

  await load();

})();
