import type { EntityTypeId } from "../model";
import { API_TRANSFORMS } from "./apis";
import { FREE_TRANSFORMS } from "./free";
import { PEOPLE_TRANSFORMS } from "./people";
import type { Transform } from "./types";
import { usernameCheck } from "./username";

export const TRANSFORMS: Transform[] = [...FREE_TRANSFORMS, usernameCheck, ...API_TRANSFORMS, ...PEOPLE_TRANSFORMS];

export function transformsFor(type: EntityTypeId): Transform[] {
  return TRANSFORMS.filter((t) => t.inputs.includes(type));
}

export function transformById(id: string): Transform | undefined {
  return TRANSFORMS.find((t) => t.id === id);
}
