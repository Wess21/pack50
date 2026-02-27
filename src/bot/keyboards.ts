import { InlineKeyboard } from 'grammy';

/**
 * Confirmation keyboard for lead data
 * Shows "Confirm" and "Edit" buttons
 */
export const confirmKeyboard = new InlineKeyboard()
  .text('✓ Подтвердить', 'confirm_lead')
  .text('✗ Изменить', 'edit_lead');
