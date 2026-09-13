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


  /* =========================
     FIND LIVE INNINGS
  ========================= */

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


  /* =========================
     LOAD PLAYING XI
  ========================= */

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


  /* =========================
     PAGE INFORMATION
  ========================= */

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


  /* =========================
     RESTORE CURRENT PLAYERS
  ========================= */

  await rebuildState();

  fillSelects();

  await refresh();
}


/* =========================
   REBUILD CURRENT STATE
========================= */

async function rebuildState() {

  /*
    First use player state saved
    directly in innings table.
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
    If no saved state exists,
    rebuild from deliveries.
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
    Odd running runs change strike.
  */

  const runningRuns =
    Number(last.batsman_runs || 0) +
    Number(last.extras_byes || 0) +
    Number(last.extras_legbyes || 0);


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
    Wicket removes dismissed player.
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
            ${
              player.role
                ? ` (${esc(player.role)})`
                : ''
            }
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

  if (!innings || !innings.id) {

    alert(
      'ERROR: Active innings ID is missing.'
    );

    console.error(
      'innings:',
      innings
    );

    return false;
  }


  if (
    !state.striker ||
    !state.non ||
    !state.bowler
  ) {

    alert(
      'Please select striker, non-striker and bowler.'
    );

    return false;
  }


  console.log(
    'Saving player state:',
    {
      innings_id: innings.id,
      striker_id: state.striker,
      non_striker_id: state.non,
      bowler_id: state.bowler
    }
  );


  const {
    data,
    error
  } =
    await supabase
      .from('innings')
      .update({

        striker_id:
          state.striker,

        non_striker_id:
          state.non,

        bowler_id:
          state.bowler

      })
      .eq(
        'id',
        innings.id
      )
      .select(
        'id, striker_id, non_striker_id, bowler_id'
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


  console.log(
    'PLAYER STATE SAVED:',
    data
  );


  /*
    Update local innings object.
  */

  innings.striker_id =
    data.striker_id;

  innings.non_striker_id =
    data.non_striker_id;

  innings.bowler_id =
    data.bowler_id;


  /*
    Update local state.
  */

  state.striker =
    data.striker_id;

  state.non =
    data.non_striker_id;

  state.bowler =
    data.bowler_id;


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


  /* =========================
     COMMENTARY
  ========================= */

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

  $('savePlayers').addEventListener(
    'click',
    async () => {

      console.log(
        'SAVE PLAYERS BUTTON CLICKED'
      );


      const striker =
        $('striker')?.value || '';

      const non =
        $('nonStriker')?.value || '';

      const bowler =
        $('bowler')?.value || '';


      console.log(
        'Selected players:',
        {
          striker,
          non,
          bowler
        }
      );


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


      if (
        striker === non
      ) {

        alert(
          'Striker and non-striker cannot be the same player.'
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


      const strikerText =
        $('striker')
          ?.selectedOptions?.[0]
          ?.text ||
        'Unknown';


      const nonText =
        $('nonStriker')
          ?.selectedOptions?.[0]
          ?.text ||
        'Unknown';


      const bowlerText =
        $('bowler')
          ?.selectedOptions?.[0]
          ?.text ||
        'Unknown';


      alert(
        '✓ PLAYERS SAVED SUCCESSFULLY\n\n' +
        'Striker: ' +
        strikerText.trim() +
        '\nNon-striker: ' +
        nonText.trim() +
        '\nBowler: ' +
        bowlerText.trim()
      );
    }
  );
}


/* =========================
   RECORD BALL
========================= */

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


  const existing =
    await deliveries();

  const current =
    calc(existing);


  const maximumBalls =
    Number(match.overs) * 6;


  if (
    current.legal >=
    maximumBalls
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


  /* =========================
     UPDATE PLAYER STATE
  ========================= */

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


  /* =========================
     WICKET
  ========================= */

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


  /* =========================
     LEGAL BALL COUNT
  ========================= */

  const newLegal =
    current.legal +
    (legalBall ? 1 : 0);


  const overCompleted =
    legalBall &&
    newLegal > 0 &&
    newLegal % 6 === 0;


  /* =========================
     END OF OVER
  ========================= */

  if (overCompleted) {

    [
      state.striker,
      state.non
    ] = [
      state.non,
      state.striker
    ];


    state.bowler = null;
  }


  /*
    Save updated player state.

    If a wicket or over has created
    an empty player position,
    saveCurrentState cannot save null.
    In that case we do NOT call it yet.
  */

  if (
    state.striker &&
    state.non &&
    state.bowler
  ) {

    const stateSaved =
      await saveCurrentState();


    if (!stateSaved) {
      return;
    }

  } else {

    /*
      Save partial state directly.

      This is important after a wicket
      or completed over.
    */

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
        .eq(
          'id',
          innings.id
        );


    if (partialStateError) {

      console.error(
        partialStateError
      );

      alert(
        'Unable to save current player state: ' +
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


  /* =========================
     SECOND INNINGS
  ========================= */

  if (
    innings.innings_no === 2
  ) {

    const firstRuns =
      await firstScore();


    if (
      score.runs >
      firstRuns
    ) {

      await finishSecond(true);

      return;
    }


    if (
      score.wickets >= 10
    ) {

      await finishSecond(false);

      return;
    }


    if (
      score.legal >= maximumBalls
    ) {

      await finishSecond(false);

      return;
    }


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


    if (overCompleted) {

      alert(
        `Over ${Math.floor(newLegal / 6)} completed. Select a new bowler.`
      );

      return;
    }


    return;
  }


  /* =========================
     FIRST INNINGS
  ========================= */

  if (
    score.wickets >= 10
  ) {

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


/* =========================
   COMPLETE FIRST INNINGS
========================= */

async function completeFirstInnings(score) {

  const target =
    score.runs + 1;


  const {
    error: firstError
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


  if (firstError) {

    alert(
      firstError.message
    );

    return;
  }


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


  /* =========================
     CHASING TEAM WINS
  ========================= */

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


  /* =========================
     FIRST TEAM WINS
  ========================= */

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


  /* =========================
     TIE
  ========================= */

  else {

    resultText =
      'Match tied';
  }


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
