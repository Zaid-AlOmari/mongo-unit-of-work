import { WithId } from "mongodb";

export type IEntity = WithId<{ _id: string; }>;