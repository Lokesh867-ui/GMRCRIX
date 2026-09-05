import { supabase } from './supabase.js';
const $=id=>document.getElementById(id);
const matchId=new URLSearchParams(location.search).get('id');
let match,players=[],selected=[];

async function auth(){const{data:{session}}=await supabase.auth.getSession();if(!session){location.href='admin.html';return false}return true}
async function load(){
 const {data:m,error}=await supabase.from('matches').select('*,team_a:teams!matches_team_a_id_fkey(id,name,code),team_b:teams!matches_team_b_id_fkey(id,name,code)').eq('id',matchId).single();
 if(error)return alert(error.message);match=m;
 $('title').textContent=m.name;$('info').textContent=`${m.team_a.name} vs ${m.team_b.name} · ${m.overs} overs · ${m.venue||'Venue not set'}`;
 $('tossWinner').innerHTML=`<option value="${m.team_a.id}">${m.team_a.name}</option><option value="${m.team_b.id}">${m.team_b.name}</option>`;
 $('tossWinner').value=m.toss_winner_id||m.team_a.id;$('tossDecision').value=m.toss_decision||'bat';
 const {data:p}=await supabase.from('players').select('*').in('team_id',[m.team_a.id,m.team_b.id]).order('name');players=p||[];
 const {data:s}=await supabase.from('match_players').select('*').eq('match_id',matchId);selected=s||[];
 renderTeam(m.team_a,'A');renderTeam(m.team_b,'B');updateReady();
}
function rows(team){
 const all=players.filter(p=>p.team_id===team.id), picks=selected.filter(x=>x.team_id===team.id&&x.is_playing_xi);
 return all.map(p=>{const x=selected.find(v=>v.player_id===p.id),checked=!!x?.is_playing_xi,cap=!!x?.is_captain;
 return `<div class="xi-row"><input type="checkbox" class="pick" data-player="${p.id}" data-team="${team.id}" ${checked?'checked':''}><label><b>${p.name}</b><br><span class="small">${p.role}</span></label><input type="radio" name="captain-${team.id}" class="captain" data-player="${p.id}" data-team="${team.id}" ${cap?'checked':''} ${checked?'':'disabled'}><span class="small">Captain</span></div>`}).join('');
}
function renderTeam(team,key){
 $(`team${key}Title`).textContent=`${team.name} Playing XI`;
 const picks=selected.filter(x=>x.team_id===team.id&&x.is_playing_xi).length;
 $(`team${key}Status`).innerHTML=picks===11?'<span class="ok">✓ 11 / 11 — Valid Playing XI</span>':`<span class="bad">${picks} / 11 — ${picks<11?'Select '+(11-picks)+' more':'Maximum 11 players'}</span>`;
 $(`team${key}Players`).innerHTML=rows(team);
 document.querySelectorAll('.pick').forEach(x=>x.onchange=()=>toggle(x.dataset.player,x.dataset.team,x.checked));
 document.querySelectorAll('.captain').forEach(x=>x.onchange=()=>setCaptain(x.dataset.player,x.dataset.team));
}
async function toggle(playerId,teamId,on){
 const count=selected.filter(x=>x.team_id===teamId&&x.is_playing_xi).length;
 if(on&&count>=11){alert('Maximum 11 players allowed.');await load();return}
 const old=selected.find(x=>x.player_id===playerId);
 let error;
 if(old)({error}=await supabase.from('match_players').update({is_playing_xi:on,is_captain:on?old.is_captain:false}).eq('id',old.id));
 else ({error}=await supabase.from('match_players').insert({match_id:matchId,team_id:teamId,player_id:playerId,is_playing_xi:on,is_substitute:!on}));
 if(error)alert(error.message);await load();
}
async function setCaptain(playerId,teamId){
 await supabase.from('match_players').update({is_captain:false}).eq('match_id',matchId).eq('team_id',teamId);
 const {error}=await supabase.from('match_players').update({is_captain:true}).eq('match_id',matchId).eq('player_id',playerId);
 if(error)alert(error.message);await load();
}
function updateReady(){
 const a=selected.filter(x=>x.team_id===match.team_a.id&&x.is_playing_xi).length,b=selected.filter(x=>x.team_id===match.team_b.id&&x.is_playing_xi).length;
 const ca=selected.some(x=>x.team_id===match.team_a.id&&x.is_playing_xi&&x.is_captain),cb=selected.some(x=>x.team_id===match.team_b.id&&x.is_playing_xi&&x.is_captain);
 const ok=a===11&&b===11&&ca&&cb&&match.toss_winner_id;
 $('startMatch').disabled=!ok;
 $('readyMessage').textContent=ok?'✓ Both XIs, captains and toss are ready.':`Team A: ${a}/11, Team B: ${b}/11. Each team also needs a captain and the toss must be saved.`;
 $('tossResult').textContent=match.toss_winner_id?`${match.toss_winner_id===match.team_a.id?match.team_a.name:match.team_b.name} won the toss and chose to ${match.toss_decision}.`:'Toss not completed.';
}
$('saveToss').onclick=async()=>{
 const {error}=await supabase.from('matches').update({toss_winner_id:$('tossWinner').value,toss_decision:$('tossDecision').value,status:'toss'}).eq('id',matchId);
 if(error)return alert(error.message);await load();
};
$('startMatch').onclick=async()=>{
 if(!confirm('Start the match?'))return;
 const winner=match.toss_winner_id;
 const batting=match.toss_decision==='bat'?winner:(winner===match.team_a.id?match.team_b.id:match.team_a.id);
 const bowling=batting===match.team_a.id?match.team_b.id:match.team_a.id;
 const {error}=await supabase.from('innings').insert({match_id:matchId,innings_no:1,batting_team_id:batting,bowling_team_id:bowling,status:'live'});
 if(error)return alert(error.message);
 await supabase.from('matches').update({status:'live',current_innings:1}).eq('id',matchId);
 location.href=`scorer.html?id=${matchId}`;
};
$('cancelMatch').onclick=async()=>{if(!confirm('Cancel this match?'))return;const{error}=await supabase.from('matches').update({status:'cancelled',result_text:'Match cancelled'}).eq('id',matchId);if(error)alert(error.message);else location.href='admin.html'};
(async()=>{if(await auth())load()})();
