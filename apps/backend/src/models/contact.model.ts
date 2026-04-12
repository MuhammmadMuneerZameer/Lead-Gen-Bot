import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IContact extends Document {
  leadId: Types.ObjectId;
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  confidence: 'verified' | 'guessed' | 'scraped';
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema<IContact>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    name: { type: String, trim: true },
    role: { type: String, trim: true }, // Owner | Manager | Director | etc.
    email: {
      type: String,
      lowercase: true,
      trim: true,
      index: true,
      validate: {
        validator: (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        message: 'Invalid email format',
      },
    },
    phone: { type: String, trim: true }, // E.164 format
    linkedin: { type: String, trim: true }, // Profile URL
    confidence: {
      type: String,
      enum: ['verified', 'guessed', 'scraped'],
      default: 'scraped',
    },
  },
  { timestamps: true },
);

export const Contact = mongoose.model<IContact>('Contact', ContactSchema);
