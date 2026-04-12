import mongoose, { Document, Schema, Types } from 'mongoose';

export type ActualOutcome = 'replied' | 'interested' | 'converted' | 'ignored' | 'bounced' | 'objected';
export type ReplyQuality = 'positive' | 'neutral' | 'negative' | 'none';

export interface IOutcomeLog extends Document {
  leadId: Types.ObjectId;
  predictedScore: number;
  predictedPriority: 'hot' | 'warm' | 'cold';
  actualOutcome: ActualOutcome;
  replyQuality: ReplyQuality;
  dealValue?: number;
  daysToReply?: number;
  channelUsed: string;
  pitchAngle?: string;
  scoreFactors: Record<string, boolean | number>;
  industryTier: 1 | 2 | 3;
  promptTemplateId?: Types.ObjectId;
  loggedAt: Date;
}

const OutcomeLogSchema = new Schema<IOutcomeLog>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    predictedScore: { type: Number, required: true },
    predictedPriority: { type: String, enum: ['hot', 'warm', 'cold'], required: true },
    actualOutcome: {
      type: String,
      enum: ['replied', 'interested', 'converted', 'ignored', 'bounced', 'objected'],
      required: true,
    },
    replyQuality: {
      type: String,
      enum: ['positive', 'neutral', 'negative', 'none'],
      default: 'none',
    },
    dealValue: { type: Number }, // USD if converted
    daysToReply: { type: Number }, // null if no reply
    channelUsed: { type: String, required: true },
    pitchAngle: { type: String },
    scoreFactors: { type: Schema.Types.Mixed, required: true }, // full scoreBreakdown snapshot
    industryTier: { type: Number, enum: [1, 2, 3], required: true },
    promptTemplateId: { type: Schema.Types.ObjectId, ref: 'PromptTemplate' },
    loggedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

OutcomeLogSchema.index({ loggedAt: -1 });
OutcomeLogSchema.index({ industryTier: 1, actualOutcome: 1 });

export const OutcomeLog = mongoose.model<IOutcomeLog>('OutcomeLog', OutcomeLogSchema);
