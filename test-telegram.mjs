import { Bot } from 'grammy';
import dotenv from 'dotenv';
dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN);
const testGroupId = '-1002340578619'; // The ID the user likely pasted

bot.api.sendMessage(testGroupId, "Test message from CLI script")
  .then(() => console.log('Successfully sent message to group'))
  .catch(e => console.error('Failed to send to group:', e.message));
