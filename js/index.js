import { supabase } from './supabase.js';

const $ = id => document.getElementById(id);


const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, char => ({

    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'

  }[char]));


function matchCard(match, history = false) {

  const teamA = match.team_a?.name || 'Team A';

  const teamB = match.team_b?.name || 'Team B';


  let result = '';

  if (match.result_text) {

    result = `
      <strong class="ok">
        ${esc(match.result_text)}
      </strong>
    `;

  }


  let date = '';

  if (history && match.completed_at) {

    const completedDate =
      new Date(match.completed_at);

    date = `
      <span class="small">
        Completed:
        ${completedDate.toLocaleString()}
      </span>
    `;

  }


  return `

    <a
      href="match.html?id=${match.id}"
      class="item"
    >

      <strong>
        ${esc(match.name)}
      </strong>


      <span class="small">

        ${esc(teamA)}
        vs
        ${esc(teamB)}

        · ${match.overs} overs

      </span>


      <span class="small">

        Status:
        ${esc(match.status).toUpperCase()}

      </span>


      ${result}

      ${date}


      <span class="small">

        Click to view complete scorecard →

      </span>

    </a>

  `;

}


async function loadMatches() {

  const { data, error } = await supabase

    .from('matches')

    .select(`
      *,
      team_a:teams!matches_team_a_id_fkey(name),
      team_b:teams!matches_team_b_id_fkey(name)
    `)

    .order('created_at', {
      ascending: false
    });


  if (error) {

    console.error(error);

    return;

  }


  const matches = data || [];


  const liveMatches = matches.filter(match =>
    ['live', 'paused', 'innings_break']
      .includes(match.status)
  );


  const upcomingMatches = matches.filter(match =>
    ['scheduled', 'toss']
      .includes(match.status)
  );


  const completedMatches = matches.filter(match =>
    match.status === 'completed'
  );


  const cancelledMatches = matches.filter(match =>
    match.status === 'cancelled'
  );


  $('liveList').innerHTML =

    liveMatches.map(match =>
      matchCard(match)
    ).join('')

    ||

    '<div class="item">No live matches.</div>';



  $('upcomingList').innerHTML =

    upcomingMatches.map(match =>
      matchCard(match)
    ).join('')

    ||

    '<div class="item">No upcoming matches.</div>';



  $('completedList').innerHTML =

    completedMatches.map(match =>
      matchCard(match, true)
    ).join('')

    ||

    '<div class="item">No completed matches yet.</div>';



  $('cancelledList').innerHTML =

    cancelledMatches.map(match =>
      matchCard(match)
    ).join('')

    ||

    '<div class="item">No cancelled matches.</div>';

}


loadMatches();


setInterval(
  loadMatches,
  10000
);