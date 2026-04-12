import mongoose, { Document, Schema } from 'mongoose';

export interface WeightChange {
  factor: string;
  oldWeight: number;
  newWeight: number;
  reason: string;
}

export interface IScoringConfig extends Document {
  version: number;
  active: boolean;
  weights: Record<string, number>;
  industryTiers: Record<string, number>;
  generatedBy: 'manual' | 'feedback_worker';
  changeLog: WeightChange[];
  createdAt: Date;
}

const ScoringConfigSchema = new Schema<IScoringConfig>(
  {
    version: { type: Number, required: true },
    active: { type: Boolean, default: false, index: true },
    weights: { type: Schema.Types.Mixed, required: true },
    industryTiers: { type: Schema.Types.Mixed, required: true },
    generatedBy: { type: String, enum: ['manual', 'feedback_worker'], default: 'manual' },
    changeLog: [
      {
        factor: String,
        oldWeight: Number,
        newWeight: Number,
        reason: String,
      },
    ],
  },
  { timestamps: true },
);

// Auto-increment version before save
ScoringConfigSchema.pre('save', async function (next) {
  if (this.isNew && !this.version) {
    const last = await ScoringConfig.findOne().sort({ version: -1 }).select('version').lean();
    this.version = last ? last.version + 1 : 1;
  }
  // Enforce only one active config at a time
  if (this.active && this.isModified('active')) {
    await ScoringConfig.updateMany({ _id: { $ne: this._id } }, { active: false });
  }
  next();
});

export const ScoringConfig = mongoose.model<IScoringConfig>('ScoringConfig', ScoringConfigSchema);
