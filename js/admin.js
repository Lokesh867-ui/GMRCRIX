import { supabase } from './supabase.js';

const $ = id => document.getElementById(id);

const esc = v =>
String(v ?? '').replace(/[&<>"']/g, c => ({
'&': '&',
'<': '<',
'>': '>',
'"': '"',
"'": '''
}[c]));

let teams = [];

/* ===============================
AUTHENTICATION
================================ */

async function requireSession() {

const {
data: { session }
} = await supabase.auth.getSession();

$('loginCard').classList.toggle(
'hidden',
!!session
);

$('dashboard').classList.toggle(
'hidden',
!session
);

if (session) {
await loadAll();
}
}

/* ===============================
LOAD ALL DATA
================================ */

async function loadAll() {

await loadTeams();
await loadPlayers();
await loadMatches();

}

/* ===============================
TEAMS
================================ */

async function loadTeams() {

const { data, error } = await supabase
.from('teams')
.select('*')
.order('name');

if (error) {
alert(error.message);
return;
}

teams = data || [];

$('teamList').innerHTML =
teams.map(t => `

<div class="item">  

    <strong>  
      ${esc(t.name)}  
      (${esc(t.code)})  
    </strong>  

    <div class="row">  

      <button  
        class="secondary edit-team"  
        data-id="${t.id}"  
        style="width:auto"  
      >  
        Edit  
      </button>  

      <button  
        class="danger del-team"  
        data-id="${t.id}"  
        style="width:auto"  
      >  
        Delete  
      </button>  

    </div>  

  </div>  

`).join('') ||  
'<p class="muted">No teams yet.</p>';

/* Fill team dropdowns */

['playerTeam', 'teamA', 'teamB'].forEach(id => {

const element = $(id);  

if (!element) return;  

element.innerHTML = teams.map(t => `  

  <option value="${t.id}">  
    ${esc(t.name)}  
    (${esc(t.code)})  
  </option>  

`).join('');

});

/* Delete team */

document
.querySelectorAll('.del-team')
.forEach(button => {

button.onclick = async () => {  

    const team = teams.find(  
      t => t.id === button.dataset.id  
    );  

    if (!team) return;  

    if (!confirm(  
      `Delete team "${team.name}"?\n\n` +  
      'Delete all players from this team first. ' +  
      'Teams used in match history should not be deleted.'  
    )) return;  


    const { error } = await supabase  
      .from('teams')  
      .delete()  
      .eq('id', button.dataset.id);  


    if (error) {  

      alert(  
        'Cannot delete this team.\n\n' +  
        error.message  
      );  

      return;  

    }  


    await loadAll();  

  };  

});

/* Edit team */

document
.querySelectorAll('.edit-team')
.forEach(button => {

button.onclick = async () => {  

    const team = teams.find(  
      t => t.id === button.dataset.id  
    );  

    if (!team) return;  


    const name = prompt(  
      'Team name',  
      team.name  
    );  

    if (!name?.trim()) return;  


    const code = prompt(  
      'Team code',  
      team.code  
    );  

    if (!code?.trim()) return;  


    const { error } = await supabase  
      .from('teams')  
      .update({  
        name: name.trim(),  
        code: code.trim().toUpperCase()  
      })  
      .eq('id', team.id);  


    if (error) {  

      alert(error.message);  
      return;  

    }  


    await loadAll();  

  };  

});

}

/* ===============================
PLAYERS
================================ */

async function loadPlayers() {

const { data, error } = await supabase
.from('players')
.select(  id,   name,   role,   team_id,   teams(name)  )
.order('name');

if (error) {

alert(error.message);  
return;

}

const players = data || [];

$('playerList').innerHTML =
players.map(player => `

<div class="item">  

    <strong>  
      ${esc(player.name)}  
    </strong>  

    <span class="small">  

      ${esc(player.teams?.name || 'No Team')}  
      ·  
      ${esc(player.role)}  

    </span>  


    <div class="row">  

      <button  
        class="secondary edit-player"  
        data-id="${player.id}"  
        style="width:auto"  
      >  
        Edit  
      </button>  


      <button  
        class="danger del-player"  
        data-id="${player.id}"  
        style="width:auto"  
      >  
        Delete  
      </button>  

    </div>  

  </div>  

`).join('') ||  
'<p class="muted">No players yet.</p>';

/* Delete player */

document
.querySelectorAll('.del-player')
.forEach(button => {

button.onclick = async () => {  

    const player = players.find(  
      p => p.id === button.dataset.id  
    );  

    if (!player) return;  


    if (!confirm(  
      `Delete player "${player.name}"?`  
    )) return;  


    const { error } = await supabase  
      .from('players')  
      .delete()  
      .eq('id', player.id);  


    if (error) {  

      alert(error.message);  
      return;  

    }  


    await loadAll();  

  };  

});

/* Edit player */

document
.querySelectorAll('.edit-player')
.forEach(button => {

button.onclick = async () => {  

    const player = players.find(  
      p => p.id === button.dataset.id  
    );  

    if (!player) return;  


    const name = prompt(  
      'Player name',  
      player.name  
    );  

    if (!name?.trim()) return;  


    const role = prompt(  
      'Role: Batsman / Bowler / All-rounder / Wicketkeeper',  
      player.role  
    );  


    const validRoles = [  
      'Batsman',  
      'Bowler',  
      'All-rounder',  
      'Wicketkeeper'  
    ];  


    if (!validRoles.includes(role)) {  

      alert(  
        'Invalid role.\n\n' +  
        'Use:\n' +  
        'Batsman\n' +  
        'Bowler\n' +  
        'All-rounder\n' +  
        'Wicketkeeper'  
      );  

      return;  

    }  


    const { error } = await supabase  
      .from('players')  
      .update({  
        name: name.trim(),  
        role  
      })  
      .eq('id', player.id);  


    if (error) {  

      alert(error.message);  
      return;  

    }  


    await loadAll();  

  };  

});

}

/* ===============================
MATCHES
================================ */

async function loadMatches() {

const { data, error } = await supabase
.from('matches')
.select(  *,   team_a:teams!matches_team_a_id_fkey(name),   team_b:teams!matches_team_b_id_fkey(name)  )
.order('created_at', {
ascending: false
});

if (error) {

alert(error.message);  
return;

}

const matches = data || [];

$('matchList').innerHTML =
matches.map(match => {

const isCompleted =  
    match.status === 'completed';  

  const isCancelled =  
    match.status === 'cancelled';  


  let actions = `  

    <a href="match.html?id=${match.id}">  

      <button  
        class="secondary"  
        style="width:auto"  
      >  
        View  
      </button>  

    </a>  

  `;  


  /* Manage active/scheduled matches */  

  if (!isCompleted && !isCancelled) {  

    actions += `  

      <a href="manage.html?id=${match.id}">  

        <button style="width:auto">  
          Manage  
        </button>  

      </a>  

    `;  


    /* Scoring */  

    if (  
      [  
        'live',  
        'paused',  
        'innings_break'  
      ].includes(match.status)  
    ) {  

      actions += `  

        <a href="scorer.html?id=${match.id}">  

          <button  
            class="success"  
            style="width:auto"  
          >  
            Score  
          </button>  

        </a>  

      `;  

    }  


    /* Cancel */  

    actions += `  

      <button  
        class="danger cancel-match"  
        data-id="${match.id}"  
        style="width:auto"  
      >  
        Cancel  
      </button>  

    `;  

  }  


  /* Completed */  

  if (isCompleted) {  

    actions += `  

      <span class="ok">  

        ✓ Match History Saved  

      </span>  

    `;  

  }  


  return `  

    <div class="item">  

      <strong>  
        ${esc(match.name)}  
      </strong>  


      <span class="small">  

        ${esc(match.team_a?.name || 'Team A')}  

        vs  

        ${esc(match.team_b?.name || 'Team B')}  

        · ${match.overs} overs  

      </span>  


      <span class="small">  

        Status:  
        ${esc(match.status)}  

      </span>  


      ${  
        match.result_text  
          ? `  

            <strong class="ok">  

              ${esc(match.result_text)}  

            </strong>  

          `  
          : ''  
      }  


      <div class="row">  

        ${actions}  

      </div>  

    </div>  

  `;  

}).join('') ||  
'<p class="muted">No matches yet.</p>';

/* ===============================
CANCEL MATCH
================================ */

document
.querySelectorAll('.cancel-match')
.forEach(button => {

button.onclick = async () => {  

    if (!confirm(  
      'Cancel this match?\n\n' +  
      'Existing match data will remain saved.'  
    )) return;  


    const { error } = await supabase  
      .from('matches')  
      .update({  
        status: 'cancelled',  
        result_text:  
          'Match cancelled by administrator'  
      })  
      .eq(  
        'id',  
        button.dataset.id  
      );  


    if (error) {  

      alert(error.message);  
      return;  

    }  


    await loadMatches();  

  };  

});

}

/* ===============================
LOGIN
================================ */

$('loginForm').addEventListener(
'submit',
async event => {

event.preventDefault();  

$('loginError').textContent = '';  


const { error } = await supabase  
  .auth  
  .signInWithPassword({  

    email:  
      $('email').value.trim(),  

    password:  
      $('password').value  

  });  


if (error) {  

  $('loginError').textContent =  
    error.message;  

  return;  

}  


await requireSession();

}
);

/* ===============================
LOGOUT
================================ */

$('logout').onclick = async () => {

await supabase.auth.signOut();

await requireSession();

};

/* ===============================
CREATE TEAM
================================ */

$('teamForm').addEventListener(
'submit',
async event => {

event.preventDefault();  


const name =  
  $('teamName').value.trim();  

const code =  
  $('teamCode').value  
    .trim()  
    .toUpperCase();  


if (!name || !code) {  

  alert(  
    'Enter both team name and team code.'  
  );  

  return;  

}  


const { error } = await supabase  
  .from('teams')  
  .insert({  
    name,  
    code  
  });  


if (error) {  

  alert(error.message);  
  return;  

}  


event.target.reset();  

await loadAll();

}
);

/* ===============================
CREATE PLAYER
================================ */

$('playerForm').addEventListener(
'submit',
async event => {

event.preventDefault();  


if (!teams.length) {  

  alert(  
    'Create a team first.'  
  );  

  return;  

}  


const name =  
  $('playerName').value.trim();  

const teamId =  
  $('playerTeam').value;  

const role =  
  $('playerRole').value;  


if (!name || !teamId || !role) {  

  alert(  
    'Enter all player details.'  
  );  

  return;  

}  


const { error } = await supabase  
  .from('players')  
  .insert({  
    name,  
    team_id: teamId,  
    role  
  });  


if (error) {  

  alert(error.message);  
  return;  

}  


event.target.reset();  

await loadPlayers();

}
);

/* ===============================
CREATE MATCH
================================ */

$('matchForm').addEventListener(
'submit',
async event => {

event.preventDefault();  


if (teams.length < 2) {  

  alert(  
    'Create at least two teams first.'  
  );  

  return;  

}  


const teamA =  
  $('teamA').value;  

const teamB =  
  $('teamB').value;  


if (teamA === teamB) {  

  alert(  
    'Select two different teams.'  
  );  

  return;  

}  


const name =  
  $('matchName').value.trim();  

const overs =  
  Number(  
    $('matchOvers').value  
  );  

const venue =  
  $('venue').value.trim() || null;  


if (!name) {  

  alert(  
    'Enter a match name.'  
  );  

  return;  

}  


if (!overs || overs <= 0) {  

  alert(  
    'Enter valid overs.'  
  );  

  return;  

}  


const { error } = await supabase  
  .from('matches')  
  .insert({  

    name,  

    team_a_id:  
      teamA,  

    team_b_id:  
      teamB,  

    overs,  

    venue,  

    status:  
      'scheduled'  

  });  


if (error) {  

  alert(error.message);  
  return;  

}  


event.target.reset();  

await loadMatches();

}
);

/* ===============================
START ADMIN PAGE
================================ */

requireSession();
