import { supabase } from './supabase.js';

const $ = id => document.getElementById(id);

const esc = v =>
  String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

let teams = [];


/* ===============================
   AUTHENTICATION
================================ */

async function requireSession() {

  const {
    data: { session }
  } = await supabase.auth.getSession();

  const loginCard = $('loginCard');
  const dashboard = $('dashboard');

  if (loginCard) {
    loginCard.classList.toggle('hidden', !!session);
  }

  if (dashboard) {
    dashboard.classList.toggle('hidden', !session);
  }

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
    console.error(error);
    alert(error.message);
    return;
  }

  teams = data || [];

  const teamList = $('teamList');

  if (teamList) {
    teamList.innerHTML = teams.map(team => `
      <div class="item">

        <strong>
          ${esc(team.name)} (${esc(team.code)})
        </strong>

        <div class="row">

          <button
            class="secondary edit-team"
            data-id="${team.id}"
            style="width:auto"
          >
            Edit
          </button>

          <button
            class="danger del-team"
            data-id="${team.id}"
            style="width:auto"
          >
            Delete
          </button>

        </div>

      </div>
    `).join('') || '<p class="muted">No teams yet.</p>';
  }


  /* Fill dropdowns */

  ['playerTeam', 'teamA', 'teamB'].forEach(id => {

    const element = $(id);

    if (!element) return;

    element.innerHTML = teams.map(team => `
      <option value="${team.id}">
        ${esc(team.name)} (${esc(team.code)})
      </option>
    `).join('');

  });


  /* DELETE TEAM */

  document.querySelectorAll('.del-team').forEach(button => {

    button.onclick = async () => {

      const team = teams.find(
        t => t.id === button.dataset.id
      );

      if (!team) return;

      if (!confirm(
        `Delete team "${team.name}"?\n\n` +
        'Delete all players from this team first.'
      )) return;


      const { error } = await supabase
        .from('teams')
        .delete()
        .eq('id', team.id);


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


  /* EDIT TEAM */

  document.querySelectorAll('.edit-team').forEach(button => {

    button.onclick = async () => {

      const team = teams.find(
        t => t.id === button.dataset.id
      );

      if (!team) return;


      const name = prompt(
        'Team name',
        team.name
      );

      if (!name || !name.trim()) return;


      const code = prompt(
        'Team code',
        team.code
      );

      if (!code || !code.trim()) return;


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
    .select(`
      id,
      name,
      role,
      team_id,
      teams(name)
    `)
    .order('name');


  if (error) {
    console.error(error);
    alert(error.message);
    return;
  }


  const players = data || [];

  const playerList = $('playerList');

  if (playerList) {

    playerList.innerHTML = players.map(player => `
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
    `).join('') || '<p class="muted">No players yet.</p>';

  }


  /* DELETE PLAYER */

  document.querySelectorAll('.del-player').forEach(button => {

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


  /* EDIT PLAYER */

  document.querySelectorAll('.edit-player').forEach(button => {

    button.onclick = async () => {

      const player = players.find(
        p => p.id === button.dataset.id
      );

      if (!player) return;


      const name = prompt(
        'Player name',
        player.name
      );

      if (!name || !name.trim()) return;


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
          'Use one of these:\n\n' +
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
    alert(error.message);
    return;
  }


  const matches = data || [];

  const matchList = $('matchList');

  if (!matchList) return;


  matchList.innerHTML = matches.map(match => {

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


    /* ACTIVE / SCHEDULED MATCHES */

    if (!isCompleted && !isCancelled) {

      actions += `
        <a href="manage.html?id=${match.id}">
          <button style="width:auto">
            Manage
          </button>
        </a>
      `;


      /* SCORING */

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


      /* CANCEL */

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


    /* COMPLETED MATCH */

    if (isCompleted) {

      actions += `
        <span class="ok">
          ✓ Match History Saved
        </span>

        <button
          class="danger delete-match"
          data-id="${match.id}"
          style="width:auto"
        >
          Delete
        </button>
      `;

    }


    /* CANCELLED MATCH */

    if (isCancelled) {

      actions += `
        <button
          class="danger delete-match"
          data-id="${match.id}"
          style="width:auto"
        >
          Delete
        </button>
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
          Status: ${esc(match.status)}
        </span>

        ${match.result_text ? `
          <strong class="ok">
            ${esc(match.result_text)}
          </strong>
        ` : ''}

        <div class="row">
          ${actions}
        </div>

      </div>
    `;

  }).join('') || '<p class="muted">No matches yet.</p>';


  /* CANCEL MATCH */

  document.querySelectorAll('.cancel-match').forEach(button => {

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
        .eq('id', button.dataset.id);


      if (error) {
        alert(error.message);
        return;
      }


      await loadMatches();

    };

  });


  /* DELETE MATCH */

  document.querySelectorAll('.delete-match').forEach(button => {

    button.onclick = async () => {

      if (!confirm(
        'PERMANENTLY delete this match?\n\n' +
        'This action cannot be undone.'
      )) return;


      const matchId = button.dataset.id;


      /* Delete deliveries */

      const { data: innings } = await supabase
        .from('innings')
        .select('id')
        .eq('match_id', matchId);


      if (innings && innings.length) {

        const inningsIds = innings.map(
          inning => inning.id
        );


        await supabase
          .from('deliveries')
          .delete()
          .in('innings_id', inningsIds);

      }


      /* Delete innings */

      await supabase
        .from('innings')
        .delete()
        .eq('match_id', matchId);


      /* Delete match players if present */

      await supabase
        .from('match_players')
        .delete()
        .eq('match_id', matchId);


      /* Delete match */

      const { error } = await supabase
        .from('matches')
        .delete()
        .eq('id', matchId);


      if (error) {
        alert(
          'Unable to delete match.\n\n' +
          error.message
        );
        return;
      }


      alert('Match deleted successfully.');

      await loadMatches();

    };

  });

}


/* ===============================
   LOGIN
================================ */

const loginForm = $('loginForm');

if (loginForm) {

  loginForm.addEventListener(
    'submit',
    async event => {

      event.preventDefault();


      const loginError = $('loginError');

      if (loginError) {
        loginError.textContent =
          'Logging in...';
      }


      const email =
        $('email')?.value.trim();

      const password =
        $('password')?.value;


      if (!email || !password) {

        if (loginError) {
          loginError.textContent =
            'Enter email and password.';
        }

        return;

      }


      try {

        const { data, error } =
          await supabase.auth.signInWithPassword({
            email,
            password
          });


        if (error) {

          console.error(error);

          if (loginError) {
            loginError.textContent =
              error.message;
          }

          return;

        }


        if (!data.session) {

          if (loginError) {
            loginError.textContent =
              'Login failed. No session created.';
          }

          return;

        }


        if (loginError) {
          loginError.textContent = '';
        }


        await requireSession();


      } catch (error) {

        console.error(error);

        if (loginError) {
          loginError.textContent =
            'Login failed: ' + error.message;
        }

      }

    }
  );

}


/* ===============================
   LOGOUT
================================ */

const logoutButton = $('logout');

if (logoutButton) {

  logoutButton.onclick = async () => {

    await supabase.auth.signOut();

    await requireSession();

  };

}


/* ===============================
   CREATE TEAM
================================ */

const teamForm = $('teamForm');

if (teamForm) {

  teamForm.addEventListener(
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

}


/* ===============================
   CREATE PLAYER
================================ */

const playerForm = $('playerForm');

if (playerForm) {

  playerForm.addEventListener(
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

}


/* ===============================
   CREATE MATCH
================================ */

const matchForm = $('matchForm');

if (matchForm) {

  matchForm.addEventListener(
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
        Number($('matchOvers').value);

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

}


/* ===============================
   START
================================ */

requireSession();
