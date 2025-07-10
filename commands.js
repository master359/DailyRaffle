const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField, Collection } = require("discord.js");
const { doc, getDoc, setDoc, updateDoc, collection, addDoc, query, orderBy, limit, getDocs } = require("firebase/firestore"); // Import Firestore functions

// Embed structure for the raffle message
const raffleEmbedTemplate = new EmbedBuilder()
    .setTitle("🎟️ Raffle Time!")
    .setDescription("Click the button below to use your raffle ticket!")
    .setColor("#FFD700"); // Gold color for raffle

// Button structure for joining
const joinButtonTemplate = new ButtonBuilder()
    .setCustomId("raffle_join")
    .setLabel("🎟️ Use Ticket")
    .setStyle(ButtonStyle.Primary);

// Store commands in a Collection for easy access in index.js
const commandsMap = new Collection();

// Helper function to generate current raffle status for embeds (Visual Improvement)
function getCurrentRaffleStatus(data) {
    let status = `**Active:** ${data.active ? '✅ Yes' : '❌ No'}\n`;
    status += `**Tickets Distributed:** ${Object.values(data.tickets).reduce((sum, count) => sum + count, 0)}\n`;
    status += `**Max Wins Per User:** ${data.maxWinsPerUser > 0 ? data.maxWinsPerUser : 'No Limit'}\n`;
    status += `**Max Wins Per Prize:** ${data.maxWinsPerPrize > 0 ? data.maxWinsPerPrize : 'No Limit'}\n\n`;

    status += '**Prizes & Wins:**\n';
    if (data.prizes.length === 0) {
        status += 'No prizes configured.\n';
    } else {
        data.prizes.forEach(p => {
            const wins = data.prizeWinsCount[p.name] || 0;
            status += `• **${p.name}** (Chance: ${p.chance}%) - Won: ${wins} times\n`;
        });
    }

    status += '\n**Recent Winners:**\n';
    if (data.currentWinners && data.currentWinners.length > 0) {
        const recent = data.currentWinners.slice(-5).map(w => `• ${w.userTag} won **${w.prizeName}**`).join('\n');
        status += recent;
    } else {
        status += 'No winners yet in this raffle.\n';
    }

    return status.substring(0, 1024); // Ensure it fits in an embed field
}

// NEW HELPER FUNCTION: Parses the simple prize string into an array of objects
function parsePrizesString(prizesString) {
    const prizes = [];
    if (!prizesString) return prizes;

    const prizePairs = prizesString.split(',').map(s => s.trim()).filter(s => s.length > 0);

    for (const pair of prizePairs) {
        const parts = pair.split(':');
        if (parts.length === 2) {
            const name = parts[0].trim();
            const chance = parseInt(parts[1].trim(), 10);
            if (name && !isNaN(chance) && chance >= 0) {
                prizes.push({ name, chance });
            } else {
                // Throw an error for invalid format, which will be caught by the command's try/catch
                throw new Error(`Invalid prize format in "${pair}". Expected "Name:Chance" with a valid number for chance.`);
            }
        } else {
            throw new Error(`Invalid prize format in "${pair}". Expected "Name:Chance".`);
        }
    }
    return prizes;
}


