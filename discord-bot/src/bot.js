require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder } = require('discord.js');
const db = require('./utils/database');
const logger = require('../../backend/src/utils/logger');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once('ready', () => {
  logger.info(`Discord bot logged in as ${client.user.tag}`);

  // Register slash commands
  const resetCommand = new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Check a nation\'s reset time')
    .addStringOption(option =>
      option.setName('nation')
        .setDescription('Nation name or ID')
        .setRequired(true)
    );

  client.application.commands.create(resetCommand);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'reset') {
    await handleResetCommand(interaction);
  }
});

async function handleResetCommand(interaction) {
  const nationInput = interaction.options.getString('nation');

  await interaction.deferReply();

  try {
    // Try to parse as ID first
    let query;
    let params;

    if (/^\d+$/.test(nationInput)) {
      query = `
        SELECT
          n.id,
          n.nation_name,
          n.leader_name,
          n.last_active,
          rt.reset_time,
          rt.detected_at
        FROM nations n
        LEFT JOIN reset_times rt ON n.id = rt.nation_id
        WHERE n.id = $1
      `;
      params = [parseInt(nationInput)];
    } else {
      query = `
        SELECT
          n.id,
          n.nation_name,
          n.leader_name,
          n.last_active,
          rt.reset_time,
          rt.detected_at
        FROM nations n
        LEFT JOIN reset_times rt ON n.id = rt.nation_id
        WHERE n.nation_name ILIKE $1
        ORDER BY n.last_active DESC
        LIMIT 1
      `;
      params = [`%${nationInput}%`];
    }

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      await interaction.editReply('Nation not found.');
      return;
    }

    const nation = result.rows[0];

    // Format the response
    let response = `**${nation.nation_name}** (ID: ${nation.id})\n`;
    response += `Leader: ${nation.leader_name}\n`;
    response += `Last Active: ${new Date(nation.last_active).toLocaleString()}\n`;

    if (nation.reset_time) {
      response += `**Reset Time: ${nation.reset_time} (server time)**\n`;
      response += `Detected: ${new Date(nation.detected_at).toLocaleString()}`;
    } else {
      response += `**Reset time not yet detected**\n`;
      response += `This nation is being monitored and the reset time will be detected automatically.`;
    }

    await interaction.editReply(response);

  } catch (error) {
    logger.error('Discord command error', error);
    await interaction.editReply('An error occurred while fetching nation data.');
  }
}

client.login(process.env.DISCORD_TOKEN);