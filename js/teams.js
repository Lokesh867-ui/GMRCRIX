import { supabase } from './supabase.js';


const $ = id =>
  document.getElementById(id);


/* =========================
   ESCAPE HTML
========================= */

const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c])
  );


/* =========================
   LOAD TEAMS
========================= */

async function loadTeams() {

  const teamList =
    $('teamList');


  if (!teamList) {
    return;
  }


  teamList.innerHTML = `
    <div class="card">
      Loading teams...
    </div>
  `;


  const {
    data,
    error
  } =
    await supabase
      .from('teams')
      .select(`
        id,
        name,
        code,
        players (
          id,
          name,
          role
        )
      `)
      .order(
        'name',
        {
          ascending: true
        }
      );


  /* =========================
     ERROR
  ========================= */

  if (error) {

    console.error(
      'Unable to load teams:',
      error
    );


    teamList.innerHTML = `
      <div class="card">

        <h2>
          Unable to load teams
        </h2>

        <p class="muted">
          ${esc(error.message)}
        </p>

      </div>
    `;

    return;
  }


  /* =========================
     NO TEAMS
  ========================= */

  if (!data || data.length === 0) {

    teamList.innerHTML = `
      <div class="card">

        <h2>
          No teams yet
        </h2>

        <p class="muted">
          Teams will appear here when they are added.
        </p>

      </div>
    `;

    return;
  }


  /* =========================
     DISPLAY TEAMS
  ========================= */

  teamList.innerHTML =
    data
      .map(team => {

        const players =
          team.players || [];


        return `

          <section class="card team-card">

            <div class="team-heading">

              <div>

                <h2>
                  ${esc(team.name)}
                </h2>

                ${
                  team.code
                    ? `
                      <span class="muted">
                        ${esc(team.code)}
                      </span>
                    `
                    : ''
                }

              </div>


              <strong>
                ${players.length}
                ${
                  players.length === 1
                    ? 'Player'
                    : 'Players'
                }
              </strong>

            </div>


            <div class="team-players">

              ${
                players.length

                  ? players
                      .map(
                        (player, index) => `

                          <div class="team-player">

                            <span class="player-number">
                              ${index + 1}
                            </span>


                            <div>

                              <strong>
                                ${esc(player.name)}
                              </strong>

                              ${
                                player.role
                                  ? `
                                    <small>
                                      ${esc(player.role)}
                                    </small>
                                  `
                                  : ''
                              }

                            </div>

                          </div>

                        `
                      )
                      .join('')

                  : `
                    <p class="muted">
                      No players registered.
                    </p>
                  `
              }

            </div>

          </section>

        `;

      })
      .join('');
}


/* =========================
   INITIALIZE
========================= */

loadTeams();
