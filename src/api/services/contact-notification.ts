import { db } from '../../db/client.js';
import { logger } from '../../utils/logger.js';
import { Bot } from 'grammy';
import { decryptApiKey } from '../../utils/encryption.js';

/**
 * Returns true if the name looks like a real person's name
 * (not empty, not a common word like "цена", not a number or just digits)
 */
function isValidName(name?: string): boolean {
    if (!name || name.trim().length < 2) return false;
    if (/\d/.test(name)) return false;
    const badWords = ['цена', 'да', 'нет', 'стоимость', 'итого', 'заказ', 'товар', 'клиент', 'пользователь'];
    const lower = name.trim().toLowerCase();
    if (badWords.some(w => lower === w || lower.startsWith(w + ' '))) return false;
    return true;
}

/**
 * Saves a collected contact to the database and sends a notification
 * to the configured transport.
 */
export async function processCollectedContact(
    userId: number,
    contactData: Record<string, any>,
    botContext?: any
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
            'SELECT contact_notification_transport, contact_notification_destination, bot_token_encrypted, bot_token_iv FROM bot_config WHERE id = 1'
        );

        if (configResult.rows.length === 0) return;

        const config = configResult.rows[0];
        const transport = config.contact_notification_transport;
        const dest = config.contact_notification_destination;

        if (!transport || transport === 'none' || !dest) {
            return; // Notifications disabled or not configured
        }

        // Validated name — reject non-name values like "цена"
        const displayName = isValidName(contactData.name) ? contactData.name.trim() : 'Клиент';

        // Cart info — parse from "Корзина клиента:\n{cart}\n\nДоп. инфо: {extra}"  format
        let cartSection = '';
        const additionalInfo: string = contactData.additional_info || '';

        const cartMatch = additionalInfo.match(/^Корзина клиента:\n([\s\S]+?)(?:\n\nДоп\. инфо:[\s\S]*)?$/);
        if (cartMatch) {
            const cartLines = cartMatch[1].trim();
            cartSection = `\n\n📦 Корзина:\n${cartLines.substring(0, 800)}${cartLines.length > 800 ? '...' : ''}`;
        } else if (additionalInfo.trim()) {
            cartSection = `\n\n📦 Заказ:\n${additionalInfo.substring(0, 500)}${additionalInfo.length > 500 ? '...' : ''}`;
        }

        // Format notification message
        const formattedMessage =
            `🔔 Новая заявка!\n\n` +
            `👤 ${displayName}\n` +
            `📞 ${contactData.phone || '—'}\n` +
            `📧 ${contactData.email || '—'}` +
            cartSection +
            `\n\n🆔 User ID: ${userId}`;

        // 3. Send Notification based on transport
        if (transport === 'telegram_group') {
            try {
                if (botContext && botContext.api) {
                    await botContext.api.sendMessage(dest, formattedMessage);
                } else {
                    if (!config.bot_token_encrypted || !config.bot_token_iv) {
                        logger.error('Cannot send telegram notification: No bot token found in config');
                        return;
                    }
                    const token = decryptApiKey(config.bot_token_encrypted, config.bot_token_iv);
                    const tempBot = new Bot(token);
                    await tempBot.api.sendMessage(dest, formattedMessage);
                }
                logger.info(`Contact notification sent via ${transport}`, { dest });
            } catch (tgError: any) {
                logger.error(`Failed to send Telegram notification to ${dest}`, { error: tgError.message });
            }
        } else if (transport === 'email') {
            logger.warn(`Email transport selected but no native SMTP available. Simulated Email sent to: ${dest}`);
            logger.info(`[MOCK EMAIL to ${dest}]:\n${formattedMessage}`);
        }

    } catch (error: any) {
        logger.error('Error processing collected contact', { error: error.message });
    }
}