// --- DEFINE THE MAIN /RAFFLE COMMAND AND ITS SUBCOMMANDS ---
const raffleCommand = {
    data: new SlashCommandBuilder()
        .setName("raffle")
        .setDescription("Raffle commands for Daily raffle bot")
        // Add Start Subcommand
        .addSubcommand(subcommand =>
            subcommand.setName("start")
                .setDescription("Start a new raffle and define prizes (e.g., 'Nitro:10, Gift Card:5')") // Updated description
                .addStringOption(option =>
                    option.setName("prizes")
                        .setDescription("Comma-separated list of 'Prize Name:Chance', e.g., 'Nitro:10, Gift Card:5'") // Updated description
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName("description")
                        .setDescription("Custom description for the raffle embed")
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName("title")
                        .setDescription("Custom title for the raffle embed")
                        .setRequired(false)
                )
        )
        // Add End Subcommand
        .addSubcommand(subcommand =>
            subcommand.setName("end")
                .setDescription("End the current raffle and clear all data")
        )
        // Add Entries Subcommand (Public)
        .addSubcommand(subcommand =>
            subcommand.setName("entries")
                .setDescription("See all raffle entries and their current ticket counts")
        )
        // Add Add-Tickets Subcommand
        .addSubcommand(subcommand =>
            subcommand.setName("add-tickets")
                .setDescription("Add raffle tickets to a user or everyone")
                .addIntegerOption(option =>
                    option.setName("amount")
                        .setDescription("The number of tickets to add")
                        .setRequired(true)
                        .setMinValue(1)
                )
                .addUserOption(option =>
                    option.setName("user")
                        .setDescription("The user to give tickets to (leave empty for everyone)")
                        .setRequired(false)
                )
        )
        // New Subcommand: Set Winner Channel
        .addSubcommand(subcommand =>
            subcommand.setName("set-winner-channel")
                .setDescription("Sets the channel where raffle winners will be announced publicly.")
                .addChannelOption(option =>
                    option.setName("channel")
                        .setDescription("The channel to send winner announcements to.")
                        .setRequired(true)
                )
        )
        // New Subcommand: Set Max Wins
        .addSubcommand(subcommand =>
            subcommand.setName("set-max-wins")
                .setDescription("Sets maximum wins per user or per prize type (0 for no limit).")
                .addStringOption(option =>
                    option.setName("type")
                        .setDescription("Set limit for 'user' or 'prize'.")
                        .setRequired(true)
                        .addChoices(
                            { name: 'User', value: 'user' },
                            { name: 'Prize', value: 'prize' },
                        )
                )
                .addIntegerOption(option =>
                    option.setName("amount")
                        .setDescription("The maximum number of wins (0 for no limit).")
                        .setRequired(true)
                        .setMinValue(0)
                )
        ),
    // --- EXECUTE FUNCTION FOR THE MAIN /RAFFLE COMMAND ---
    async execute(interaction, db, guildId, client) { // 'db' is the Firestore instance
        const subcommandName = interaction.options.getSubcommand();

        // Get the app ID from the global variable (assuming it's accessible here or passed)
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const raffleDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'guild_raffles', guildId);

        // Admin check for specific commands
        const adminCommands = ["start", "end", "add-tickets", "set-winner-channel", "set-max-wins"];
        if (adminCommands.includes(subcommandName)) {
            // Explicitly create PermissionsBitField from interaction.member.permissions to ensure 'has' method exists
            const memberPermissions = new PermissionsBitField(interaction.member.permissions);
            if (!memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
                // Since index.js already deferred, we use editReply
                return interaction.editReply({ content: "🚫 Only administrators can use this command." });
            }
        }

        // Fetch current raffle data from Firestore
        const raffleDocSnap = await getDoc(raffleDocRef);
        let raffleData = raffleDocSnap.exists() ? raffleDocSnap.data() : {
            active: false,
            prizes: "[]", // Store as JSON string
            tickets: "{}", // Store as JSON string
            currentRaffleMessageId: null,
            currentRaffleChannelId: null,
            winnerLogChannelId: null,
            maxWinsPerUser: 0,
            maxWinsPerPrize: 0,
            prizeWinsCount: "{}", // Store as JSON string
            userWinsCount: "{}", // Store as JSON string
            currentWinners: "[]", // Store as JSON string
        };

        // Parse stringified data for use in logic
        raffleData.prizes = JSON.parse(raffleData.prizes);
        raffleData.tickets = JSON.parse(raffleData.tickets);
        raffleData.prizeWinsCount = JSON.parse(raffleData.prizeWinsCount);
        raffleData.userWinsCount = JSON.parse(raffleData.userWinsCount);
        raffleData.currentWinners = JSON.parse(raffleData.currentWinners);


        switch (subcommandName) {
            case "start": {
                // Removed deferReply here, as index.js now handles it

                // --- START DEBUGGING LOGS ---
                console.log("--- Inside /raffle start subcommand ---");
                console.log("Interaction Channel Object:", interaction.channel);
                console.log("Interaction Channel ID:", interaction.channelId);
                console.log("Is interaction.channel text-based?", interaction.channel?.isTextBased());
                console.log("-------------------------------------");
                // --- END DEBUGGING LOGS ---

                const prizesString = interaction.options.getString("prizes"); // Get the string input
                const customDescription = interaction.options.getString("description");
                const customTitle = interaction.options.getString("title");

                try {
                    const prizes = parsePrizesString(prizesString); // Use the new parsing function
                    if (prizes.length === 0) {
                        return interaction.editReply({ content: "🚫 Prizes must be provided in 'Name:Chance' format (e.g., 'Nitro:10, Gift Card:5')." });
                    }

                    if (raffleData.active) {
                        return interaction.editReply({ content: "A raffle is already active!" });
                    }

                    raffleData.active = true;
                    raffleData.prizes = prizes;
                    raffleData.tickets = {}; // Reset tickets for a new raffle
                    raffleData.currentRaffleMessageId = null;
                    raffleData.currentRaffleChannelId = null;
                    raffleData.prizeWinsCount = {}; // Reset prize win counts
                    raffleData.userWinsCount = {};   // Reset user win counts
                    raffleData.currentWinners = [];  // Reset current winners list for display

                    let targetChannel = interaction.channel;
                    // If interaction.channel is null or not fully fetched, try to fetch it
                    if (!targetChannel || !targetChannel.isTextBased()) {
                        try {
                            targetChannel = await client.channels.fetch(interaction.channelId);
                            if (!targetChannel || !targetChannel.isTextBased()) {
                                console.error("Fetched channel is still not a valid text channel.");
                                return interaction.editReply({ content: "🚫 Failed to start raffle: Could not access the channel to send the message." });
                            }
                        } catch (channelFetchError) {
                            console.error("Failed to fetch channel for sending raffle message:", channelFetchError);
                            return interaction.editReply({ content: "🚫 Failed to start raffle: Could not access the channel to send the message." });
                        }
                    }

                    const currentEmbed = EmbedBuilder.from(raffleEmbedTemplate)
                        .setTitle(customTitle || raffleEmbedTemplate.data.title)
                        .setDescription(customDescription || raffleEmbedTemplate.data.description)
                        .setFields( // Use setFields to replace previous fields
                            { name: 'Raffle Status', value: getCurrentRaffleStatus(raffleData) }
                        );

                    const sentMessage = await targetChannel.send({ // IMPORTANT: Now using targetChannel.send
                        embeds: [currentEmbed],
                        components: [new ActionRowBuilder().addComponents(joinButtonTemplate)],
                    });

                    raffleData.currentRaffleMessageId = sentMessage.id;
                    raffleData.currentRaffleChannelId = sentMessage.channelId;

                    await interaction.editReply({ content: "✅ Raffle started successfully!" });

                    // Save updated raffleData to Firestore
                    await setDoc(raffleDocRef, {
                        active: raffleData.active,
                        prizes: JSON.stringify(raffleData.prizes), // Still store as JSON string in Firestore
                        tickets: JSON.stringify(raffleData.tickets),
                        currentRaffleMessageId: raffleData.currentRaffleMessageId,
                        currentRaffleChannelId: raffleData.currentRaffleChannelId,
                        winnerLogChannelId: raffleData.winnerLogChannelId, // Persist existing setting
                        maxWinsPerUser: raffleData.maxWinsPerUser,       // Persist existing setting
                        maxWinsPerPrize: raffleData.maxWinsPerPrize,     // Persist existing setting
                        prizeWinsCount: JSON.stringify(raffleData.prizeWinsCount),
                        userWinsCount: JSON.stringify(raffleData.userWinsCount),
                        currentWinners: JSON.stringify(raffleData.currentWinners),
                    });

                } catch (err) {
                    console.error("Error parsing prizes string or starting raffle:", err); // Updated error message
                    return interaction.editReply({ content: `🚫 Invalid prize format or other error: ${err.message}` });
                }
                break;
            }

            case "end": {
                // Removed deferReply here, as index.js now handles it

                if (!raffleData.active) {
                    return interaction.editReply({ content: "⛔ No raffle is currently active." });
                }

                // New: Save current raffle to history before clearing
                const raffleSummary = {
                    timestamp: new Date().toISOString(),
                    prizes: raffleData.prizes,
                    totalEntries: Object.values(raffleData.tickets).reduce((sum, count) => sum + count, 0),
                    winners: raffleData.currentWinners || [],
                    maxWinsPerUser: raffleData.maxWinsPerUser,
                    maxWinsPerPrize: raffleData.maxWinsPerPrize,
                };
                // Add to history subcollection. Corrected call: collection(dbInstance, pathSegments...)
                const historyCollectionRef = collection(db, 'artifacts', appId, 'public', 'data', 'guild_raffles', guildId, 'history');
                await addDoc(historyCollectionRef, raffleSummary);


                raffleData.active = false;
                raffleData.prizes = [];
                raffleData.tickets = {};
                raffleData.currentRaffleMessageId = null;
                raffleData.currentRaffleChannelId = null;
                raffleData.prizeWinsCount = {}; // Reset counts
                raffleData.userWinsCount = {};   // Reset counts
                raffleData.currentWinners = [];  // Clear winners for next raffle

                await interaction.editReply("✅ Raffle ended and all data cleared. History saved!");

                // Save updated raffleData to Firestore (cleared state)
                await setDoc(raffleDocRef, {
                    active: raffleData.active,
                    prizes: JSON.stringify(raffleData.prizes),
                    tickets: JSON.stringify(raffleData.tickets),
                    currentRaffleMessageId: raffleData.currentRaffleMessageId,
                    currentRaffleChannelId: raffleData.currentRaffleChannelId,
                    winnerLogChannelId: raffleData.winnerLogChannelId, // Persist existing setting
                    maxWinsPerUser: raffleData.maxWinsPerUser,       // Persist existing setting
                    maxWinsPerPrize: raffleData.maxWinsPerPrize,     // Persist existing setting
                    prizeWinsCount: JSON.stringify(raffleData.prizeWinsCount),
                    userWinsCount: JSON.stringify(raffleData.userWinsCount),
                    currentWinners: JSON.stringify(raffleData.currentWinners),
                });
                break;
            }

            case "entries": {
                // Removed deferReply here, as index.js now handles it

                const replyEmbed = new EmbedBuilder()
                    .setTitle("🎯 Raffle Status & Entries")
                    .setColor("Aqua")
                    .setDescription(getCurrentRaffleStatus(raffleData))
                    .setTimestamp();

                await interaction.editReply({ embeds: [replyEmbed] }); // Use editReply
                break;
            }

            case "add-tickets": {
                // Removed deferReply here, as index.js now handles it

                const amount = interaction.options.getInteger("amount");
                const targetUser = interaction.options.getUser("user");

                if (amount <= 0) {
                    return interaction.editReply({ content: "Amount must be a positive number." });
                }

                if (!raffleData.active) {
                    return interaction.editReply({ content: "No raffle is currently active!" });
                }

                if (targetUser) {
                    // Add tickets to a specific user
                    raffleData.tickets[targetUser.id] =
                        (raffleData.tickets[targetUser.id] || 0) + amount;
                    await interaction.editReply({
                        content: `✅ Added ${amount} tickets to ${targetUser.tag}. They now have ${raffleData.tickets[targetUser.id]} tickets.`,
                    });
                } else {
                    // Add tickets to everyone in the guild
                    await interaction.guild.members.fetch(); // Ensure members are cached
                    const members = interaction.guild.members.cache;
                    let ticketsGiven = 0;
                    members.forEach((member) => {
                        if (!member.user.bot) {
                            // Don't give tickets to bots
                            raffleData.tickets[member.user.id] =
                                (raffleData.tickets[member.user.id] || 0) +
                                amount;
                        }
                    });
                    await interaction.editReply({
                        content: `✅ Added ${amount} tickets to all non-bot members.`,
                    });
                }
                // Save updated raffleData to Firestore
                await setDoc(raffleDocRef, {
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
                }, { merge: true });
                break;
            }

            case "set-winner-channel": {
                // Removed deferReply here, as index.js now handles it

                const channel = interaction.options.getChannel("channel");
                if (!channel.isTextBased()) {
                    return interaction.editReply({ content: "🚫 Please select a valid text channel." });
                }
                raffleData.winnerLogChannelId = channel.id;
                await interaction.editReply({ content: `✅ Winner announcements will now be sent to ${channel}.` });
                // Save updated winnerLogChannelId to Firestore
                await updateDoc(raffleDocRef, { winnerLogChannelId: raffleData.winnerLogChannelId });
                break;
            }

            case "set-max-wins": {
                // Removed deferReply here, as index.js now handles it

                const type = interaction.options.getString("type");
                const amount = interaction.options.getInteger("amount");

                if (type === "user") {
                    raffleData.maxWinsPerUser = amount;
                    await interaction.editReply({ content: `✅ Maximum wins per user set to ${amount === 0 ? "no limit" : amount}.` });
                    await updateDoc(raffleDocRef, { maxWinsPerUser: raffleData.maxWinsPerUser });
                } else if (type === "prize") {
                    raffleData.maxWinsPerPrize = amount;
                    await interaction.editReply({ content: `✅ Maximum wins per prize type set to ${amount === 0 ? "no limit" : amount}.` });
                    await updateDoc(raffleDocRef, { maxWinsPerPrize: raffleData.maxWinsPerPrize });
                }
                break;
            }

            default:
                // Removed deferReply here, as index.js now handles it
                await interaction.editReply({ content: "Unknown raffle subcommand." });
        }
    }
};

