// Keep the bot alive on Render (formerly Replit Keep-Alive)
const express = require("express");
let app = express();
const port = 3000; // Render uses port 3000 for web servers by default

app.get("/", (req, res) => {
    res.send("Bot is alive!");
});

app.listen(port, () => {
    console.log(`Web server listening on port ${port}`);
});
// End Render Keep-Alive

// Load environment variables
require("dotenv").config();

let client; // <--- THIS IS THE CRITICAL FIX: Declare client globally here

// Discord.js imports
const {
    Client,
    GatewayIntentBits,
    Partials,
    Events,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField,
} = require("discord.js");
const { commandsMap } = require("./commands"); // Import the commands map

// Firebase imports
const { initializeApp } = require("firebase/app");
const {
    getAuth,
    signInAnonymously,
    signInWithCustomToken,
    onAuthStateChanged,
} = require("firebase/auth");
const {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    addDoc,
    query,
    orderBy,
    limit,
    getDocs,
} = require("firebase/firestore");

// --- Firebase Initialization ---
// Global variables provided by the Canvas environment (if available)
const appId = typeof __app_id !== "undefined" ? __app_id : "default-app-id";

let firebaseConfig;
if (typeof __firebase_config !== "undefined") {
    firebaseConfig = JSON.parse(__firebase_config);
    console.log("Using Firebase config from Canvas environment.");
} else if (process.env.FIREBASE_CONFIG) {
    try {
        firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
        console.log("Using Firebase config from local .env file.");
    } catch (e) {
        console.error("❌ Error parsing FIREBASE_CONFIG from .env:", e);
        process.exit(1);
    }
} else {
    console.error(
        "❌ FIREBASE_CONFIG not found in .env and not provided by Canvas environment.",
    );
    process.exit(1);
}

const initialAuthToken =
    typeof __initial_auth_token !== "undefined" ? __initial_auth_token : null;

let db; // This is where the Firestore instance will be stored
let auth;
let userId; // Will store the authenticated user ID

// Initialize Firebase and authenticate
async function initializeFirebase() {
    try {
        const firebaseApp = initializeApp(firebaseConfig); // Use a local variable for app
        db = getFirestore(firebaseApp); // Assign the Firestore instance to 'db'
        auth = getAuth(firebaseApp);

        // Authenticate the bot
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
            console.log("Firebase authenticated with custom token.");
        } else {
            await signInAnonymously(auth);
            console.log("Firebase authenticated anonymously.");
        }

        // Set the userId based on authentication state
        userId = auth.currentUser?.uid || crypto.randomUUID();
        console.log("Bot Firebase User ID:", userId);
        console.log(
            "Firestore DB initialized and ready (from index.js init):",
            !!db,
        ); // Debugging: Confirm db is set
    } catch (error) {
        console.error(
            "❌ Failed to initialize Firebase or authenticate:",
            error,
        );
        process.exit(1); // Exit if Firebase setup fails
    }
}

// Embed structure for the raffle message (remains here as a template)
const raffleEmbedTemplate = new EmbedBuilder()
    .setTitle("🎟️ Raffle Time!")
    .setDescription("Click the button below to use your raffle ticket!")
    .setColor("#FFD700"); // Gold color for raffle

// Button structure for joining (remains here as a template)
const joinButtonTemplate = new ButtonBuilder()
    .setCustomId("raffle_join")
    .setLabel("🎟️ Use Ticket")
    .setStyle(ButtonStyle.Primary);

// --- Discord Client Setup ---
// Assign the new Client instance to the globally declared 'client' variable
client = new Client({
    // Specify the intents your bot needs. Guilds is essential for server-related events.
    intents: [
        GatewayIntentBits.Guilds, // Required for guild-related events and fetching guild data
        GatewayIntentBits.GuildMessages, // Required for message events in guilds
        GatewayIntentBits.MessageContent, // Required to read message content (if needed for non-slash commands, but good practice)
        GatewayIntentBits.GuildMembers, // Required for fetching member data (e.g., for permissions)
    ],
    // Specify partials to ensure full data is available even if not cached
    partials: [
        Partials.Channel,
        Partials.GuildMember, // Essential for fetching full member data
        Partials.Message,
        Partials.Reaction,
        Partials.User,
    ],
});

client.once("ready", async () => {
    console.log(`🎉 Logged in as ${client.user.tag}`);
    client.user.setActivity("for raffle tickets!", { type: 0 }); // 0 for Playing

    // Initialize Firebase AFTER Discord client is ready
    await initializeFirebase();
});

