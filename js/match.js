import { supabase } from './supabase.js';


const $ = id =>
  document.getElementById(id);


const matchId =
  new URLSearchParams(location.search).get('id');


const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));


/* ================================
   CALCULATE ONE INNINGS SCORECARD
================================ */

function calculateScorecard(deliveries, players) {

  const playerMap = {};

  players.forEach(player => {
    playerMap[player.id] = player.name;
  });


  const batting = {};
  const bowling = {};

  let totalRuns = 0;
  let wickets = 0;

  let wides = 0;
  let noBalls = 0;
  let byes = 0;
  let legByes = 0;

  let legalBalls = 0;


  deliveries.forEach(ball => {

    totalRuns += Number(ball.total_runs || 0);

    wides += Number(ball.extras_wides || 0);
    noBalls += Number(ball.extras_noballs || 0);
    byes += Number(ball.extras_byes || 0);
    legByes += Number(ball.extras_legbyes || 0);


    if (ball.legal_ball) {
      legalBalls++;
    }


    /* ================================
       BATTING
    ================================ */

    if (ball.striker_id) {

      if (!batting[ball.striker_id]) {

        batting[ball.striker_id] = {

          id: ball.striker_id,

          name:
            playerMap[ball.striker_id] ||
            'Unknown Player',

          runs: 0,
          balls: 0,
          fours: 0,
          sixes: 0,

          dismissal:
            'not out'

        };

      }


      const batsmanRuns =
        Number(ball.batsman_runs || 0);


      batting[ball.striker_id].runs +=
        batsmanRuns;


      if (batsmanRuns === 4) {
        batting[ball.striker_id].fours++;
      }


      if (batsmanRuns === 6) {
        batting[ball.striker_id].sixes++;
      }


      if (ball.legal_ball) {
        batting[ball.striker_id].balls++;
      }

    }


    /* ================================
       WICKET
    ================================ */

    if (ball.wicket) {

      wickets++;


      if (
        ball.dismissed_player_id &&
        !batting[ball.dismissed_player_id]
      ) {

        batting[ball.dismissed_player_id] = {

          id:
            ball.dismissed_player_id,

          name:
            playerMap[
              ball.dismissed_player_id
            ] || 'Unknown Player',

          runs: 0,
          balls: 0,
          fours: 0,
          sixes: 0,

          dismissal:
            ball.dismissal_type ||
            'out'

        };

      }


      if (ball.dismissed_player_id) {

        batting[
          ball.dismissed_player_id
        ].dismissal =
          ball.dismissal_type ||
          'out';

      }

    }


    /* ================================
       BOWLING
    ================================ */

    if (ball.bowler_id) {

      if (!bowling[ball.bowler_id]) {

        bowling[ball.bowler_id] = {

          id: ball.bowler_id,

          name:
            playerMap[ball.bowler_id] ||
            'Unknown Player',

          balls: 0,
          runs: 0,
          wickets: 0

        };

      }


      if (ball.legal_ball) {
        bowling[ball.bowler_id].balls++;
      }


      const runsConceded =
        Number(ball.batsman_runs || 0) +
        Number(ball.extras_wides || 0) +
        Number(ball.extras_noballs || 0);


      bowling[ball.bowler_id].runs +=
        runsConceded;


      const nonBowlerWickets = [
        'run out',
        'retired hurt',
        'obstructing the field'
      ];


      if (
        ball.wicket &&
        !nonBowlerWickets.includes(
          String(
            ball.dismissal_type || ''
          ).toLowerCase()
        )
      ) {

        bowling[
          ball.bowler_id
        ].wickets++;

      }

    }

  });


  return {

    totalRuns,
    wickets,
    legalBalls,

    wides,
    noBalls,
    byes,
    legByes,

    batting:
      Object.values(batting),

    bowling:
      Object.values(bowling)

  };

}


/* ================================
   FORMAT OVERS
================================ */

function formatOvers(balls) {

  return `${Math.floor(balls / 6)}.${balls % 6}`;

}


/* ================================
   FIND PLAYER
================================ */

function findPlayer(players, id) {

  if (!id) {
    return null;
  }

  return players.find(
    player => player.id === id
  ) || null;

}


/* ================================
   UPDATE CURRENT PLAYERS
================================ */