// New Top-Level Command: /raffle-history
const raffleHistoryCommand = {
    data: new SlashCommandBuilder()
        .setName("raffle-history")
        .setDescription("Shows the history of past raffles."),
    async execute(interaction, db, guildId, client) { // Added db and guildId
        // Removed deferReply here, as index.js now handles it

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const historyCollectionRef = collection(db, 'artifacts', appId, 'public', 'data', 'guild_raffles', guildId, 'history');

        // Fetch history documents
        const q = query(historyCollectionRef, orderBy("timestamp", "desc"), limit(5)); // Get last 5 raffles
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            return interaction.editReply({ content: "📜 No raffle history available yet." });
        }

        const historyEmbed = new EmbedBuilder()
            .setTitle("📜 Raffle History")
            .setColor("DarkBlue")
            .setTimestamp();

        querySnapshot.forEach((docSnap, index) => {
            const raffle = docSnap.data();
            const date = new Date(raffle.timestamp).toLocaleString();
            let winnersList = "No winners.";
            if (raffle.winners && raffle.winners.length > 0) {
                // Ensure winners are parsed if they were stringified in history
                const parsedWinners = typeof raffle.winners === 'string' ? JSON.parse(raffle.winners) : raffle.winners;
                winnersList = parsedWinners.slice(0, 10).map(w => `• ${w.userTag} won **${w.prizeName}**`).join('\n');
                if (parsedWinners.length > 10) winnersList += `\n...and ${parsedWinners.length - 10} more.`;
            }

            let prizeInfo = "No prizes configured.";
            if (raffle.prizes && raffle.prizes.length > 0) {
                // Ensure prizes are parsed if they were stringified in history
                const parsedPrizes = typeof raffle.prizes === 'string' ? JSON.parse(raffle.prizes) : raffle.prizes;
                prizeInfo = parsedPrizes.map(p => `• ${p.name} (Chance: ${p.chance}%)`).join('\n');
            }

            historyEmbed.addFields(
                { name: `Raffle ${querySnapshot.size - index} - Ended: ${date}`, value: `**Prizes:**\n${prizeInfo}\n**Winners:**\n${winnersList}`.substring(0, 1024) }
            );
        });

        await interaction.editReply({ embeds: [historyEmbed] }); // Use editReply
    }
};


// --- Add all commands to the commandsMap ---
commandsMap.set(raffleCommand.data.name, raffleCommand);
commandsMap.set(raffleHistoryCommand.data.name, raffleHistoryCommand); // Add new history command

module.exports = {
    commandsMap,
};
