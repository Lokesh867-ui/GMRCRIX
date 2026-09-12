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

  const { data, error } =
    await supabase
      .from('deliveries')
      .select('*')
      .eq('innings_id', innings.id)
      .order('created_at', {
        ascending: true
      });

  if (error) {

    console.error(
      'Unable to load deliveries:',
      error
    );

    return [];
  }

  return data || [];
}


/* =========================
   CALCULATE SCORE
========================= */

function calc(d) {

  const runs =
    d.reduce(
      (sum, ball) =>
        sum + Number(ball.total_runs || 0),
      0
    );

  const wickets =
    d.filter(
      ball => ball.wicket
    ).length;

  const legal =
    d.filter(
      ball => ball.legal_ball
    ).length;

  return {

    runs,

    wickets,

    legal,

    overs:
      `${Math.floor(legal / 6)}.${legal % 6}`
  };
}


/* =========================
   LOAD MATCH
========================= */

async function load() {

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

  if (error) {

    alert(
      'Unable to load match: ' +
      error.message
    );

    return;
  }

  match = m;


  /*
    Find live innings.
  */

  const {
    data: i,
    error: inningsError
  } =
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

    alert(
      'Unable to load innings: ' +
      inningsError.message
    );

    return;
  }


  innings = i;


  if (!innings) {

    alert(
      'There is no active innings.'
    );

    location.href =
      `manage.html?id=${matchId}`;

    return;
  }


  /*
    Load Playing XI.
  */

  const {
    data: mp,
    error: mpError
  } =
    await supabase
      .from('match_players')
      .select(`
        team_id,
        players(id,name,role)
      `)
      .eq('match_id', matchId)
      .eq('is_playing_xi', true);

  if (mpError) {

    alert(
      'Unable to load Playing XI: ' +
      mpError.message
    );

    return;
  }


  batting =
    (mp || [])
      .filter(
        x =>
          x.team_id ===
          innings.batting_team_id
      )
      .map(
        x => x.players
      )
      .filter(Boolean);


  bowling =
    (mp || [])
      .filter(
        x =>
          x.team_id ===
          innings.bowling_team_id
      )
      .map(
        x => x.players
      )
      .filter(Boolean);


  /*
    Page information.
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


  /*
    Restore saved current players.
  */

  await rebuildState();

  fillSelects();

  await refresh();
}


/* =========================
   REBUILD CURRENT STATE
========================= */