function updateCurrentPlayers(
  innings,
  deliveries,
  players,
  stats
) {

  const strikerElement =
    $('striker');

  const nonStrikerElement =
    $('nonStriker');

  const bowlerElement =
    $('bowler');

  const strikerStatsElement =
    $('strikerStats');

  const nonStrikerStatsElement =
    $('nonStrikerStats');

  const bowlerStatsElement =
    $('bowlerStats');


  if (
    !strikerElement ||
    !nonStrikerElement ||
    !bowlerElement
  ) {
    return;
  }


  /* No deliveries yet */

  if (!deliveries.length) {

    strikerElement.textContent =
      'Not started';

    nonStrikerElement.textContent =
      'Not started';

    bowlerElement.textContent =
      'Not started';

    strikerStatsElement.textContent =
      '';

    nonStrikerStatsElement.textContent =
      '';

    bowlerStatsElement.textContent =
      '';

    return;

  }


  /* Latest delivery */

  const latestBall =
    deliveries[deliveries.length - 1];


  const striker =
    findPlayer(
      players,
      latestBall.striker_id
    );


  const nonStriker =
    findPlayer(
      players,
      latestBall.non_striker_id
    );


  const bowler =
    findPlayer(
      players,
      latestBall.bowler_id
    );


  /* ================================
     STRIKER
  ================================ */

  strikerElement.textContent =
    striker?.name ||
    'Not available';


  const strikerData =
    stats.batting.find(
      player =>
        player.id === latestBall.striker_id
    );


  if (strikerData) {

    const sr =
      strikerData.balls
        ? (
            strikerData.runs /
            strikerData.balls *
            100
          ).toFixed(2)
        : '0.00';


    strikerStatsElement.textContent =
      `${strikerData.runs} runs · ` +
      `${strikerData.balls} balls · ` +
      `SR ${sr}`;

  } else {

    strikerStatsElement.textContent =
      '0 runs · 0 balls · SR 0.00';

  }


  /* ================================
     NON-STRIKER
  ================================ */

  nonStrikerElement.textContent =
    nonStriker?.name ||
    'Not available';


  const nonStrikerData =
    stats.batting.find(
      player =>
        player.id ===
        latestBall.non_striker_id
    );


  if (nonStrikerData) {

    const sr =
      nonStrikerData.balls
        ? (
            nonStrikerData.runs /
            nonStrikerData.balls *
            100
          ).toFixed(2)
        : '0.00';


    nonStrikerStatsElement.textContent =
      `${nonStrikerData.runs} runs · ` +
      `${nonStrikerData.balls} balls · ` +
      `SR ${sr}`;

  } else {

    nonStrikerStatsElement.textContent =
      '0 runs · 0 balls · SR 0.00';

  }


  /* ================================
     BOWLER
  ================================ */

  bowlerElement.textContent =
    bowler?.name ||
    'Not available';


  const bowlerData =
    stats.bowling.find(
      player =>
        player.id ===
        latestBall.bowler_id
    );


  if (bowlerData) {

    const economy =
      bowlerData.balls
        ? (
            bowlerData.runs /
            (bowlerData.balls / 6)
          ).toFixed(2)
        : '0.00';


    bowlerStatsElement.textContent =
      `${formatOvers(bowlerData.balls)} overs · ` +
      `${bowlerData.runs} runs · ` +
      `${bowlerData.wickets} wickets · ` +
      `Econ ${economy}`;

  } else {

    bowlerStatsElement.textContent =
      '0.0 overs · 0 runs · 0 wickets';

  }

}


/* ================================
   CREATE SCORECARD
================================ */

