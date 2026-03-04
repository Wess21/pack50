import { db } from '../../db/client.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { Bot } from 'grammy';

/**
 * Saves a collected contact to the database and sends a notification
 * to the configured transport.
 */
export async function processCollectedContact(
    userId: number,
    contactData: Record<string, any>,
    botContext?: any,
    messageHistory?: Array<{ role: string, content: string }>
): Promise<void> {
    try {
        // 1. Save to database
        await db.query(
            `INSERT INTO collected_contacts (user_id, contact_data) VALUES ($1, $2)`,
            [userId, JSON.stringify(contactData)]
        );
        logger.info('Contact saved to collected_contacts', { userId });

        // 2. Fetch notification configuration
        const configResult = await db.query(
            'SELECT contact_notification_transport, contact_notification_destination FROM bot_config WHERE id = 1'
        );

        if (configResult.rows.length === 0) return;

        const transport = configResult.rows[0].contact_notification_transport;
        const dest = configResult.rows[0].contact_notification_destination;

        if (!transport || transport === 'none' || !dest) {
            return; // Notifications disabled or not configured
        }

        // Build history context if available (last 3-5 messages)
        let historyContext = '';
        if (messageHistory && messageHistory.length > 0) {
            const recentHistory = messageHistory.slice(-6); // last 3 turns
            historyContext = `\n\n💬 Контекст диалога:\n`;
            recentHistory.forEach(msg => {
                const roleName = msg.role === 'user' ? '👤 Клиент' : '🤖 Бот';
                historyContext += `${roleName}: ${msg.content.substring(0, 150)}${msg.content.length > 150 ? '...' : ''}\n`;
            });
        }

        // Format message
        const formattedMessage = `Новая заявка/контакт!\n\n` +
            `User ID: ${userId}\n` +
            `Имя: ${contactData.name || '—'}\n` +
            `Email: ${contactData.email || '—'}\n` +
            `Телефон: ${contactData.phone || '—'}\n` +
            `Доп. инфо: ${contactData.additional_info || '—'}\n\n` +
            `Данные: ${JSON.stringify(contactData, null, 2)}` +
            historyContext;

        // 3. Send Notification based on transport
        if (transport === 'telegram_group') {
            try {
                if (botContext && botContext.api) {
                    await botContext.api.sendMessage(dest, formattedMessage);
                } else {
                    // If no context provided, instantiate a temporary bot API
                    const tempBot = new Bot(env.BOT_TOKEN);
                    await tempBot.api.sendMessage(dest, formattedMessage);
                }
                logger.info(`Contact notification sent via ${transport}`, { dest });
            } catch (tgError: any) {
                logger.error(`Failed to send Telegram notification to ${dest}`, { error: tgError.message });
            }
        } else if (transport === 'email') {
            // Since SMTP goes in .env, we fallback to logging or a separate Email microservice API if requested later.
            logger.warn(`Email transport selected but no native SMTP available. Simulated Email sent to: ${dest}`);
            logger.info(`[MOCK EMAIL to ${dest}]:\n${formattedMessage}`);
        }

    } catch (error: any) {
        logger.error('Error processing collected contact', { error: error.message });
    }
}