async function rebuildState() {

  /*
    FIRST PRIORITY:

    Use the persistent state stored
    in the innings table.
  */

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


  /*
    BACKWARD COMPATIBILITY:

    If old innings does not contain
    saved player state, rebuild from
    deliveries.
  */

  const d =
    await deliveries();


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


  /*
    Running runs can change strike.

    Batsman runs,
    byes and leg-byes
    are running runs.

    Wide and no-ball extras
    are not included here.
  */

  const runningRuns =
    Number(last.batsman_runs || 0) +
    Number(last.extras_byes || 0) +
    Number(last.extras_legbyes || 0);


  if (runningRuns % 2 !== 0) {

    [
      state.striker,
      state.non
    ] = [
      state.non,
      state.striker
    ];
  }


  /*
    Wicket.

    Remove dismissed player from
    current state.
  */

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


  /*
    End of over.

    Strike changes and bowler
    must be selected again.
  */

  const legalBalls =
    d.filter(
      x => x.legal_ball
    ).length;


  if (
    legalBalls > 0 &&
    legalBalls % 6 === 0 &&
    last.legal_ball
  ) {

    [
      state.striker,
      state.non
    ] = [
      state.non,
      state.striker
    ];

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

    ${
      players
        .map(player => `
          <option value="${player.id}">
            ${esc(player.name)}
            ${player.role
              ? ` (${esc(player.role)})`
              : ''}
          </option>
        `)
        .join('')
    }
  `;
}


/* =========================
   FILL PLAYER SELECTS
========================= */

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


/* =========================
   SAVE CURRENT PLAYER STATE
========================= */

async function saveCurrentState() {

  const {
    error
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
      .eq(
        'id',
        innings.id
      );


  if (error) {

    console.error(
      'Unable to save current player state:',
      error
    );

    alert(
      'Score saved, but current player state could not be saved.'
    );

    return false;
  }


  /*
    Keep local innings object
    synchronized.
  */

  innings.striker_id =
    state.striker || null;

  innings.non_striker_id =
    state.non || null;

  innings.bowler_id =
    state.bowler || null;


  return true;
}


/* =========================
   REFRESH SCOREBOARD
========================= */

async function refresh() {

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

    $('rr').textContent =
      rr;
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


  /*
    Commentary.
  */

  if ($('commentary')) {

    $('commentary').innerHTML =
      d
        .slice()
        .reverse()
        .map(x => `
          <div class="comment">

            <b>
              ${x.over_number}.${x.ball_number}
            </b>

            — ${esc(
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


/* =========================
   BATTING STATISTICS
========================= */

function battingStats(d) {

  $('battingStats').innerHTML =

    batting
      .map(player => {

        const playerBalls =
          d.filter(
            x =>
              x.striker_id === player.id &&
              x.legal_ball
          ).length;


        const playerRuns =
          d
            .filter(
              x =>
                x.striker_id === player.id
            )
            .reduce(
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
              Number(x.batsman_runs || 0) === 4
          ).length;


        const sixes =
          d.filter(
            x =>
              x.striker_id === player.id &&
              Number(x.batsman_runs || 0) === 6
          ).length;


        const sr =
          playerBalls
            ? (
                (playerRuns * 100) /
                playerBalls
              ).toFixed(1)
            : '0.0';


        return `
          <div class="item">

            <strong>

              ${esc(player.name)}

              ${
                state.striker === player.id
                  ? '*'
                  : ''
              }

            </strong>

            <span class="small">

              ${playerRuns} runs

              · ${playerBalls} balls

              · ${fours} fours

              · ${sixes} sixes

              · SR ${sr}

            </span>

          </div>
        `;

      })
      .join('');
}


/* =========================
   BOWLING STATISTICS
========================= */

function bowlingStats(d) {

  $('bowlingStats').innerHTML =

    bowling
      .map(player => {

        const mine =
          d.filter(
            x =>
              x.bowler_id === player.id
          );


        const legal =
          mine.filter(
            x =>
              x.legal_ball
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

              ${
                state.bowler === player.id
                  ? '*'
                  : ''
              }

            </strong>

            <span class="small">

              ${Math.floor(legal / 6)}.${legal % 6}
              overs

              · ${runs} runs

              · ${wickets} wickets

              · ECO ${economy}

            </span>

          </div>
        `;

      })
      .join('');
}


/* =========================
   SAVE PLAYERS BUTTON
========================= */

if ($('savePlayers')) {

  $('savePlayers').onclick =
    async () => {

      const striker =
        $('striker')
          ? $('striker').value
          : '';

      const non =
        $('nonStriker')
          ? $('nonStriker').value
          : '';

      const bowler =
        $('bowler')
          ? $('bowler').value
          : '';


      if (
        !striker ||
        !non ||
        !bowler
      ) {

        alert(
          'Select striker, non-striker and bowler.'
        );

        return;
      }


      if (striker === non) {

        alert(
          'Striker and non-striker cannot be the same.'
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


      if (!saved) {
        return;
      }


      fillSelects();

      await refresh();


      alert(
        'Players saved successfully.'
      );
    };
}


/* =========================
   RECORD BALL
========================= */

async function record(x) {

  /*
    Match paused.
  */

  if (match.status === 'paused') {

    alert(
      'Match is currently paused.'
    );

    return;
  }


  /*
    Active innings check.
  */

  if (
    !innings ||
    innings.status !== 'live'
  ) {

    alert(
      'There is no active innings.'
    );

    return;
  }


  /*
    Player check.
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


  /*
    Existing deliveries.
  */

  const existing =
    await deliveries();

  const current =
    calc(existing);


  const maximumBalls =
    Number(match.overs) * 6;


  /*
    Maximum overs already reached.
  */

  if (
    current.legal >=
    maximumBalls
  ) {

    alert(
      `${match.overs} overs are already completed.`
    );

    return;
  }


  /*
    Wide and no-ball
    are not legal balls.
  */

  const legalBall =
    !x.wide &&
    !x.noBall;


  /*
    Total runs.
  */

  const totalRuns =
    Number(x.bat || 0) +
    Number(x.wide || 0) +
    Number(x.noBall || 0) +
    Number(x.bye || 0) +
    Number(x.legBye || 0);


  /*
    Current over.
  */

  const overNumber =
    Math.floor(
      current.legal / 6
    );


  /*
    Current ball number.

    Illegal deliveries do not
    increase legal ball count.
  */

  const ballNumber =
    (current.legal % 6) + 1;


  /*
    Save the player IDs that
    actually faced this delivery.
  */

  const deliveryStriker =
    state.striker;

  const deliveryNon =
    state.non;

  const deliveryBowler =
    state.bowler;


  const row = {

    innings_id:
      innings.id,

    over_number:
      overNumber,

    ball_number:
      ballNumber,

    striker_id:
      deliveryStriker,

    non_striker_id:
      deliveryNon,

    bowler_id:
      deliveryBowler,

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


  /*
    Insert delivery.
  */

  const {
    error
  } =
    await supabase
      .from('deliveries')
      .insert(row);


  if (error) {

    alert(
      'Unable to save ball: ' +
      error.message
    );

    return;
  }


  /*
    =========================
    UPDATE PLAYER STATE
    =========================
  */


  /*
    Running runs.

    Batsman runs,
    byes and leg-byes
    change strike when odd.
  */

  const runningRuns =
    Number(x.bat || 0) +
    Number(x.bye || 0) +
    Number(x.legBye || 0);


  if (
    runningRuns % 2 !== 0
  ) {

    [
      state.striker,
      state.non
    ] = [
      state.non,
      state.striker
    ];
  }


  /*
    Wicket.

    Remove dismissed player
    from current state.

    This also works if strike
    changed because of an odd run.
  */

  if (x.wicket) {

    if (
      state.striker ===
      x.dismissed
    ) {

      state.striker = null;
    }


    if (
      state.non ===
      x.dismissed
    ) {

      state.non = null;
    }
  }


  /*
    Legal ball count after
    inserting the new delivery.
  */

  const newLegal =
    current.legal +
    (legalBall ? 1 : 0);


  /*
    End of over.

    Only a legal sixth ball
    completes the over.
  */

  const overCompleted =
    legalBall &&
    newLegal > 0 &&
    newLegal % 6 === 0;


  if (overCompleted) {

    [
      state.striker,
      state.non
    ] = [
      state.non,
      state.striker
    ];


    /*
      New bowler must be selected.
    */

    state.bowler = null;
  }


  /*
    Save the NEW state.

    This is the important part:
    save AFTER strike/wicket/over
    calculations.
  */

  const stateSaved =
    await saveCurrentState();


  if (!stateSaved) {
    return;
  }


  fillSelects();

  await refresh();


  /*
    Get updated score.
  */

  const updatedDeliveries =
    await deliveries();

  const score =
    calc(updatedDeliveries);


  /*
    =========================
    SECOND INNINGS
    =========================
  */

  if (
    innings.innings_no === 2
  ) {

    const firstRuns =
      await firstScore();


    /*
      Target reached.
    */

    if (
      score.runs >
      firstRuns
    ) {

      await finishSecond(true);

      return;
    }


    /*
      All wickets lost.
    */

    if (
      score.wickets >= 10
    ) {

      await finishSecond(false);

      return;
    }


    /*
      Overs completed.
    */

    if (
      score.legal >=
      maximumBalls
    ) {

      await finishSecond(false);

      return;
    }


    /*
      Need new batsman after wicket.
    */

    if (
      x.wicket &&
      (
        !state.striker ||
        !state.non
      )
    ) {

      alert(
        'Wicket! Select the new batsman.'
      );

      return;
    }


    /*
      New bowler after over.
    */

    if (overCompleted) {

      alert(
        `Over ${Math.floor(newLegal / 6)} completed. Select a new bowler.`
      );

      return;
    }


    return;
  }


  /*
    =========================
    FIRST INNINGS
    =========================
  */


  /*
    All wickets lost.
  */

  if (
    score.wickets >= 10
  ) {

    await oversCompleted(score);

    return;
  }


  /*
    Maximum overs completed.
  */

  if (
    score.legal >=
    maximumBalls
  ) {

    await oversCompleted(score);

    return;
  }


  /*
    New batsman after wicket.
  */

  if (
    x.wicket &&
    (
      !state.striker ||
      !state.non
    )
  ) {

    alert(
      'Wicket! Select the new batsman.'
    );

    return;
  }


  /*
    New bowler after over.
  */

  if (overCompleted) {

    alert(
      `Over ${Math.floor(newLegal / 6)} completed. Select a new bowler.`
    );

    return;
  }
}


/* =========================
   OVERS COMPLETED
========================= */
async function oversCompleted(score) {

  /*
    First innings.
  */

  if (
    innings.innings_no === 1
  ) {

    await completeFirstInnings(
      score
    );

    return;
  }


  /*
    Second innings.
  */

  if (
    innings.innings_no === 2
  ) {

    await finishSecond(false);

    return;
  }
}


/* =========================
   COMPLETE FIRST INNINGS
========================= */

async function completeFirstInnings(score) {

  const target =
    score.runs + 1;


  /*
    Complete innings 1.
  */

  const {
    error: firstError
  } =
    await supabase
      .from('innings')
      .update({

        status: 'completed'

      })
      .eq(
        'id',
        innings.id
      );


  if (firstError) {

    alert(
      firstError.message
    );

    return;
  }


  /*
    Check whether innings 2
    already exists.
  */

  const {
    data: existingSecond,
    error: checkError
  } =
    await supabase
      .from('innings')
      .select('*')
      .eq(
        'match_id',
        matchId
      )
      .eq(
        'innings_no',
        2
      )
      .maybeSingle();


  if (checkError) {

    alert(
      checkError.message
    );

    return;
  }


  /*
    Create innings 2.
  */

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

          target:
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

      alert(
        secondError.message
      );

      return;
    }

  } else {

    /*
      Activate existing innings 2.
    */

    const {
      error: activateError
    } =
      await supabase
        .from('innings')
        .update({

          status:
            'live',

          target:
            target,

          striker_id:
            null,

          non_striker_id:
            null,

          bowler_id:
            null

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


  /*
    Update match.
  */

  const {
    error: matchError
  } =
    await supabase
      .from('matches')
      .update({

        status:
          'live',

        current_innings:
          2

      })
      .eq(
        'id',
        matchId
      );


  if (matchError) {

    alert(
      matchError.message
    );

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

    load() will find innings 2.
  */

  location.href =
    `scorer.html?id=${matchId}`;
}


/* =========================
   FIRST INNINGS SCORE
========================= */

async function firstScore() {

  const {
    data: firstInnings,
    error
  } =
    await supabase
      .from('innings')
      .select('id')
      .eq(
        'match_id',
        matchId
      )
      .eq(
        'innings_no',
        1
      )
      .maybeSingle();


  if (
    error ||
    !firstInnings
  ) {

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


  return (
    data || []
  ).reduce(
    (sum, ball) =>
      sum +
      Number(
        ball.total_runs || 0
      ),
    0
  );
}


/* =========================
   FINISH SECOND INNINGS
========================= */

async function finishSecond(
  targetReached = false
) {

  if (!innings) {
    return;
  }


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
    battingTeam ===
    match.team_a.id

      ? match.team_a.name
      : match.team_b.name;


  const bowlingName =
    bowlingTeam ===
    match.team_a.id

      ? match.team_a.name
      : match.team_b.name;


  let winnerTeamId =
    null;

  let resultText =
    '';


  /*
    CHASING TEAM WINS.
  */

  if (
    score.runs >
    firstRuns
  ) {

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
  }


  /*
    FIRST BATTING TEAM WINS.
  */

  else if (
    score.runs <
    firstRuns
  ) {

    winnerTeamId =
      bowlingTeam;


    resultText =
      `${bowlingName} won by ` +
      `${firstRuns - score.runs} run(s)`;
  }


  /*
    TIE.
  */

  else {

    resultText =
      'Match tied';
  }


  /*
    Complete innings 2.
  */

  const {
    error: inningsError
  } =
    await supabase
      .from('innings')
      .update({

        status:
          'completed'

      })
      .eq(
        'id',
        innings.id
      );


  if (inningsError) {

    alert(
      inningsError.message
    );

    return;
  }


  /*
    Complete match.
  */

  const updateData = {

    status:
      'completed',

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
      .eq(
        'id',
        matchId
      );


  if (matchError) {

    alert(
      matchError.message
    );

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


/* =========================
   RUN BUTTONS
========================= */
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

          bat:
            runs,

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

        wide:
          runs,

        commentary:
          `${runs} wide run(s)`
      });
    };
}


/* =========================
   NO BALL
========================= */

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
        !Number.isFinite(
          batRuns
        ) ||
        batRuns < 0
      ) {

        alert(
          'Invalid runs.'
        );

        return;
      }


      record({

        noBall:
          1,

        bat:
          batRuns,

        commentary:
          `No ball + ${batRuns} bat run(s)`
      });
    };
}


/* =========================
   BYE
========================= */

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

        bye:
          runs,

        commentary:
          `${runs} bye run(s)`
      });
    };
}


/* =========================
   LEG BYE
========================= */

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

        legBye:
          runs,

        commentary:
          `${runs} leg-bye run(s)`
      });
    };
}


/* =========================
   WICKET
========================= */

if ($('wicket')) {

  $('wicket').onclick =
    () => {

      if (
        !state.striker &&
        !state.non
      ) {

        alert(
          'No batsman is currently selected.'
        );

        return;
      }


      const dismissed =
        prompt(
          'Enter dismissed player ID:\n\n' +
          'Use the player currently selected as striker or non-striker.'
        );


      if (!dismissed) {
        return;
      }


      let dismissal =
        prompt(
          'Dismissal type\n\n' +
          'Examples:\n' +
          'Bowled\n' +
          'Caught\n' +
          'LBW\n' +
          'Stumped\n' +
          'Run Out\n' +
          'Hit Wicket',
          'Bowled'
        );


      if (!dismissal) {

        dismissal =
          'Bowled';
      }


      record({

        wicket:
          true,

        dismissed:
          dismissed,

        dismissal:
          dismissal,

        commentary:
          `Wicket — ${dismissal}`
      });
    };
}


/* =========================
   PAUSE
========================= */

if ($('pauseMatch')) {

  $('pauseMatch').onclick =
    async () => {

      const {
        error
      } =
        await supabase
          .from('matches')
          .update({

            status:
              'paused'

          })
          .eq(
            'id',
            matchId
          );


      if (error) {

        alert(
          error.message
        );

        return;
      }


      match.status =
        'paused';


      alert(
        'Match paused.'
      );

      await refresh();
    };
}


/* =========================
   RESUME
========================= */

if ($('resumeMatch')) {

  $('resumeMatch').onclick =
    async () => {

      const {
        error
      } =
        await supabase
          .from('matches')
          .update({

            status:
              'live'

          })
          .eq(
            'id',
            matchId
          );


      if (error) {

        alert(
          error.message
        );

        return;
      }


      match.status =
        'live';


      alert(
        'Match resumed.'
      );

      await refresh();
    };
}


/* =========================
   INITIALIZE
========================= */

(async function init() {

  const authenticated =
    await ensureAuth();


  if (!authenticated) {
    return;
  }


  if (!matchId) {

    alert(
      'Match ID is missing.'
    );

    return;
  }


  await load();

})();
