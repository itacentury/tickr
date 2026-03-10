/**
 * RxDB collection schemas for lists, items, and settings.
 *
 * Each schema uses UUID primary keys and includes updatedAt for
 * checkpoint-based replication sorting.
 */

export const listSchema = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 36 },
    name: { type: "string" },
    icon: { type: "string" },
    itemSort: { type: "string" },
    sortOrder: { type: "integer" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    _deleted: { type: "boolean" },
  },
  required: ["id", "name", "updatedAt"],
};

export const itemSchema = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 36 },
    listId: { type: "string" },
    text: { type: "string" },
    completed: { type: "integer" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    completedAt: { type: ["string", "null"] },
    _deleted: { type: "boolean" },
  },
  required: ["id", "listId", "text", "updatedAt"],
};
