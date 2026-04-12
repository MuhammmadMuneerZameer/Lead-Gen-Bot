import mongoose, { Document, Schema } from 'mongoose';

export type SelfImproveType =
  | 'weight_change'
  | 'prompt_update'
  | 'scrape_rule'
  | 'ai_rule'
  | 'outcome_pattern';

export type SelfImproveSeverity = 'info' | 'warning' | 'critical';

export interface ISelfImproveLog extends Document {
  type: SelfImproveType;
  severity: SelfImproveSeverity;
  problem: string;
  actionTaken: string;
  ruleUpdated: boolean;
  ruleDetails?: {
    field: string;
    oldValue: unknown;
    newValue: unknown;
  };
  outcomesSampled?: number;
  timestamp: Date;
}

const SelfImproveLogSchema = new Schema<ISelfImproveLog>(
  {
    type: {
      type: String,
      enum: ['weight_change', 'prompt_update', 'scrape_rule', 'ai_rule', 'outcome_pattern'],
      required: true,
    },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info',
    },
    problem: { type: String, required: true },
    actionTaken: { type: String, required: true },
    ruleUpdated: { type: Boolean, default: false },
    ruleDetails: {
      field: String,
      oldValue: Schema.Types.Mixed,
      newValue: Schema.Types.Mixed,
    },
    outcomesSampled: { type: Number },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

SelfImproveLogSchema.index({ type: 1, timestamp: -1 });
SelfImproveLogSchema.index({ severity: 1, timestamp: -1 });

export const SelfImproveLog = mongoose.model<ISelfImproveLog>('SelfImproveLog', SelfImproveLogSchema);
