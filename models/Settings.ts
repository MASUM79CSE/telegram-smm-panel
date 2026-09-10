import { Schema, model, models, Model } from "mongoose";

/**
 * Singleton document (single row) holding site-wide admin-configurable settings.
 */
export interface ISettings {
  key: "global";
  siteName: string;
  siteDescription: string | null;
  supportEmail: string | null;
  minDeposit: number;
  maxDeposit: number;
  registrationEnabled: boolean;
  maintenanceMode: boolean;
  updatedAt: Date;
}

const settingsSchema = new Schema<ISettings>(
  {
    key: { type: String, default: "global", unique: true },
    siteName: { type: String, default: "SMM Panel" },
    siteDescription: { type: String, default: null },
    supportEmail: { type: String, default: null },
    minDeposit: { type: Number, default: 1 },
    maxDeposit: { type: Number, default: 100000 },
    registrationEnabled: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export const Settings: Model<ISettings> = models.Settings || model<ISettings>("Settings", settingsSchema);

export async function getSettings() {
  let doc = await Settings.findOne({ key: "global" });
  if (!doc) {
    doc = await Settings.create({ key: "global" });
  }
  return doc;
}
