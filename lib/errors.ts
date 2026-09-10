/**
 * Typed application errors for business logic shared between the website
 * API routes and the Telegram bot, so both surfaces can map the same error
 * codes to their own presentation (HTTP status + JSON vs. a chat message)
 * without duplicating the underlying validation/transaction logic.
 */
export class AppError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}
