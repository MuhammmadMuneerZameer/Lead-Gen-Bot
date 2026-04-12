import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IOutreachLog extends Document {
  leadId: Types.ObjectId;
  contactId?: Types.ObjectId;
  channel: 'email' | 'linkedin' | 'whatsapp' | 'instagram';
  promptTemplateId?: Types.ObjectId;
  messageSent: string;
  sentAt?: Date;
  status: 'pending' | 'sent' | 'opened' | 'replied' | 'bounced' | 'failed' | 'ignored';
  openedAt?: Date;
  repliedAt?: Date;
  response?: string;
  followUpDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OutreachLogSchema = new Schema<IOutreachLog>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
    channel: {
      type: String,
      enum: ['email', 'linkedin', 'whatsapp', 'instagram'],
      required: true,
    },
    promptTemplateId: { type: Schema.Types.ObjectId, ref: 'PromptTemplate' },
    messageSent: { type: String, required: true },
    sentAt: { type: Date },
    status: {
      type: String,
      enum: ['pending', 'sent', 'opened', 'replied', 'bounced', 'failed', 'ignored'],
      default: 'pending',
    },
    openedAt: { type: Date },
    repliedAt: { type: Date },
    response: { type: String },
    followUpDate: { type: Date },
  },
  { timestamps: true },
);

OutreachLogSchema.index({ leadId: 1, status: 1 });
OutreachLogSchema.index({ sentAt: -1 });
OutreachLogSchema.index({ followUpDate: 1, status: 1 });

export const OutreachLog = mongoose.model<IOutreachLog>('OutreachLog', OutreachLogSchema);
