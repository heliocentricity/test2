// scripts/update.js

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');

const CONFIG_PATH = path.join(__dirname, '..', 'baseline.json');
const DATA_PATH   = path.join(__dirname, '..', 'docs',     'data.json');

// load config
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const { TEAM_NAME, START_DATE } = config;

// fetch via NitroType’s API + ScraperAPI proxy
async function fetchLeaderboard() {
  const targetUrl = `https://www.nitrotype.com/api/v2/teams/${TEAM_NAME}`;
  const proxyUrl  = `http://api.scraperapi.com`
                  + `?api_key=${process.env.SCRAPERAPI_KEY}`
                  + `&url=${encodeURIComponent(targetUrl)}`;
  const res  = await axios.get(proxyUrl);
  const body = res.data;

  if (body.status !== 'OK' || !body.results || !Array.isArray(body.results.members)) {
    console.error('⚠️  Unexpected JSON:', JSON.stringify(body).slice(0,200));
    throw new Error('Invalid team JSON');
  }

  return body.results.members.map(m => {
  let role = m.role;
  if (m.username === 'aiy_infection') role = 'captain';
  if (m.username === 'vioiynx' || m.username === 'neiletsky') role = 'vicecaptain';
  return {
    username:     m.username,
    displayName:  m.displayName,
    racesPlayed:  m.racesPlayed,
    teamPlayed:   m.played,
    role,                    // officer|captain|member
    title:         m.title,  // title under name
    joinStamp:     m.joinStamp,
    lastActivity:  m.lastActivity
  };
});
}

async function ensureBaseline() {
  const board = await fetchLeaderboard();
  config.baseline = config.baseline || {};
  board.forEach(({ username, racesPlayed }) => {
    if (!Number.isInteger(config.baseline[username])) {
      config.baseline[username] = racesPlayed;
      console.log(`Baseline[${username}] = ${racesPlayed}`);
    }
  });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function ensureTeamBaseline() {
  const board = await fetchLeaderboard();
  config.baselineLifetime = config.baselineLifetime || {};
  config.baselineTeam     = config.baselineTeam     || {};

  board.forEach(({ username, racesPlayed, teamPlayed }) => {
    if (! Number.isInteger(config.baselineTeam[username])) {
      const origBaseLifetime = config.baselineLifetime[username] || 0;
      // compute how many lifetime races happened up till now
      const initialLifetimeDelta = racesPlayed - origBaseLifetime;

      // overwrite baselineLifetime to hold that initial delta
      config.baselineLifetime[username] = initialLifetimeDelta;
      // seed team baseline
      config.baselineTeam[username] = teamPlayed;

      console.log(
        `Seeded ${username}: baselineLifetime=${initialLifetimeDelta}, `
        + `baselineTeam=${teamPlayed}`
      );
    }
  });

  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify(config, null, 2)
  );
}

async function updateData() {
  const board = await fetchLeaderboard();
  const results = board
    .map(u => {
      const teamDelta = u.teamPlayed - config.baselineTeam[u.username];
      const total     = config.baselineLifetime[u.username] + teamDelta;
      return {
        ...u,
        teamDelta,
        totalSinceStart: total
      };
    })
    .sort((a, b) => b.totalSinceStart - a.totalSinceStart);

  results.forEach(r =>
    console.log(
      `${r.username}: teamDelta=${r.teamDelta}, `
    + `totalSinceStart=${r.totalSinceStart}`
    )
  );

  // PST timestamp
  const now = new Date();
  const last_updated = now.toLocaleString('en-US',{
    timeZone:       'America/Los_Angeles',
    month:          'long',
    day:            'numeric',
    year:           'numeric',
    hour:           'numeric',
    minute:        '2-digit',
    timeZoneName:  'short'
  });

  fs.writeFileSync(
    DATA_PATH,
    JSON.stringify(
      { TEAM_NAME, START_DATE, last_updated, board: results },
      null,
      2
    )
  );
}

(async () => {
  try {
    await ensureTeamBaseline();
    await updateData();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
