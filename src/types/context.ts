import { Context, SessionFlavor } from 'grammy';
import type { ConversationFlavor } from '@grammyjs/conversations';
import type { SessionData } from './session.js';

/**
 * Custom context type extending grammY Context
 * Includes session storage and conversation plugin support
 */
export type MyContext = Context & SessionFlavor<SessionData> & ConversationFlavor;
