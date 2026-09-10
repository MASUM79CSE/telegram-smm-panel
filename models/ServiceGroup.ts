import { Schema, model, models, Model, Types } from "mongoose";

/**
 * Top-level grouping tier above `Category` (see docs/IMPLEMENTATION_PLAN.md
 * Phase 1.1). Lets the catalog scale to many categories/services without the
 * admin UI or public catalog becoming an unmanageable flat list — mirrors
 * the 2-level taxonomy (group -> category -> service) observed on the
 * reference SMM panel analyzed in docs/COMPETITIVE_ANALYSIS_AND_ROADMAP.md
 * (e.g. "🚀 Telegram Boost" as a group containing "1 Day"/"7 Days"/"30 Days"
 * categories).
 *
 * Additive, non-breaking: `Category.groupId` is nullable, so existing
 * ungrouped categories keep working exactly as before this model existed —
 * no migration/backfill is required for the app to keep functioning.
 */
export interface IServiceGroup {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  /** Emoji or icon key, display-only — no business logic depends on this. */
  icon: string | null;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const serviceGroupSchema = new Schema<IServiceGroup>(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 100 },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    icon: { type: String, default: null, maxlength: 20 },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const ServiceGroup: Model<IServiceGroup> =
  models.ServiceGroup || model<IServiceGroup>("ServiceGroup", serviceGroupSchema);