function renderScorecard(
  innings,
  data,
  battingTeam,
  bowlingTeam
) {

  const battingRows =
    data.batting.map(player => {

      const strikeRate =
        player.balls
          ? (
              player.runs /
              player.balls *
              100
            ).toFixed(2)
          : '0.00';


      return `

        <tr>

          <td>

            <strong>
              ${esc(player.name)}
            </strong>

            <br>

            <small class="muted">
              ${esc(player.dismissal)}
            </small>

          </td>

          <td>
            ${player.runs}
          </td>

          <td>
            ${player.balls}
          </td>

          <td>
            ${player.fours}
          </td>

          <td>
            ${player.sixes}
          </td>

          <td>
            ${strikeRate}
          </td>

        </tr>

      `;

    }).join('');


  const bowlingRows =
    data.bowling.map(player => {

      const overs =
        formatOvers(player.balls);


      const economy =
        player.balls
          ? (
              player.runs /
              (player.balls / 6)
            ).toFixed(2)
          : '0.00';


      return `

        <tr>

          <td>
            <strong>
              ${esc(player.name)}
            </strong>
          </td>

          <td>
            ${overs}
          </td>

          <td>
            ${player.runs}
          </td>

          <td>
            ${player.wickets}
          </td>

          <td>
            ${economy}
          </td>

        </tr>

      `;

    }).join('');


  const extrasTotal =
    data.wides +
    data.noBalls +
    data.byes +
    data.legByes;


  const runRate =
    data.legalBalls
      ? (
          data.totalRuns /
          (data.legalBalls / 6)
        ).toFixed(2)
      : '0.00';


  return `

    <section class="scorecard">

      <div class="innings-header">

        <h2>

          Innings
          ${innings.innings_no}
          —
          ${esc(battingTeam)}

        </h2>


        <div class="innings-score">

          ${data.totalRuns}/${data.wickets}

          <span>

            (${formatOvers(
              data.legalBalls
            )} overs)

          </span>

        </div>

      </div>


      <h3>
        🏏 Batting
      </h3>


      <div class="table-wrap">

        <table>

          <thead>

            <tr>

              <th>Batsman</th>
              <th>R</th>
              <th>B</th>
              <th>4s</th>
              <th>6s</th>
              <th>SR</th>

            </tr>

          </thead>


          <tbody>

            ${
              battingRows ||

              `
                <tr>
                  <td colspan="6">
                    No batting data.
                  </td>
                </tr>
              `
            }

          </tbody>

        </table>

      </div>


      <div class="innings-info">

        <div>

          <strong>
            Extras:
          </strong>

          ${extrasTotal}

          (
          Wd ${data.wides},
          Nb ${data.noBalls},
          B ${data.byes},
          Lb ${data.legByes}
          )

        </div>


        <div>

          <strong>
            Run Rate:
          </strong>

          ${runRate}

        </div>

      </div>


      <h3>

        🎳 Bowling —
        ${esc(bowlingTeam)}

      </h3>


      <div class="table-wrap">

        <table>

          <thead>

            <tr>

              <th>Bowler</th>
              <th>O</th>
              <th>R</th>
              <th>W</th>
              <th>Econ</th>

            </tr>

          </thead>


          <tbody>

            ${
              bowlingRows ||

              `
                <tr>
                  <td colspan="5">
                    No bowling data.
                  </td>
                </tr>
              `
            }

          </tbody>

        </table>

      </div>

    </section>

  `;

}


/* ================================
   LOAD MATCH
================================ */

