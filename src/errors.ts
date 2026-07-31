/** A single error type for every failure the app raises on purpose. `statusCode`/`code` drive the HTTP response. */
export class AppError extends Error {
  constructor(message: string, public readonly statusCode: number, public readonly code: string) {
    super(message);
    this.name = "AppError";
  }
}
