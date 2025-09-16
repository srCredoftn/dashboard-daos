import mongoose, { Schema } from "mongoose";

export interface NotificationDocument extends mongoose.Document {
  id: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  recipients: "all" | string[];
  readBy: string[];
  createdAt: string;
}

const NotificationSchema = new Schema<NotificationDocument>({
  id: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: { type: Schema.Types.Mixed },
  recipients: { type: Schema.Types.Mixed, required: true },
  readBy: { type: [String], default: [] },
  createdAt: { type: String, required: true },
});

const NotificationModel =
  (mongoose.models.Notification as mongoose.Model<NotificationDocument>) ||
  mongoose.model<NotificationDocument>("Notification", NotificationSchema);

export default NotificationModel;
