const { REST, Routes } = require("discord.js");
require("dotenv").config(); // Load environment variables

// Define the Guild ID for Kytherial (using the ID you provided)
const KYTHERIAL_GUILD_ID = "1366877692485697537";

const commands = [
    // Define your commands here. These are the commands you want to deploy.
    {
        name: "raffle",
        description: "Raffle commands for Daily raffle bot",
        options: [
            {
                type: 1, // Subcommand
                name: "start",
                description: "Start a new raffle and define prizes",
                options: [
                    {
                        type: 3, // String
                        name: "prizes",
                        description:
                            "Comma-separated list of 'Prize Name:Chance', e.g., 'Nitro:10, Gift Card:5'",
                        required: true,
                    },
                    {
                        type: 3, // String
                        name: "description",
                        description: "Custom description for the raffle embed",
                        required: false,
                    },
                    {
                        type: 3, // String
                        name: "title",
                        description: "Custom title for the raffle embed",
                        required: false,
                    },
                ],
            },
            {
                type: 1, // Subcommand
                name: "end",
                description: "End the current raffle and clear all data",
            },
            {
                type: 1, // Subcommand
                name: "entries",
                description:
                    "See all raffle entries and their current ticket counts",
            },
            {
                type: 1, // Subcommand
                name: "add-tickets",
                description: "Add raffle tickets to a user or everyone",
                options: [
                    {
                        type: 4, // Integer
                        name: "amount",
                        description: "The number of tickets to add",
                        required: true,
                    },
                    {
                        type: 6, // User
                        name: "user",
                        description:
                            "The user to give tickets to (leave empty for everyone)",
                        required: false,
                    },
                ],
            },
            {
                type: 1, // Subcommand
                name: "set-winner-channel",
                description:
                    "Sets the channel where raffle winners will be announced publicly.",
                options: [
                    {
                        type: 7, // Channel
                        name: "channel",
                        description:
                            "The channel to send winner announcements to.",
                        required: true,
                    },
                ],
            },
            {
                type: 1, // Subcommand
                name: "set-max-wins",
                description:
                    "Sets maximum wins per user or per prize type (0 for no limit).",
                options: [
                    {
                        type: 3, // String
                        name: "type",
                        description: "Set limit for 'user' or 'prize'.",
                        required: true,
                        choices: [
                            { name: "User", value: "user" },
                            { name: "Prize", value: "prize" },
                        ],
                    },
                    {
                        type: 4, // Integer
                        name: "amount",
                        description:
                            "The maximum number of wins (0 for no limit).",
                        required: true,
                        min_value: 0,
                    },
                ],
            },
        ],
    },
    {
        name: "raffle-history",
        description: "Shows the history of past raffles.",
    },
];

// Get environment variables from Replit Secrets
const CLIENT_ID = process.env.CLIENT_ID;
const TOKEN = process.env.TOKEN;

const rest = new REST().setToken(TOKEN);

(async () => {
    try {
        console.log(
            `Started refreshing ${commands.length} application (/) commands for guild ${KYTHERIAL_GUILD_ID}.`,
        );

        // --- IMPORTANT CHANGE: Deploying as GUILD commands ---
        const data = await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, KYTHERIAL_GUILD_ID), // Changed to applicationGuildCommands
            { body: commands },
        );

        console.log(
            `Successfully reloaded ${data.length} application (/) commands for guild ${KYTHERIAL_GUILD_ID}.`,
        );
    } catch (error) {
        console.error("Error deploying guild commands:", error);
    }
})();