async function load() {

  if (!matchId) {

    $('title').textContent =
      'Match not found';

    return;

  }


  /* ================================
     MATCH
  ================================ */

  const {
    data: m,
    error
  } = await supabase

    .from('matches')

    .select(`
      *,
      team_a:teams!matches_team_a_id_fkey(
        id,
        name
      ),
      team_b:teams!matches_team_b_id_fkey(
        id,
        name
      )
    `)

    .eq('id', matchId)

    .single();


  if (error || !m) {

    $('title').textContent =
      'Match not found';

    console.error(error);

    return;

  }


  /* ================================
     HEADER
  ================================ */

  $('title').textContent =
    `${m.team_a.name} vs ${m.team_b.name}`;


  $('status').textContent =
    (m.status || 'scheduled')
      .toUpperCase();


  $('meta').textContent =
    `${m.name} · ` +
    `${m.venue || 'Venue not set'} · ` +
    `${m.overs} overs`;


  $('result').textContent =
    m.result_text || '';


  /* ================================
     PLAYERS
  ================================ */

  const {
    data: allPlayers,
    error: playersError
  } = await supabase

    .from('players')

    .select('id,name');


  if (playersError) {
    console.error(playersError);
  }


  const players =
    allPlayers || [];


  /* ================================
     INNINGS
  ================================ */

  const {
    data: inningsList,
    error: inningsError
  } = await supabase

    .from('innings')

    .select(`
      *,
      batting:teams!innings_batting_team_id_fkey(
        id,
        name
      ),
      bowling:teams!innings_bowling_team_id_fkey(
        id,
        name
      )
    `)

    .eq('match_id', matchId)

    .order('innings_no', {
      ascending: true
    });


  if (inningsError) {

    console.error(inningsError);

    return;

  }


  if (!inningsList || !inningsList.length) {

    $('score').textContent =
      '—';

    $('rr').textContent =
      '—';

    $('target').textContent =
      '—';


    $('striker').textContent =
      '—';

    $('nonStriker').textContent =
      '—';

    $('bowler').textContent =
      '—';


    $('strikerStats').textContent =
      '';

    $('nonStrikerStats').textContent =
      '';

    $('bowlerStats').textContent =
      '';


    $('commentary').innerHTML =
      '<p class="muted">Match has not started.</p>';


    return;

  }


  /* ================================
     SCORECARDS CONTAINER
  ================================ */

  let scorecardsContainer =
    document.getElementById(
      'scorecards'
    );


  if (!scorecardsContainer) {

    scorecardsContainer =
      document.createElement('div');


    scorecardsContainer.id =
      'scorecards';


    const commentary =
      document.getElementById(
        'commentary'
      );


    if (commentary) {

      commentary.parentElement
        .insertAdjacentElement(
          'afterend',
          scorecardsContainer
        );

    } else {

      document.body.appendChild(
        scorecardsContainer
      );

    }

  }


  let allCommentary = [];

  let scorecardsHTML = '';


  /* ================================
     PROCESS INNINGS
  ================================ */

  for (const innings of inningsList) {

    const {
      data: deliveriesData,
      error: deliveriesError
    } = await supabase

      .from('deliveries')

      .select('*')

      .eq(
        'innings_id',
        innings.id
      )

      .order('created_at', {
        ascending: true
      });


    if (deliveriesError) {

      console.error(
        deliveriesError
      );

      continue;

    }


    const deliveries =
      deliveriesData || [];


    const stats =
      calculateScorecard(
        deliveries,
        players
      );


    /* ================================
       LATEST INNINGS SCOREBOARD
    ================================ */

    if (
      innings.innings_no ===
      inningsList[
        inningsList.length - 1
      ].innings_no
    ) {

      $('score').textContent =
        `${innings.batting?.name || 'Team'} ` +
        `${stats.totalRuns}/${stats.wickets} ` +
        `(${formatOvers(
          stats.legalBalls
        )})`;


      $('rr').textContent =
        stats.legalBalls

          ? (
              stats.totalRuns /
              (stats.legalBalls / 6)
            ).toFixed(2)

          : '0.00';


      $('target').textContent =
        innings.target || '—';


      /* ================================
         CURRENT STRIKER / NON-STRIKER /
         BOWLER
      ================================ */

      updateCurrentPlayers(
        innings,
        deliveries,
        players,
        stats
      );

    }


    /* ================================
       SCORECARD
    ================================ */

    scorecardsHTML +=
      renderScorecard(

        innings,

        stats,

        innings.batting?.name ||
          'Batting Team',

        innings.bowling?.name ||
          'Bowling Team'

      );


    /* ================================
       COMMENTARY
    ================================ */

    allCommentary.push(

      ...deliveries.map(ball => ({

        inningsNo:
          innings.innings_no,

        over:
          ball.over_number,

        ball:
          ball.ball_number,

        commentary:
          ball.commentary ||
          'Ball recorded',

        created_at:
          ball.created_at

      }))

    );

  }


  /* ================================
     DISPLAY SCORECARDS
  ================================ */

  scorecardsContainer.innerHTML =
    scorecardsHTML;


  /* ================================
     COMMENTARY
  ================================ */

  allCommentary.sort((a, b) => {

    if (
      a.inningsNo !==
      b.inningsNo
    ) {

      return (
        b.inningsNo -
        a.inningsNo
      );

    }


    return (
      new Date(b.created_at) -
      new Date(a.created_at)
    );

  });


  $('commentary').innerHTML =

    allCommentary

      .map(ball => `

        <div class="comment">

          <b>

            Innings
            ${ball.inningsNo}
            ·
            ${ball.over}.${ball.ball}

          </b>

          —
          ${esc(ball.commentary)}

        </div>

      `)

      .join('')

      ||

      '<p class="muted">No deliveries yet.</p>';

}


/* ================================
   START
================================ */

load();


/* ================================
   AUTO REFRESH
================================ */

setInterval(
  load,
  5000
);
