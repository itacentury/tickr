/**
 * RxDB collection schemas for lists, items, categories, and settings.
 *
 * Each schema uses UUID primary keys and includes updatedAt for
 * checkpoint-based replication sorting.
 */

import {
  COLOR_HEX_MAX,
  ICON_MAX,
  ID_MAX,
  NAME_MAX,
  TEXT_MAX,
} from "./constants.js";

export const listSchema = {
  version: 2,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: ID_MAX },
    name: { type: "string", minLength: 1, maxLength: NAME_MAX },
    icon: { type: "string", maxLength: ICON_MAX },
    itemSort: { type: "string" },
    sortOrder: { type: "integer" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    _deleted: { type: "boolean", default: false },
  },
  required: ["id", "name", "updatedAt"],
};

export const itemSchema = {
  version: 3,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: ID_MAX },
    listId: { type: "string", maxLength: ID_MAX },
    text: { type: "string", minLength: 1, maxLength: TEXT_MAX },
    completed: { type: "boolean", default: false },
    categoryId: { type: ["string", "null"], maxLength: ID_MAX },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    completedAt: { type: ["string", "null"] },
    _deleted: { type: "boolean", default: false },
  },
  required: ["id", "listId", "text", "updatedAt"],
};

export const categorySchema = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: ID_MAX },
    listId: { type: "string", maxLength: ID_MAX },
    name: { type: "string", minLength: 1, maxLength: NAME_MAX },
    color: { type: "string", maxLength: COLOR_HEX_MAX },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    _deleted: { type: "boolean", default: false },
  },
  required: ["id", "listId", "name", "color", "updatedAt"],
};
