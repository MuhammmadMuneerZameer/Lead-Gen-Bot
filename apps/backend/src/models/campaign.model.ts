import mongoose, { Document, Schema, Types } from 'mongoose';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type CampaignChannel = 'email' | 'linkedin' | 'whatsapp' | 'instagram';

export interface ICampaign extends Document {
  name: string;
  description?: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  targetIndustries: string[];
  targetPriorities: Array<'hot' | 'warm' | 'cold'>;
  promptTemplateId?: Types.ObjectId;
  dailyLimit: number;
  totalSent: number;
  totalReplied: number;
  totalConverted: number;
  replyRate: number;
  conversionRate: number;
  startedAt?: Date;
  completedAt?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema = new Schema<ICampaign>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 1000 },
    channel: { type: String, enum: ['email', 'linkedin', 'whatsapp', 'instagram'], required: true },
    status: {
      type: String,
      enum: ['draft', 'active', 'paused', 'completed', 'archived'],
      default: 'draft',
    },
    targetIndustries: [{ type: String }],
    targetPriorities: [{ type: String, enum: ['hot', 'warm', 'cold'] }],
    promptTemplateId: { type: Schema.Types.ObjectId, ref: 'PromptTemplate' },
    dailyLimit: { type: Number, default: 20, min: 1, max: 500 },
    totalSent: { type: Number, default: 0 },
    totalReplied: { type: Number, default: 0 },
    totalConverted: { type: Number, default: 0 },
    replyRate: { type: Number, default: 0, min: 0, max: 1 },
    conversionRate: { type: Number, default: 0, min: 0, max: 1 },
    startedAt: { type: Date },
    completedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

CampaignSchema.index({ status: 1, createdAt: -1 });
CampaignSchema.index({ channel: 1, status: 1 });

export const Campaign = mongoose.model<ICampaign>('Campaign', CampaignSchema);
