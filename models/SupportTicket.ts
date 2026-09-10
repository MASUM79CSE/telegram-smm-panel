import { Schema, model, models, Model, Types } from "mongoose";

export type TicketStatus = "OPEN" | "ANSWERED" | "CLOSED";
export type TicketPriority = "LOW" | "MEDIUM" | "HIGH";

export interface ITicketMessage {
  _id: Types.ObjectId;
  senderId: Types.ObjectId;
  message: string;
  isAdmin: boolean;
  createdAt: Date;
}

export interface ISupportTicket {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  messages: ITicketMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const ticketMessageSchema = new Schema<ITicketMessage>(
  {
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, required: true, maxlength: 5000 },
    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    status: { type: String, enum: ["OPEN", "ANSWERED", "CLOSED"], default: "OPEN", index: true },
    priority: { type: String, enum: ["LOW", "MEDIUM", "HIGH"], default: "MEDIUM" },
    messages: [ticketMessageSchema],
  },
  { timestamps: true }
);

supportTicketSchema.index({ userId: 1, updatedAt: -1 });

export const SupportTicket: Model<ISupportTicket> =
  models.SupportTicket || model<ISupportTicket>("SupportTicket", supportTicketSchema);
