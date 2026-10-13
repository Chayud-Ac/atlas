/** Thrown by services when an entity doesn't exist or isn't visible to the caller. */
export class NotFoundError extends Error {
  override name = 'NotFoundError';
}
