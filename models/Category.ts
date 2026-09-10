import { Schema, model, models, Model, Types } from "mongoose";

export interface ICategory {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description: string | null;
  /**
   * Optional parent grouping (see models/ServiceGroup.ts). Nullable so
   * existing/new categories work identically whether or not they're
   * assigned to a group — this is an additive taxonomy tier, not a
   * required one. See docs/IMPLEMENTATION_PLAN.md Phase 1.1.
   */
  groupId: Types.ObjectId | null;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 100 },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    description: { type: String, default: null, maxlength: 1000 },
    groupId: { type: Schema.Types.ObjectId, ref: "ServiceGroup", default: null, index: true },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);


export const Category: Model<ICategory> = models.Category || model<ICategory>("Category", categorySchema);