client.on(Events.InteractionCreate, async (interaction) => {
    // Ensure Firebase is initialized before processing interactions
    if (!db || !auth.currentUser) {
        console.error(
            "Firebase not initialized or authenticated. Cannot process interaction.",
        );
        if (interaction.isRepliable()) {
            await interaction.reply({
                content:
                    "Bot is still starting up. Please try again in a moment.",
                ephemeral: true,
            });
        }
        return;
    }

    const guildId = interaction.guildId; // Directly get the guild ID from the interaction
    if (!guildId) {
        console.error("Could not get guild ID for interaction.");
        if (interaction.isRepliable()) {
            await interaction.reply({
                content: "This command can only be used in a server.",
                ephemeral: true,
            });
        }
        return;
    }

    if (interaction.isChatInputCommand()) {
        const command = commandsMap.get(interaction.commandName);

        if (!command) {
            console.error(
                `No command matching ${interaction.commandName} was found.`,
            );
            return;
        }

        try {
            // Defer the reply at the very beginning of the interaction processing for chat commands
            // This will be edited or followed up by the command's execute function
            await interaction.deferReply({ ephemeral: true });

            // Pass db, guildId, and client to the command's execute function
            await command.execute(interaction, db, guildId, client);
        } catch (error) {
            console.error("Error executing command:", error);
            // If the interaction was deferred, we must edit the reply or follow up.
            // If it wasn't deferred (e.g., an error before deferral), then reply.
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: "There was an error while executing this command! Please try again later.",
                }).catch(err => console.error("Failed to edit deferred reply:", err));
            } else {
                await interaction.reply({
                    content: "There was an error while executing this command! Please try again later.",
                    ephemeral: true,
                }).catch(err => console.error("Failed to send ephemeral reply:", err));
            }
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === "raffle_join") {
            await interaction.deferReply({ ephemeral: true }); // Defer button interaction immediately

            // Fetch current raffle data from Firestore for button interaction
            const raffleDocRef = doc(
                db,
                "artifacts",
                appId,
                "public",
                "data",
                "guild_raffles",
                guildId,
            );
            const raffleDocSnap = await getDoc(raffleDocRef);

            let raffleData = raffleDocSnap.exists() ? raffleDocSnap.data() : {};

            // Parse stringified data
            raffleData.prizes = raffleData.prizes
                ? JSON.parse(raffleData.prizes)
                : [];
            raffleData.tickets = raffleData.tickets
                ? JSON.parse(raffleData.tickets)
                : {};
            raffleData.prizeWinsCount = raffleData.prizeWinsCount
                ? JSON.parse(raffleData.prizeWinsCount)
                : {};
            raffleData.userWinsCount = raffleData.userWinsCount
                ? JSON.parse(raffleData.userWinsCount)
                : {};
            raffleData.currentWinners = raffleData.currentWinners
                ? JSON.parse(raffleData.currentWinners)
                : [];

            if (!raffleData.active) {
                return interaction.editReply({
                    content: "No raffle is active!",
                });
            }

            const userId = interaction.user.id;
            const userTag = interaction.user.tag;

            // Check if user has tickets
            if (
                !raffleData.tickets[userId] ||
                raffleData.tickets[userId] <= 0
            ) {
                return interaction.editReply({
                    content: "You don't have any raffle tickets!",
                });
            }

            // Check Max Wins Per User
            if (
                raffleData.maxWinsPerUser > 0 &&
                (raffleData.userWinsCount[userId] || 0) >=
                    raffleData.maxWinsPerUser
            ) {
                return interaction.editReply({
                    content: `You have reached the maximum of ${raffleData.maxWinsPerUser} wins in this raffle!`,
                });
            }

            // Decrement ticket count
            raffleData.tickets[userId]--;

            let prize = getWeightedPrize(raffleData.prizes); // Use 'let' to allow re-assignment
            if (!prize) {
                return interaction.editReply({
                    content: "No prizes configured or invalid prize data!",
                });
            }

            // Check Max Wins Per Prize
            if (
                raffleData.maxWinsPerPrize > 0 &&
                (raffleData.prizeWinsCount[prize.name] || 0) >=
                    raffleData.maxWinsPerPrize
            ) {
                // If this prize type is exhausted, try to get another prize from remaining
                const availablePrizes = raffleData.prizes.filter(
                    (p) =>
                        raffleData.maxWinsPerPrize === 0 ||
                        (raffleData.prizeWinsCount[p.name] || 0) <
                            raffleData.maxWinsPerPrize,
                );
                const newPrize = getWeightedPrize(availablePrizes);
                if (newPrize) {
                    prize = newPrize; // Assign the new prize
                } else {
                    return interaction.editReply({
                        content:
                            "All available prizes have reached their maximum win limit! No prize for you this time.",
                    });
                }
            }

            // Increment win counts
            raffleData.userWinsCount[userId] =
                (raffleData.userWinsCount[userId] || 0) + 1;
            raffleData.prizeWinsCount[prize.name] =
                (raffleData.prizeWinsCount[prize.name] || 0) + 1;

            // Store the winner for this prize
            raffleData.currentWinners.push({
                userTag: userTag,
                prizeName: prize.name,
                timestamp: new Date().toISOString(),
            });

            await interaction.editReply({
                content: `🎉 You won **${prize.name}**! You have ${raffleData.tickets[userId] || 0} tickets left.`,
            });

            // Public winner announcement
            if (raffleData.winnerLogChannelId) {
                try {
                    const winnerChannel = await client.channels.fetch(
                        raffleData.winnerLogChannelId,
                    );
                    if (winnerChannel && winnerChannel.isTextBased()) {
                        const winnerEmbed = new EmbedBuilder()
                            .setTitle("🏆 Raffle Winner!")
                            .setDescription(
                                `${userTag} just won **${prize.name}**!`,
                            )
                            .setColor("#00FF00") // Green for win
                            .setTimestamp()
                            .setFooter({
                                text: `Tickets left: ${raffleData.tickets[userId] || 0}`,
                            });
                        await winnerChannel.send({ embeds: [winnerEmbed] });
                    }
                } catch (error) {
                    console.error(
                        `Could not send winner announcement to channel ${raffleData.winnerLogChannelId}: ${error}`,
                    );
                }
            } else {
                // Fallback to DMing owner if no public channel is set
                try {
                    const owner = await interaction.guild.fetchOwner();
                    await owner.send(`${userTag} just won **${prize.name}** in the raffle! They have ${raffleData.tickets[userId] || 0} tickets left.
                    Guild: ${interaction.guild.name} (ID: ${interaction.guild.id})
                    Channel: #${interaction.channel.name} (ID: ${interaction.channel.id})`);
                } catch (error) {
                    console.error(`Could not send DM to guild owner: ${error}`);
                }
            }

            // Update the main raffle embed (visual improvement)
            if (
                raffleData.currentRaffleMessageId &&
                raffleData.currentRaffleChannelId
            ) {
                try {
                    const raffleChannel = await client.channels.fetch(
                        raffleData.currentRaffleChannelId,
                    );
                    const raffleMessage = await raffleChannel.messages.fetch(
                        raffleData.currentRaffleMessageId,
                    );

                    const updatedEmbed = EmbedBuilder.from(raffleEmbedTemplate)
                        .setDescription(
                            `Click the button below to use your raffle ticket!\n\n` +
                                `**Recent Winner:** ${userTag} won **${prize.name}**!`,
                        )
                        .setFields(
                            {
                                name: "Raffle Status",
                                value: getCurrentRaffleStatus(raffleData),
                            }, // Use helper for dynamic status
                        );

                    await raffleMessage.edit({
                        embeds: [updatedEmbed],
                        components: [
                            new ActionRowBuilder().addComponents(
                                joinButtonTemplate,
                            ),
                        ],
                    });
                } catch (error) {
                    console.error(
                        "Failed to update raffle embed message:",
                        error,
                    );
                }
            }

            // Save updated raffleData back to Firestore
            await setDoc(
                raffleDocRef,
                {
                    active: raffleData.active,
                    prizes: JSON.stringify(raffleData.prizes),
                    tickets: JSON.stringify(raffleData.tickets),
                    currentRaffleMessageId: raffleData.currentRaffleMessageId,
                    currentRaffleChannelId: raffleData.currentRaffleChannelId,
                    winnerLogChannelId: raffleData.winnerLogChannelId,
                    maxWinsPerUser: raffleData.maxWinsPerUser,
                    maxWinsPerPrize: raffleData.maxWinsPerPrize,
                    prizeWinsCount: JSON.stringify(raffleData.prizeWinsCount),
                    userWinsCount: JSON.stringify(raffleData.userWinsCount),
                    currentWinners: JSON.stringify(raffleData.currentWinners),
                },
                { merge: true },
            ); // Use merge to avoid overwriting other fields if they exist
        }
    }
});

