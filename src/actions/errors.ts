export class ActionNotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} with id "${id}" was not found`);
    this.name = "ActionNotFoundError";
  }
}

export class InvalidActionStateError extends Error {
  constructor(
    entity: string,
    id: string,
    expectedStatuses: readonly string[],
    actualStatus: string,
  ) {
    super(
      `${entity} "${id}" is in status "${actualStatus}", expected one of: ${expectedStatuses.join(", ")}`,
    );
    this.name = "InvalidActionStateError";
  }
}