// Weighted prize selection logic
function getWeightedPrize(prizes) {
    const totalWeight = prizes.reduce((acc, p) => acc + (p.chance || 0), 0);
    if (totalWeight === 0) return null;

    let rand = Math.random() * totalWeight;

    for (const prize of prizes) {
        if (rand < prize.chance) {
            return prize;
        }
        rand -= prize.chance;
    }
    return null;
}

// Helper function to generate current raffle status for embeds (Visual Improvement)
function getCurrentRaffleStatus(data) {
    let status = `**Active:** ${data.active ? "✅ Yes" : "❌ No"}\n`;
    status += `**Tickets Distributed:** ${Object.values(data.tickets).reduce((sum, count) => sum + count, 0)}\n`;
    status += `**Max Wins Per User:** ${data.maxWinsPerUser > 0 ? data.maxWinsPerUser : "No Limit"}\n`;
    status += `**Max Wins Per Prize:** ${data.maxWinsPerPrize > 0 ? data.maxWinsPerPrize : "No Limit"}\n\n`;

    status += "**Prizes & Wins:**\n";
    if (data.prizes.length === 0) {
        status += "No prizes configured.\n";
    } else {
        data.prizes.forEach((p) => {
            const wins = data.prizeWinsCount[p.name] || 0;
            status += `• **${p.name}** (Chance: ${p.chance}%) - Won: ${wins} times\n`;
        });
    }

    status += "\n**Recent Winners:**\n";
    if (data.currentWinners && data.currentWinners.length > 0) {
        // Show last 5 winners
        const recent = data.currentWinners
            .slice(-5)
            .map((w) => `• ${w.userTag} won **${w.prizeName}**`)
            .join("\n");
        status += recent;
    } else {
        status += "No winners yet in this raffle.\n";
    }

    return status.substring(0, 1024); // Ensure it fits in an embed field
}

client.login(process.env.TOKEN);
